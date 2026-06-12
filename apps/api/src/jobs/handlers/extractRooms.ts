/**
 * EXTRACT_ROOMS — Sprint 2 → Sprint 4 final pipeline stage.
 *
 *   payload = { documentId }
 *
 * Sprint-4 vision quality fix (S4-3): for every plan / finish_plan sheet,
 * we re-render at 220 DPI and TILE the page into 4 OVERLAPPING quadrants.
 * Each quadrant gets its own vision pass — `extractRooms.v1` reads them as
 * 4 separate images. Results are merged + deduped before reconciliation
 * against the text pass.
 *
 * Why: A1 plan tag text is ~1.5 mm tall. At Sprint-2's 110 DPI INGEST
 * resolution that's ~6 pixels — Sonnet can't read it. At 220 DPI full-page
 * the image exceeds Anthropic's size budget. Quadrant tiling at 220 DPI
 * gives 4 reads of ~half the page each, all inside the budget, all
 * readable. Tokens go up ~3-4× on the affected sheets only; the Sprint-3
 * crown-evidence budget held for that.
 *
 * Then sync into Spaces with source='takeoff'. Manual-source Spaces are NEVER
 * touched — humans win. If a manual Space already exists with the same name
 * for the project, we skip creating a takeoff Space for that name. (The
 * takeoff TakeoffItem is still recorded so the review surface has it.)
 *
 * On completion, set Document.status = READY — the pipeline's terminal stage.
 */
import type { Prisma } from '@prisma/client'
import { STUB_SUFFIX, extractRooms } from '../../ai/anthropic'
import { renderPageBbox } from '../../ai/bboxRender'
import { normalizeFloor } from '../../ai/floorNormalize'
import { renderPageQuadrants } from '../../ai/quadrantRender'
import { parseBboxRoomAreaPairs } from '../../ai/roomsBboxParser'
import { roomsTextPass } from '../../ai/roomsTextPass'
import type { ExtractRoomsRow } from '../../ai/types'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import { runValidators, type ValidatorContext } from '../validators'
import type { JobHandler, JobRecord } from '../types'

interface ExtractRoomsPayload {
  documentId: string
}

const ROOM_SHEET_TYPES = ['plan', 'finish_plan']
const RULE_ROW_MISMATCH = 'ROW_MISMATCH'

interface ReconciledRoom {
  name: string
  code: string | null
  floor: string | null
  area_m2: number | null
  finish_code: string | null
  basis: 'MEASURED' | 'VISUAL' | 'PARAMETRIC'
  confidence: number
  mismatch: null | { field: string; vision: unknown; text: unknown }
}

function compareNumeric(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b
  // ±2% tolerance per DoD 4. Spec calls room areas as MEASURED at this rate.
  const tolerance = Math.max(Math.abs(a), Math.abs(b)) * 0.02
  return Math.abs(a - b) <= tolerance
}

/**
 * Sprint-7 S7-3: deterministic finish_code assignment.
 *
 * The vision pass stores its raw observation in meta.rawFinishObservation —
 * vision-reported code (whether or not it's in the active legend vocabulary)
 * plus the model's evidence sentence plus a slice of the text snippet at
 * that moment. This function maps that raw observation to a finish_code
 * from the CURRENT legend vocabulary, without re-billing vision. Callers
 * (the rooms handler at extraction time, and the /remap endpoint later)
 * use the same function so a legend update can re-key every room for $0.
 *
 * Priority:
 *   1. Vision's chosen code matches a legend code exactly → 70 conf.
 *   2. Vision's chosen code substring-appears in textSnippet → 85 conf.
 *   3. Any legend code substring-appears in the evidence sentence → 70 conf.
 *   4. Any legend code substring-appears in the textSnippetSlice → 70 conf.
 *   5. None → null (FINISH_UNMAPPED flag raised by the handler).
 */
export interface RawFinishObservation {
  visionCode: string | null
  evidence: string | null
  textSnippetSlice: string | null
}

