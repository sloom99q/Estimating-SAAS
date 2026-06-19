/**
 * EXTRACT_FINISH_LEGEND — Sprint 6 new pipeline stage.
 *
 *   payload = { documentId }
 *
 * Runs on every sheet classified as `finish_plan` or `legend` (Plot 4357:
 * the I401-I404 series). Each sheet renders at 220 DPI in a single full
 * image (the legend table is centred and small; no need to quadrant tile).
 * Vision returns one row per legend code on the page.
 *
 * Rows are persisted as TakeoffItem with category mapped by kind:
 *   FLOOR / EXTERNAL  → FLOOR_FINISH
 *   WALL              → WALL_FINISH
 *   CEILING           → CEILING
 *   OTHER             → OTHER
 * meta.kind = 'LEGEND' marks the row as a MATERIAL DEFINITION — not a
 * billable quantity (qtyAi/qtyFinal stay null). The downstream BOQ
 * generator (S6-4) joins legend rows back to billable lines for the
 * description.
 *
 * Chains into EXTRACT_SCHEDULES.
 */
import type { Prisma } from '@prisma/client'
import { STUB_SUFFIX, extractFinishLegend } from '../../ai/anthropic'
import { parseLegendTextLayer, type LegendTextRow } from '../../ai/legendTextPass'
import { renderPageQuadrants } from '../../ai/quadrantRender'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import { enqueueIfNotDone } from '../chainGuard'
import { upsertValidationFlag } from '../validationFlagUpsert'
import type { JobHandler, JobRecord } from '../types'

interface ExtractFinishLegendPayload {
  documentId: string
}

const LEGEND_SHEET_TYPES = ['finish_plan', 'legend'] as const

/**
 * Sprint-7 S7-2 LEGEND PRECISION:
 *
 *   - Sheet anchor: only run on sheets whose drawing-no matches the I4xx
 *     family (finish plans). Bathroom / joinery / electrical sheets that
 *     happened to classify as 'finish_plan' get filtered out by the anchor.
 *
 *   - Code regex: /^[A-Z]{2}\d{2}$/  e.g. ST01, PR03, WD01, FN42.
 *     BATHROOM sentinel allowed. Anything else (section headings like
 *     'MASTER BATHROOM', 'POWDER & WASH', 'ADDITIONAL', 'EXISTING') is
 *     dropped at persist time.
 *
 *   - Sanity range: 8-25 codes per document. Outside the range raises an
 *     ERROR LEGEND_SANITY ValidationFlag.
 */
const FINISH_PLAN_ANCHOR_RE = /^I4\d{2}\b/i // I401, I402, I403, I404
const LEGEND_CODE_RE = /^[A-Z]{2}\d{2}$/
const LEGEND_MIN_CODES = 8
const LEGEND_MAX_CODES = 25
const BATHROOM_SENTINEL = 'BATHROOM'

function categoryFor(kind: string | null | undefined): 'FLOOR_FINISH' | 'WALL_FINISH' | 'CEILING' | 'OTHER' {
  if (kind === 'WALL') return 'WALL_FINISH'
  if (kind === 'CEILING') return 'CEILING'
  if (kind === 'FLOOR' || kind === 'EXTERNAL') return 'FLOOR_FINISH'
  return 'OTHER'
}

async function renderFullPageJpegBase64(
  sourceBytes: Buffer,
  pageNo: number,
  fallbackImageKey: string | null,
  blob: ReturnType<typeof getBlobStore>,
): Promise<string | null> {
  // Sprint-6 live-gate finding: the original TL-only quadrant render missed
  // every legend table that wasn't in the top-left of the page (Plot 4357's
  // I401-I404 keep theirs centre-right). We need the WHOLE page in one
  // image. Use the INGEST 110-DPI full-page jpeg directly — Anthropic will
  // downsample, but the legend tags (ST01 etc.) are easily readable at that
  // size. Fall back to a 220-DPI quadrant pass if the INGEST image is gone.
  if (fallbackImageKey) {
    try {
      const bytes = await blob.get(fallbackImageKey)
      return bytes.toString('base64')
    } catch {
      // fall through to the slower quadrant path
    }
  }
  try {
    const quads = await renderPageQuadrants(sourceBytes, pageNo, { dpi: 220, overlapPct: 0 })
    return quads[0]?.base64 ?? null
  } catch {
    return null
  }
}

