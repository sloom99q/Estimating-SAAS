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
import { renderPageQuadrants } from '../../ai/quadrantRender'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import type { JobHandler, JobRecord } from '../types'

interface ExtractFinishLegendPayload {
  documentId: string
}

const LEGEND_SHEET_TYPES = ['finish_plan', 'legend'] as const

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

  const sheets = await prisma.sheet.findMany({
    where: {
      documentId: document.id,
      organizationId: job.organizationId,
      sheetType: { in: [...LEGEND_SHEET_TYPES] },
    },
    orderBy: { pageNo: 'asc' },
  })

  const blob = getBlobStore()
  const sourceBytes = sheets.length > 0 ? await blob.get(document.storageKey) : Buffer.alloc(0)

  let tokensIn = 0
  let tokensOut = 0
  let legendRowsCreated = 0
  const allCodes = new Set<string>()

  for (const sheet of sheets) {
    const jpegBase64 = await renderFullPageJpegBase64(
      sourceBytes,
      sheet.pageNo,
      sheet.imageKey,
      blob,
    )
    const textSnippet = sheet.rawTextKey
      ? (await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')).slice(0, 4000)
      : ''

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
      if (allCodes.has(code)) continue
      allCodes.add(code)

      // Idempotent: a previous pipeline run on the same project may have
      // already persisted this legend code. Update in place, don't duplicate.
      const existing = await prisma.takeoffItem.findFirst({
        where: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          deletedAt: null,
          tag: code,
        },
        select: { id: true, meta: true },
      })

      const meta: Record<string, unknown> = {
        kind: 'LEGEND',
        code,
        name: row.name,
        material: row.material,
        size: row.size,
        finish: row.finish,
        usage: row.usage,
        legendKind: row.kind,
      }
      if (visionFromStub) meta.stub = true

      const category = categoryFor(row.kind)
      const description = `${code} — ${row.name ?? ''}${row.material ? `, ${row.material}` : ''}${row.size ? `, ${row.size}` : ''}${row.finish ? `, ${row.finish}` : ''}`
        .replace(/, +$/, '')

      if (existing) {
        await prisma.takeoffItem.update({
          where: { id: existing.id },
          data: {
            category,
            description,
            meta: meta as Prisma.JsonObject,
            promptVersion: result.promptVersion,
          },
        })
      } else {
        await prisma.takeoffItem.create({
          data: {
            organizationId: job.organizationId,
            projectId: document.projectId,
            category,
            tag: code,
            description,
            unit: 'm²', // legend rows are reference-only; unit is informational
            basis: 'PLACEHOLDER',
            confidence: 80,
            sourceSheetId: sheet.id,
            sourceNote: `${sheet.drawingNo ?? `page ${sheet.pageNo}`} (legend)`,
            meta: meta as Prisma.JsonObject,
            promptVersion: result.promptVersion,
            status: 'EDITED',
          },
        })
        legendRowsCreated += 1
      }
    }
  }

  if (tokensIn > 0 || tokensOut > 0) {
    await prisma.usage.upsert({
      where: { organizationId: job.organizationId },
      create: { organizationId: job.organizationId, tokensIn, tokensOut },
      update: { tokensIn: { increment: tokensIn }, tokensOut: { increment: tokensOut } },
    })
  }

  // Chain → EXTRACT_SCHEDULES.
  await prisma.job.create({
    data: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      type: 'EXTRACT_SCHEDULES',
      payload: { documentId: document.id } as object,
    },
  })

  return {
    ok: true,
    documentId: document.id,
    legendSheets: sheets.length,
    legendRowsCreated,
    legendCodes: Array.from(allCodes).sort(),
    tokensIn,
    tokensOut,
  }
}