export function assignFinishCode(
  raw: RawFinishObservation,
  legendCodes: string[],
  textSnippet: string,
): { finishCode: string | null; finishConfidence: number | null } {
  const vocab = new Set(legendCodes.map((c) => c.toUpperCase()))
  const visionCode = (raw.visionCode ?? '').trim().toUpperCase()
  if (visionCode && vocab.has(visionCode)) {
    const re = new RegExp(`\\b${visionCode}\\b`)
    return { finishCode: visionCode, finishConfidence: re.test(textSnippet) ? 85 : 70 }
  }
  const evidence = (raw.evidence ?? '').toUpperCase()
  for (const code of vocab) {
    if (code === 'BATHROOM') continue
    const re = new RegExp(`\\b${code}\\b`)
    if (re.test(evidence)) return { finishCode: code, finishConfidence: 70 }
  }
  const slice = (raw.textSnippetSlice ?? '').toUpperCase()
  for (const code of vocab) {
    if (code === 'BATHROOM') continue
    const re = new RegExp(`\\b${code}\\b`)
    if (re.test(slice)) return { finishCode: code, finishConfidence: 70 }
  }
  return { finishCode: null, finishConfidence: null }
}

/**
 * Sprint-7 S7-3: pure-function re-map driver. Loads ROOM items + LEGEND
 * items for a project, runs assignFinishCode against the current legend
 * vocabulary, and persists. Re-runnable for $0; called by the
 * POST /api/projects/:id/remap-finishes endpoint.
 */
export interface RemapFinishesResult {
  rooms: number
  newlyMapped: number
  changedCode: number
  unchanged: number
  stillUnmapped: number
}

export async function remapFinishesForProject(
  organizationId: string,
  projectId: string,
): Promise<RemapFinishesResult> {
  // Legend items always have a tag (the code itself). Rooms typically don't,
  // so we have to query them separately — the old combined query with
  // `tag: { not: null }` accidentally excluded every room.
  const [legendItems, rooms] = await Promise.all([
    prisma.takeoffItem.findMany({
      where: { organizationId, projectId, deletedAt: null, tag: { not: null } },
      select: { id: true, category: true, tag: true, meta: true },
    }),
    prisma.takeoffItem.findMany({
      where: { organizationId, projectId, deletedAt: null, category: 'ROOM' },
      select: { id: true, category: true, tag: true, meta: true },
    }),
  ])
  const legendCodes = legendItems
    .filter((i) => {
      const m = (i.meta ?? {}) as Record<string, unknown>
      return m.kind === 'LEGEND'
    })
    .map((i) => i.tag!)
    .concat(['BATHROOM'])
  let newlyMapped = 0
  let changedCode = 0
  let unchanged = 0
  let stillUnmapped = 0
  for (const r of rooms) {
    const m = (r.meta ?? {}) as Record<string, unknown>
    const raw = (m.rawFinishObservation ?? null) as RawFinishObservation | null
    if (!raw) {
      // Pre-Sprint-7 data lacks the raw observation; we synthesise it from
      // whatever meta we DO have. That's enough to surface ROOMs whose
      // evidence string happens to mention a legend code.
      const evidence = typeof m.finish_evidence === 'string' ? m.finish_evidence : null
      const visionCode = typeof m.finish_code === 'string' ? m.finish_code : null
      const synth: RawFinishObservation = {
        visionCode,
        evidence,
        textSnippetSlice: null,
      }
      const { finishCode, finishConfidence } = assignFinishCode(synth, legendCodes, '')
      const before = m.finish_code as string | null
      if (finishCode && finishCode !== before) {
        if (before == null) newlyMapped += 1
        else changedCode += 1
        await prisma.takeoffItem.update({
          where: { id: r.id },
          data: {
            meta: { ...m, finish_code: finishCode, finishConfidence } as Prisma.JsonObject,
          },
        })
      } else if (finishCode == null) {
        stillUnmapped += 1
      } else {
        unchanged += 1
      }
      continue
    }
    const { finishCode, finishConfidence } = assignFinishCode(raw, legendCodes, '')
    const before = m.finish_code as string | null
    if (finishCode === before) {
      if (finishCode == null) stillUnmapped += 1
      else unchanged += 1
      continue
    }
    if (before == null) newlyMapped += 1
    else changedCode += 1
    await prisma.takeoffItem.update({
      where: { id: r.id },
      data: { meta: { ...m, finish_code: finishCode, finishConfidence } as Prisma.JsonObject },
    })
  }
  return { rooms: rooms.length, newlyMapped, changedCode, unchanged, stillUnmapped }
}

/**
 * Sprint-4 S4-3: 4 quadrant vision passes can each return the same room
 * (overlap region). Within a SINGLE sheet, collapse rows with the same
 * normalized name. Prefer the row that has `area_m2` populated over the one
 * without; otherwise prefer the row that has a code over one that doesn't.
 */