export const extractFinishLegendHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as ExtractFinishLegendPayload
  if (!payload.documentId) throw new Error('EXTRACT_FINISH_LEGEND: payload.documentId required')

  const document = await prisma.document.findFirst({
    where: { id: payload.documentId, organizationId: job.organizationId },
  })
  if (!document) throw new Error(`EXTRACT_FINISH_LEGEND: document ${payload.documentId} not found`)

  const candidateSheets = await prisma.sheet.findMany({
    where: {
      documentId: document.id,
      organizationId: job.organizationId,
      sheetType: { in: [...LEGEND_SHEET_TYPES] },
    },
    orderBy: { pageNo: 'asc' },
  })

  // S7-2: anchor filter. Run only on sheets matching the I4xx finish-plan
  // family. If no sheet matches the anchor (small set, malformed drawing
  // numbers), fall back to the classifier set so we don't silently produce
  // zero legend rows.
  const anchoredSheets = candidateSheets.filter((s) => FINISH_PLAN_ANCHOR_RE.test(s.drawingNo ?? ''))
  const sheets = anchoredSheets.length > 0 ? anchoredSheets : candidateSheets
  const anchoredCount = anchoredSheets.length
  const usedFallback = anchoredCount === 0 && candidateSheets.length > 0

  const blob = getBlobStore()
  const sourceBytes = sheets.length > 0 ? await blob.get(document.storageKey) : Buffer.alloc(0)

  let tokensIn = 0
  let tokensOut = 0
  let legendRowsCreated = 0
  let codesDroppedByRegex = 0
  let textLayerHits = 0
  let visionHits = 0
  let visionEnrichedRows = 0
  const allCodes = new Set<string>()

  /**
   * Sprint-8 S8-1 (ADR-016): text-layer-first. For each anchored I4xx
   * sheet we read its `pdftotext -layout` output, extract legend codes
   * deterministically, and persist them as LEGEND TakeoffItems with
   * provenance='text-layer'. Vision still runs as an *enricher* (and as
   * scanned-set fallback) but the *code set itself* is now $0.
   */
  interface PendingRow {
    code: string
    name: string | null
    description: string | null
    detail: string | null
    legendKind: 'FLOOR' | 'WALL' | 'CEILING' | 'EXTERNAL' | 'OTHER' | null
    material: string | null
    size: string | null
    finish: string | null
    usage: string | null
    sheetId: string
    sourceNote: string
    sourceDrawingNo: string | null
    provenance: { code: 'text-layer' | 'vision'; name: 'text-layer' | 'vision' | null; description: 'text-layer' | 'vision' | null }
    stubVision: boolean
  }
  const pendingByCode = new Map<string, PendingRow>()

  for (const sheet of sheets) {
    const rawText = sheet.rawTextKey
      ? await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')
      : ''
    const textSnippet = rawText.slice(0, 4000)

    // 1) TEXT-LAYER PRIMARY. Deterministic, $0.
    const textPass = rawText.length > 0 ? parseLegendTextLayer(rawText) : { rows: [] as LegendTextRow[], bathroomSentinelSeen: false }
    for (const row of textPass.rows) {
      const code = row.code
      if (code !== BATHROOM_SENTINEL && !LEGEND_CODE_RE.test(code)) continue
      if (!pendingByCode.has(code)) {
        pendingByCode.set(code, {
          code,
          name: row.name,
          description: row.description,
          detail: row.detail,
          legendKind: null,
          material: null,
          size: null,
          finish: null,
          usage: null,
          sheetId: sheet.id,
          sourceNote: `${sheet.drawingNo ?? `page ${sheet.pageNo}`} (legend, text layer)`,
          sourceDrawingNo: sheet.drawingNo,
          provenance: { code: 'text-layer', name: row.name ? 'text-layer' : null, description: row.description ? 'text-layer' : null },
          stubVision: false,
        })
        textLayerHits += 1
      }
    }

    // 2) VISION SECONDARY. Two roles on this stage:
    //    a) Scanned-set fallback when text layer is empty/garbled.
    //    b) Enricher of missing description / material / size / finish on
    //       codes the text layer already gave us.
    const needsVisionFallback = textPass.rows.length === 0
    // Optionally we could disable vision entirely once text-pass produces
    // ≥8 codes (the sanity floor); we keep one enrichment call per sheet so
    // the descriptions get fleshed out for the demo artifact.
    const jpegBase64 = await renderFullPageJpegBase64(
      sourceBytes,
      sheet.pageNo,
      sheet.imageKey,
      blob,
    )
    const result = await extractFinishLegend({
      documentId: document.id,
      pageNo: sheet.pageNo,
      jpegBase64,
      textSnippet,
    })
    tokensIn += result.tokensIn
    tokensOut += result.tokensOut
    const visionFromStub = result.promptVersion.endsWith(STUB_SUFFIX)

    for (const row of result.rows) {
      if (!row.code) continue
      const code = row.code.trim().toUpperCase()
      if (code !== BATHROOM_SENTINEL && !LEGEND_CODE_RE.test(code)) {
        codesDroppedByRegex += 1
        continue
      }

      const existing = pendingByCode.get(code)
      if (existing) {
        // ENRICHER. Fill in fields the text pass left blank.
        let touched = false
        if (existing.material === null && row.material) {
          existing.material = row.material
          touched = true
        }
        if (existing.size === null && row.size) {
          existing.size = row.size
          touched = true
        }
        if (existing.finish === null && row.finish) {
          existing.finish = row.finish
          touched = true
        }
        if (existing.usage === null && row.usage) {
          existing.usage = row.usage
          touched = true
        }
        if (existing.legendKind === null && row.kind) {
          existing.legendKind = row.kind
          touched = true
        }
        if (existing.name === null && row.name) {
          existing.name = row.name
          existing.provenance.name = 'vision'
          touched = true
        }
        if (existing.description === null && row.name) {
          // Vision returns the *label* in `name`; the text-layer's
          // "description" column is sometimes blank on FN0x codes. Use
          // vision's name as a fallback description rather than leaving
          // both empty.
          existing.description = row.name
          existing.provenance.description = 'vision'
          touched = true
        }
        if (touched) visionEnrichedRows += 1
      } else if (needsVisionFallback) {
        // FALLBACK. The text layer was empty — accept vision's row as
        // primary and tag it appropriately.
        pendingByCode.set(code, {
          code,
          name: row.name ?? null,
          description: row.name ?? null,
          detail: null,
          legendKind: row.kind ?? null,
          material: row.material ?? null,
          size: row.size ?? null,
          finish: row.finish ?? null,
          usage: row.usage ?? null,
          sheetId: sheet.id,
          sourceNote: `${sheet.drawingNo ?? `page ${sheet.pageNo}`} (legend, vision fallback)`,
          sourceDrawingNo: sheet.drawingNo,
          provenance: { code: 'vision', name: row.name ? 'vision' : null, description: row.name ? 'vision' : null },
          stubVision: visionFromStub,
        })
        visionHits += 1
      } else {
        // Vision saw a code the text layer didn't — usually a hallucination
        // on a vector PDF. We ignore it but count it so the run report
        // reflects the gap.
        visionHits += 1
      }
    }
  }

  // PERSIST PHASE. One DB write per unique code, with idempotency.
  for (const row of pendingByCode.values()) {
    allCodes.add(row.code)

    const existing = await prisma.takeoffItem.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        deletedAt: null,
        tag: row.code,
      },
      select: { id: true },
    })

    const meta: Record<string, unknown> = {
      kind: 'LEGEND',
      code: row.code,
      name: row.name,
      material: row.material,
      size: row.size,
      finish: row.finish,
      usage: row.usage,
      legendKind: row.legendKind,
      detail: row.detail,
      provenance: row.provenance,
    }
    if (row.stubVision) meta.stub = true

    const category = categoryFor(row.legendKind)
    const description = `${row.code} — ${row.name ?? row.description ?? ''}${row.material ? `, ${row.material}` : ''}${row.size ? `, ${row.size}` : ''}${row.finish ? `, ${row.finish}` : ''}`
      .replace(/, +$/, '')

    if (existing) {
      await prisma.takeoffItem.update({
        where: { id: existing.id },
        data: {
          category,
          description,
          meta: meta as Prisma.JsonObject,
          promptVersion: 'extractFinishLegend.text-first.v1',
          sourceSheetId: row.sheetId,
          sourceNote: row.sourceNote,
        },
      })
    } else {
      await prisma.takeoffItem.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          category,
          tag: row.code,
          description,
          unit: 'm²',
          basis: 'PLACEHOLDER',
          confidence: row.provenance.code === 'text-layer' ? 95 : 80,
          sourceSheetId: row.sheetId,
          sourceNote: row.sourceNote,
          meta: meta as Prisma.JsonObject,
          promptVersion: 'extractFinishLegend.text-first.v1',
          status: 'EDITED',
        },
      })
      legendRowsCreated += 1
    }
  }

  // S7-2 sanity range. Outside 8-25 codes raises an ERROR flag pinned to the
  // project (no takeoffItemId). Idempotent.
  const realCodes = allCodes.size - (allCodes.has(BATHROOM_SENTINEL) ? 1 : 0)
  if (realCodes < LEGEND_MIN_CODES || realCodes > LEGEND_MAX_CODES) {
    const message = `Legend extraction returned ${realCodes} codes — outside sanity range ${LEGEND_MIN_CODES}-${LEGEND_MAX_CODES}. Likely an extraction quality miss; review the I4xx sheets.`
    await upsertValidationFlag({
      client: prisma,
      organizationId: job.organizationId,
      projectId: document.projectId,
      rule: 'LEGEND_SANITY',
      severity: 'ERROR',
      message,
    })
  }

  if (tokensIn > 0 || tokensOut > 0) {
    await prisma.usage.upsert({
      where: { organizationId: job.organizationId },
      create: { organizationId: job.organizationId, tokensIn, tokensOut },
      update: { tokensIn: { increment: tokensIn }, tokensOut: { increment: tokensOut } },
    })
  }

  // S7-1: chain handoff no-op guard. If SCHEDULES already DONE for this
  // doc, do NOT re-enqueue (Sprint-6 LEGEND retry would have doubled
  // every door without this guard).
  await enqueueIfNotDone({
    client: prisma,
    organizationId: job.organizationId,
    projectId: document.projectId,
    type: 'EXTRACT_SCHEDULES',
    documentId: document.id,
  })

  return {
    ok: true,
    documentId: document.id,
    legendSheets: sheets.length,
    legendSheetsAnchored: anchoredCount,
    legendFallbackUsed: usedFallback,
    legendRowsCreated,
    legendCodes: Array.from(allCodes).sort(),
    codesDroppedByRegex,
    /** S8-1: codes sourced from the text-layer pass. */
    textLayerHits,
    /** S8-1: codes vision newly contributed (fallback path). */
    visionHits,
    /** S8-1: rows where vision filled in missing name/material/etc. */
    visionEnrichedRows,
    sanityWithinRange: realCodes >= LEGEND_MIN_CODES && realCodes <= LEGEND_MAX_CODES,
    tokensIn,
    tokensOut,
  }
}