function dedupeBySheet(rows: ExtractRoomsRow[]): ExtractRoomsRow[] {
  const byName = new Map<string, ExtractRoomsRow>()
  for (const row of rows) {
    const key = row.name.trim().toUpperCase()
    if (!key) continue
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, row)
      continue
    }
    const score = (r: ExtractRoomsRow) =>
      (r.area_m2 !== null ? 2 : 0) + (r.code !== null ? 1 : 0)
    if (score(row) > score(existing)) byName.set(key, row)
  }
  return Array.from(byName.values())
}

/**
 * Sprint-7 S7-4: merge bbox-spatial pairs into the regex-text input. Spatial
 * pairs are pixel-accurate (xMin/yMin straight from pdftotext) and outrank
 * the line-window regex on numeric conflict. Same-name dedupe is
 * case-insensitive; ties on identical (name, area) collapse to one row.
 */
function mergeSpatialIntoText(
  regex: ExtractRoomsRow[],
  spatial: ReturnType<typeof parseBboxRoomAreaPairs>,
): ExtractRoomsRow[] {
  const byName = new Map<string, ExtractRoomsRow>()
  for (const r of regex) byName.set(r.name.trim().toUpperCase(), r)
  for (const p of spatial) {
    const key = p.name.trim().toUpperCase()
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, {
        name: p.name.trim(),
        code: null,
        floor: null,
        area_m2: p.area_m2,
        finish_code: null,
        finish_evidence: null,
      })
      continue
    }
    // Spatial wins on area; preserve other fields the regex pass may have set.
    byName.set(key, { ...existing, area_m2: p.area_m2 })
  }
  return Array.from(byName.values())
}

function reconcile(vision: ExtractRoomsRow[], text: ExtractRoomsRow[]): ReconciledRoom[] {
  const visionMap = new Map(vision.map((r) => [r.name, r]))
  const textMap = new Map(text.map((r) => [r.name, r]))
  const names = new Set<string>([...visionMap.keys(), ...textMap.keys()])
  const out: ReconciledRoom[] = []
  for (const name of names) {
    const v = visionMap.get(name)
    const t = textMap.get(name)
    if (v && t) {
      const mismatch = !compareNumeric(v.area_m2, t.area_m2)
        ? { field: 'area_m2', vision: v.area_m2, text: t.area_m2 }
        : null
      out.push({
        name,
        code: v.code ?? t.code,
        floor: v.floor ?? t.floor,
        area_m2: v.area_m2 ?? t.area_m2,
        finish_code: v.finish_code ?? t.finish_code,
        basis: 'MEASURED',
        confidence: mismatch ? 60 : 90,
        mismatch,
      })
    } else if (v) {
      out.push({
        name,
        code: v.code,
        floor: v.floor,
        area_m2: v.area_m2,
        finish_code: v.finish_code,
        basis: 'VISUAL',
        confidence: 70,
        mismatch: null,
      })
    } else if (t) {
      out.push({
        name,
        code: t.code,
        floor: t.floor,
        area_m2: t.area_m2,
        finish_code: t.finish_code,
        basis: 'PARAMETRIC',
        confidence: 50,
        mismatch: null,
      })
    }
  }
  return out
}

export const extractRoomsHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as ExtractRoomsPayload
  if (!payload.documentId) throw new Error('EXTRACT_ROOMS: payload.documentId required')

  const document = await prisma.document.findFirst({
    where: { id: payload.documentId, organizationId: job.organizationId },
  })
  if (!document) throw new Error(`EXTRACT_ROOMS: document ${payload.documentId} not found`)

  const sheets = await prisma.sheet.findMany({
    where: {
      documentId: document.id,
      organizationId: job.organizationId,
      sheetType: { in: ROOM_SHEET_TYPES },
    },
    orderBy: { pageNo: 'asc' },
  })

  const blob = getBlobStore()
  // Load the source PDF once — every plan/finish_plan sheet needs it for the
  // quadrant render.
  const sourceBytes = sheets.length > 0 ? await blob.get(document.storageKey) : Buffer.alloc(0)

  // S6-2: load the legend codes EXTRACT_FINISH_LEGEND has already saved as
  // TakeoffItems with meta.kind='LEGEND'. The list seeds the closed-vocab
  // for finish_code on each room. 'BATHROOM' is the per-bathroom-drawings
  // sentinel and is always offered alongside the real codes.
  const legendItems = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      deletedAt: null,
      tag: { not: null },
    },
    select: { tag: true, meta: true },
  })
  const legendCodes = Array.from(
    new Set(
      legendItems
        .filter((i) => {
          const m = (i.meta ?? {}) as Record<string, unknown>
          return m.kind === 'LEGEND'
        })
        .map((i) => i.tag!)
        .concat(['BATHROOM']),
    ),
  )

  let tokensIn = 0
  let tokensOut = 0
  let itemsCreated = 0
  let spacesUpserted = 0
  let manualSkipped = 0
  let mismatches = 0
  let quadrantsRendered = 0
  // S7-4 (the Area Gate): aggregate of name|area pairs the spatial parser
  // recovered from pdftotext -bbox-layout. Counted per-sheet AND collated so
  // the run report tells the reviewer how many drawn-area rooms we
  // grounded against the architect's printed labels — a gate the prior
  // regex-and-vision-only pipeline kept failing.
  let bboxPairsTotal = 0
  const bboxPairsBySheet: Array<{ pageNo: number; pairs: number }> = []

  for (const sheet of sheets) {
    const textSnippet = sheet.rawTextKey
      ? (await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')).slice(0, 4000)
      : ''

    // S4-3: render 4 overlapping quadrants at 220 DPI. Each quadrant gets its
    // own vision pass. Failures fall back to the original full-page jpeg
    // produced by INGEST at 110 DPI — a degraded but non-broken path.
    let quadrants: Awaited<ReturnType<typeof renderPageQuadrants>> = []
    try {
      quadrants = await renderPageQuadrants(sourceBytes, sheet.pageNo, { dpi: 220, overlapPct: 0.1 })
    } catch (err) {
      // Don't kill the job for one bad render.
      console.error(`[extractRooms] quadrant render failed for page ${sheet.pageNo}:`, err)
    }

    const visionRows: ExtractRoomsRow[] = []
    let promptVersion = ''
    if (quadrants.length === 4) {
      quadrantsRendered += 4
      for (const q of quadrants) {
        const r = await extractRooms({
          documentId: document.id,
          pageNo: sheet.pageNo,
          jpegBase64: q.base64,
          textSnippet,
          legendCodes,
        })
        tokensIn += r.tokensIn
        tokensOut += r.tokensOut
        promptVersion = r.promptVersion
        visionRows.push(...r.rows)
      }
    } else {
      // Fallback: full-page image at INGEST DPI. Degraded but non-broken.
      const fallback = sheet.imageKey
        ? await blob.get(sheet.imageKey).then((b) => b.toString('base64')).catch(() => null)
        : null
      const r = await extractRooms({
        documentId: document.id,
        pageNo: sheet.pageNo,
        jpegBase64: fallback,
        textSnippet,
        legendCodes,
      })
      tokensIn += r.tokensIn
      tokensOut += r.tokensOut
      promptVersion = r.promptVersion
      visionRows.push(...r.rows)
    }

    // Within-sheet dedupe across the 4 quadrants (a room straddling the center
    // is captured twice). Keep the row with `area_m2` populated over the one
    // without.
    const merged = dedupeBySheet(visionRows)

    // S7-4 spatial pass. Run pdftotext -bbox-layout for this page, build
    // name|area pairs from physical proximity, and merge them into the
    // text-side input. Bbox pairs are pixel-accurate ground truth from the
    // drawing — they outrank regex pairs on numeric conflict. Failures are
    // soft (drawings without a text layer, etc.) — the regex/vision passes
    // still run.
    const regexText = roomsTextPass(textSnippet, sheet.pageNo)
    let spatialPairs: ReturnType<typeof parseBboxRoomAreaPairs> = []
    try {
      const bbox = await renderPageBbox(sourceBytes, sheet.pageNo)
      spatialPairs = parseBboxRoomAreaPairs(bbox)
    } catch (err) {
      console.error(`[extractRooms] bbox render failed for page ${sheet.pageNo}:`, err)
    }
    bboxPairsTotal += spatialPairs.length
    bboxPairsBySheet.push({ pageNo: sheet.pageNo, pairs: spatialPairs.length })
    const text = mergeSpatialIntoText(regexText, spatialPairs)
    const reconciled = reconcile(merged, text)
    const visionFromStub = promptVersion.endsWith(STUB_SUFFIX)

    for (const room of reconciled) {
      const normalizedFloor = normalizeFloor(room.floor)
      // S7-3: store the RAW observation from the vision pass — independent
      // of whatever legend vocabulary happened to be in effect at the time.
      // assignFinishCode() reads rawFinishObservation in a deterministic
      // post-map; re-running the legend stage no longer requires re-running
      // the rooms vision pass to update finish_code.
      const visionRow = merged.find(
        (r) => r.name.trim().toUpperCase() === room.name.trim().toUpperCase(),
      )
      const rawFinishObservation = {
        visionCode: visionRow?.finish_code ?? null,
        evidence: visionRow?.finish_evidence ?? null,
        textSnippetSlice: textSnippet.slice(0, 600),
      }

      const { finishCode, finishConfidence } = assignFinishCode(
        rawFinishObservation,
        legendCodes,
        textSnippet,
      )

      const meta: Record<string, unknown> = {
        code: room.code,
        floor: room.floor,
        floorNormalized: normalizedFloor,
        area_m2: room.area_m2,
        finish_code: finishCode,
        finishConfidence,
        finish_evidence: rawFinishObservation.evidence,
        rawFinishObservation,
      }
      if (visionFromStub) meta.stub = true
      const takeoff = await prisma.takeoffItem.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          category: 'ROOM',
          tag: room.code,
          description: `${room.name}${normalizedFloor ? ` — ${normalizedFloor}` : ''}`,
          unit: 'm²',
          qtyAi: room.area_m2 ?? undefined,
          basis: room.basis,
          confidence: room.confidence,
          sourceSheetId: sheet.id,
          sourceNote: sheet.drawingNo ?? `page ${sheet.pageNo}`,
          meta: meta as object,
          promptVersion,
        },
      })
      itemsCreated += 1

      if (room.mismatch) {
        mismatches += 1
        await prisma.validationFlag.create({
          data: {
            organizationId: job.organizationId,
            projectId: document.projectId,
            takeoffItemId: takeoff.id,
            rule: RULE_ROW_MISMATCH,
            severity: 'ERROR',
            message: `ROOM ${room.name}: ${room.mismatch.field} disagrees (vision=${room.mismatch.vision}, text=${room.mismatch.text}).`,
          },
        })
      }

      // S6-2: rooms the model couldn't label get an INFO flag so the human
      // reviewer surfaces them quickly. We don't fail the run.
      if (finishCode === null) {
        await prisma.validationFlag.create({
          data: {
            organizationId: job.organizationId,
            projectId: document.projectId,
            takeoffItemId: takeoff.id,
            rule: 'FINISH_UNMAPPED',
            severity: 'INFO',
            message: `ROOM ${room.name}${normalizedFloor ? ` (${normalizedFloor})` : ''}: no finish_code assigned. Likely needs human review.`,
          },
        })
      }
    }
  }

  // ---------------------------------------------------------------------
  // S4-4 cross-sheet dedupe + Spaces sync from the deduped set.
  //
  // The same room frequently appears on plan + finish_plan + RCP sheets.
  // Group by (normalizedName, normalizedFloor) and keep the row with the
  // best score: area populated > no area, code populated > no code, higher
  // confidence wins ties. Losers are soft-deleted.
  // ---------------------------------------------------------------------
  const allRoomItems = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      category: 'ROOM',
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  })
  const groups = new Map<string, typeof allRoomItems>()
  for (const item of allRoomItems) {
    const m = (item.meta ?? {}) as Record<string, unknown>
    const name = item.description.split('—')[0]!.trim().toUpperCase()
    const floor =
      (typeof m.floorNormalized === 'string' && m.floorNormalized) ||
      normalizeFloor(typeof m.floor === 'string' ? m.floor : null) ||
      '∅'
    const key = `${name}|${floor}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(item)
    else groups.set(key, [item])
  }
  const survivors: typeof allRoomItems = []
  let collapsedRoomDuplicates = 0
  for (const [, items] of groups) {
    if (items.length === 1) {
      survivors.push(items[0]!)
      continue
    }
    const score = (i: (typeof allRoomItems)[number]) =>
      (i.qtyAi !== null ? 4 : 0) + (i.tag !== null ? 2 : 0) + i.confidence / 100
    const sorted = items.slice().sort((a, b) => score(b) - score(a))
    survivors.push(sorted[0]!)
    const losers = sorted.slice(1)
    if (losers.length > 0) {
      await prisma.takeoffItem.updateMany({
        where: { id: { in: losers.map((l) => l.id) } },
        data: { deletedAt: new Date() },
      })
      collapsedRoomDuplicates += losers.length
    }
  }

  // Spaces sync — runs ONLY over the survivors. Manual-source Spaces win.
  for (const survivor of survivors) {
    const m = (survivor.meta ?? {}) as Record<string, unknown>
    const name = survivor.description.split('—')[0]!.trim()
    const areaM2 = survivor.qtyAi === null ? null : Number(survivor.qtyAi.toString())
    const floor =
      (typeof m.floorNormalized === 'string' && m.floorNormalized) ||
      (typeof m.floor === 'string' ? m.floor : null)
    const code = typeof m.code === 'string' ? m.code : survivor.tag

    const manual = await prisma.space.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        name,
        source: 'manual',
        deletedAt: null,
      },
      select: { id: true },
    })
    if (manual) {
      manualSkipped += 1
      continue
    }
    const side = Math.max(0.1, Math.sqrt(areaM2 ?? 1))
    const existing = await prisma.space.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        name,
        source: 'takeoff',
        deletedAt: null,
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.space.update({
        where: { id: existing.id },
        data: {
          code,
          floor,
          areaM2: areaM2 ?? null,
          confidence: survivor.confidence,
          length: side,
          width: side,
        },
      })
    } else {
      await prisma.space.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          name,
          length: side,
          width: side,
          height: 3,
          code,
          floor,
          areaM2: areaM2 ?? null,
          source: 'takeoff',
          confidence: survivor.confidence,
        },
      })
    }
    spacesUpserted += 1
  }

  // ---------------------------------------------------------------------
  // S4-5 validation net. Pure-TS validators on the final takeoff state.
  // ---------------------------------------------------------------------
  const [project, doors, windows, planSheets] = await Promise.all([
    prisma.project.findUnique({
      where: { id: document.projectId },
      select: { type: true },
    }),
    prisma.takeoffItem.findMany({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        category: 'DOOR',
        deletedAt: null,
      },
      select: { id: true, category: true, tag: true, meta: true },
    }),
    prisma.takeoffItem.findMany({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        category: 'WINDOW',
        deletedAt: null,
      },
      select: { id: true, category: true, tag: true, meta: true },
    }),
    prisma.sheet.findMany({
      where: {
        documentId: document.id,
        organizationId: job.organizationId,
        sheetType: { in: ['plan', 'finish_plan', 'rcp', 'elevation'] },
        rawTextKey: { not: null },
      },
      select: { rawTextKey: true },
    }),
  ])
  let planTextBlob = ''
  for (const s of planSheets) {
    if (!s.rawTextKey) continue
    const t = await blob.get(s.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')
    planTextBlob += `\n${t}`
  }
  const validatorCtx: ValidatorContext = {
    projectType: project?.type ?? null,
    doors,
    windows,
    planTextBlob,
  }
  const validatorResults = runValidators(validatorCtx)
  for (const r of validatorResults) {
    // Don't double-write the same flag if a previous run already raised it.
    const existing = await prisma.validationFlag.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        rule: r.rule,
        takeoffItemId: r.takeoffItemId ?? null,
        message: r.message,
        resolved: false,
      },
      select: { id: true },
    })
    if (existing) continue
    await prisma.validationFlag.create({
      data: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        takeoffItemId: r.takeoffItemId ?? null,
        rule: r.rule,
        severity: r.severity,
        message: r.message,
      },
    })
  }

  if (tokensIn > 0 || tokensOut > 0) {
    await prisma.usage.upsert({
      where: { organizationId: job.organizationId },
      create: { organizationId: job.organizationId, tokensIn, tokensOut },
      update: {
        tokensIn: { increment: tokensIn },
        tokensOut: { increment: tokensOut },
      },
    })
  }

  // Terminal stage of the pipeline — mark the document READY.
  await prisma.document.update({
    where: { id: document.id },
    data: { status: 'READY' },
  })

  return {
    ok: true,
    documentId: document.id,
    roomsProcessed: itemsCreated,
    /** Sprint-4 S4-4: rooms that survived the cross-sheet dedupe pass. */
    deduplicatedSurvivors: itemsCreated - collapsedRoomDuplicates,
    /** Sprint-4 S4-4: per-project duplicate ROOM rows collapsed. */
    collapsedRoomDuplicates,
    spacesUpserted,
    manualSpacesSkipped: manualSkipped,
    rowMismatches: mismatches,
    quadrantsRendered,
    /** Sprint-7 S7-4: total spatial (bbox) name|area pairs recovered. */
    bboxPairsTotal,
    /** Sprint-7 S7-4: per-sheet spatial pair counts (for diagnostics). */
    bboxPairsBySheet,
    /** Sprint-4 S4-5: validation flags raised by the post-extraction net. */
    validatorFlagsRaised: validatorResults.length,
    tokensIn,
    tokensOut,
  }
}
