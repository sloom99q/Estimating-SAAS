/**
 * PARSE_DXF — DXF MVP one-shot handler.
 *
 *   payload = { documentId }
 *
 * Unlike the PDF chain (INGEST → CLASSIFY → LEGEND → SCHEDULES →
 * ROOMS), a DXF needs no AI calls and no per-stage chain — the
 * architect already structured the file. One pass extracts:
 *
 *   - ROOMs from MTEXT on the configured roomLabels layer:
 *     "GF-04 58.82 m²" + nearest "LIVING" → ROOM(tag=GF-04,
 *     description=LIVING, qtyAi=58.82, basis=MEASURED, conf=98).
 *
 *   - DOORs / WINDOWs from INSERT + nearest MTEXT tag on the
 *     configured doors/windows layers: D01 INSERT × N → DOOR
 *     (tag=D01, qtyAi=N, basis=MEASURED, conf=98).
 *
 * Why MEASURED + status=EDITED + confidence=98: the architect signed
 * the drawing with these numbers. They're not AI guesses — they're
 * the spec. The estimator can still edit if a number is wrong, but
 * the default is "trust the architect" and the BOQ generator's
 * APPROVED|EDITED filter admits them without a human round-trip.
 *
 * Multi-doc behaviour: upserts by (project, category, tag) — the
 * MULTI-DOC #3 natural key. Re-running PARSE_DXF on the same file
 * is idempotent; uploading a revised DXF overwrites. Cross-source
 * dedup (DXF vs vision) runs at the end via a basis-aware scoring
 * pass.
 *
 * On finish: Document.status → READY (no chain — terminal stage).
 */
import DxfParser from 'dxf-parser'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import { AIA_NCS_DEFAULT, type LayerMap } from '../../dxf/layerMap'
import {
  cleanMText,
  pairNearest,
  parseRoomLabel,
  parseTagLabel,
} from '../../dxf/textParse'
import { normalizeRoomName } from './extractRooms'
import { upsertValidationFlag } from '../validationFlagUpsert'
import type { JobHandler, JobRecord } from '../types'

interface PayloadShape {
  documentId: string
}

interface ParsedRoom {
  code: string
  name: string | null
  areaM2: number
  pairDistanceMm: number | null
  /** Position of the code+area label in modelspace. */
  x: number
  y: number
}

interface ParsedSchedule {
  category: 'DOOR' | 'WINDOW'
  tag: string
  count: number
  /** Block names the tag was inferred from (debug/audit). */
  blockNames: string[]
  /** True when the tag came from a MTEXT label vs the block name fallback. */
  tagSource: 'mtext' | 'block-name'
}

/**
 * Pick the first layer name in `candidates` that actually has entities
 * in the file's layer table. Returns null if none match — handler
 * falls back to AIA defaults, then emits a flag if still nothing.
 */
function pickLayer(
  candidates: string[] | undefined,
  presentLayers: Set<string>,
): string | null {
  if (!candidates) return null
  for (const c of candidates) {
    if (presentLayers.has(c)) return c
  }
  return null
}

/**
 * Extract rooms: walk MTEXT/TEXT on the roomLabels layer, classify,
 * pair code+area labels with nearest name labels by Euclidean distance.
 *
 * Returns: rows + median/max pair distance for the variance flag,
 * counts of unpaired code-area and name-only rows.
 */
function extractRooms(
  entities: Array<{ type: string; layer: string }>,
  roomLabelsLayer: string,
): {
  rooms: ParsedRoom[]
  unpairedCodes: number
  unpairedNames: Array<{ name: string; x: number; y: number }>
  unknownLabels: number
  medianPairDistanceMm: number | null
  maxPairDistanceMm: number | null
} {
  const codeRows: Array<{ x: number; y: number; code: string; areaM2: number; raw: string; clean: string }> = []
  const nameRows: Array<{ x: number; y: number; name: string; raw: string; clean: string }> = []
  let unknownCount = 0

  for (const e of entities) {
    if (e.layer !== roomLabelsLayer) continue
    if (e.type !== 'MTEXT' && e.type !== 'TEXT') continue
    const raw = String((e as { text?: string }).text ?? '')
    const clean = cleanMText(raw)
    const parsed = parseRoomLabel(clean)
    const pos = (e as { position?: { x: number; y: number } }).position ?? { x: 0, y: 0 }
    if (parsed.kind === 'code-area') {
      codeRows.push({ x: pos.x, y: pos.y, code: parsed.code, areaM2: parsed.areaM2, raw, clean })
    } else if (parsed.kind === 'name') {
      nameRows.push({ x: pos.x, y: pos.y, name: parsed.name, raw, clean })
    } else {
      unknownCount += 1
    }
  }

  // Pair code+area to nearest name (allow name reuse — the user may
  // edit later; for LAMI files it's always 1:1).
  const paired = pairNearest(codeRows, nameRows)
  const usedNameIdx = new Set<number>()
  const rooms: ParsedRoom[] = []
  for (const p of paired) {
    let bestIdx = -1
    if (p.b) bestIdx = nameRows.indexOf(p.b)
    if (bestIdx >= 0) usedNameIdx.add(bestIdx)
    rooms.push({
      code: p.a.code,
      name: p.b ? p.b.name : null,
      areaM2: p.a.areaM2,
      pairDistanceMm: p.b ? p.distance : null,
      x: p.a.x,
      y: p.a.y,
    })
  }

  const unpairedNames = nameRows
    .map((n, i) => ({ n, i }))
    .filter(({ i }) => !usedNameIdx.has(i))
    .map(({ n }) => ({ name: n.name, x: n.x, y: n.y }))

  const dists = rooms.map((r) => r.pairDistanceMm).filter((d): d is number => d !== null).sort((a, b) => a - b)
  const median = dists.length === 0 ? null : dists[Math.floor(dists.length / 2)] ?? null
  const max = dists.length === 0 ? null : dists[dists.length - 1] ?? null

  return {
    rooms,
    unpairedCodes: rooms.filter((r) => r.name === null).length,
    unpairedNames,
    unknownLabels: unknownCount,
    medianPairDistanceMm: median,
    maxPairDistanceMm: max,
  }
}

/**
 * Extract DOOR or WINDOW counts. Walks the chosen layer for INSERTs
 * (the symbols on the plan) and MTEXTs (the schedule tags placed next
 * to them), pairs each INSERT with its nearest TAG MTEXT, groups by
 * tag, counts.
 *
 * Falls back to block name when no MTEXT tag pairs within
 * `tagPairMaxMm` (default 1500 mm — ~1.5 architectural metres,
 * generous enough for tags placed alongside doors, tight enough that
 * a label on a different room doesn't get cross-matched).
 */
function extractSchedule(
  category: 'DOOR' | 'WINDOW',
  entities: Array<{ type: string; layer: string }>,
  layer: string,
  tagPairMaxMm = 1500,
): ParsedSchedule[] {
  const inserts: Array<{ x: number; y: number; blockName: string }> = []
  const tags: Array<{ x: number; y: number; tag: string }> = []

  for (const e of entities) {
    if (e.layer !== layer) continue
    if (e.type === 'INSERT') {
      const pos = (e as { position?: { x: number; y: number } }).position ?? { x: 0, y: 0 }
      const blockName = String((e as { name?: string }).name ?? '(unknown)')
      inserts.push({ x: pos.x, y: pos.y, blockName })
    } else if (e.type === 'MTEXT' || e.type === 'TEXT') {
      const raw = String((e as { text?: string }).text ?? '')
      const clean = cleanMText(raw)
      const t = parseTagLabel(clean)
      if (t.kind === 'tag') {
        const pos = (e as { position?: { x: number; y: number } }).position ?? { x: 0, y: 0 }
        tags.push({ x: pos.x, y: pos.y, tag: t.tag })
      }
    }
  }

  // For each INSERT, pick nearest tag within range; else fall back to block name.
  const groups = new Map<string, { count: number; blockNames: Set<string>; tagSource: 'mtext' | 'block-name' }>()
  for (const ins of inserts) {
    let bestTag: string | null = null
    let bestD = Infinity
    for (const t of tags) {
      const d = Math.hypot(ins.x - t.x, ins.y - t.y)
      if (d < bestD) {
        bestD = d
        bestTag = t.tag
      }
    }
    const tag = bestTag !== null && bestD <= tagPairMaxMm ? bestTag : ins.blockName
    const tagSource: 'mtext' | 'block-name' = bestTag !== null && bestD <= tagPairMaxMm ? 'mtext' : 'block-name'
    if (!groups.has(tag)) groups.set(tag, { count: 0, blockNames: new Set(), tagSource })
    const g = groups.get(tag)!
    g.count += 1
    g.blockNames.add(ins.blockName)
    // If any insert hits via MTEXT, prefer that source flag.
    if (tagSource === 'mtext') g.tagSource = 'mtext'
  }

  return [...groups.entries()].map(([tag, g]) => ({
    category,
    tag,
    count: g.count,
    blockNames: [...g.blockNames],
    tagSource: g.tagSource,
  }))
}

/**
 * The handler proper.
 */
export const parseDxfHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as PayloadShape
  const documentId = payload.documentId
  if (!documentId) throw new Error('PARSE_DXF: payload.documentId missing')

  // Load Document + Project (with layerMap).
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId: job.organizationId },
    select: {
      id: true,
      projectId: true,
      filename: true,
      storageKey: true,
      organizationId: true,
      project: { select: { layerMap: true } },
    },
  })
  if (!document) throw new Error(`PARSE_DXF: document ${documentId} not found`)

  // Project must have a layer map by now — the SPA modal enforces
  // save-before-enqueue. Defensive in case the route is called
  // directly.
  const rawMap = document.project?.layerMap as Partial<LayerMap> | null
  if (!rawMap) {
    throw new Error(
      `PARSE_DXF: project ${document.projectId} has no layerMap. Confirm the layer-map modal first.`,
    )
  }
  const layerMap: LayerMap = {
    roomBounds: rawMap.roomBounds ?? AIA_NCS_DEFAULT.roomBounds,
    roomLabels: rawMap.roomLabels ?? AIA_NCS_DEFAULT.roomLabels,
    doors: rawMap.doors ?? AIA_NCS_DEFAULT.doors,
    windows: rawMap.windows ?? AIA_NCS_DEFAULT.windows,
    walls: rawMap.walls ?? AIA_NCS_DEFAULT.walls,
    tagAttribs: rawMap.tagAttribs ?? AIA_NCS_DEFAULT.tagAttribs,
    minRoomAreaM2: rawMap.minRoomAreaM2 ?? AIA_NCS_DEFAULT.minRoomAreaM2,
    maxRoomAreaM2: rawMap.maxRoomAreaM2 ?? AIA_NCS_DEFAULT.maxRoomAreaM2,
  }

  // Mark Document PROCESSING so the multi-doc gate releases on
  // either READY or FAILED at the end.
  await prisma.document.update({
    where: { id: document.id },
    data: { status: 'PROCESSING' },
  })

  // Load + parse the blob.
  const blob = await getBlobStore().get(document.storageKey)
  const text = blob.toString('utf-8')
  const parsed = new DxfParser().parseSync(text)
  if (!parsed) {
    await prisma.document.update({
      where: { id: document.id },
      data: { status: 'FAILED' },
    })
    throw new Error('PARSE_DXF: dxf-parser returned null')
  }
  const insUnits =
    typeof parsed.header['$INSUNITS'] === 'number' ? (parsed.header['$INSUNITS'] as number) : null
  if (insUnits !== null && insUnits !== 4) {
    // Not mm — bail rather than emit areas in the wrong unit.
    await upsertValidationFlag({
      client: prisma,
      organizationId: job.organizationId,
      projectId: document.projectId,
      rule: 'DXF_UNITS_NOT_MM',
      severity: 'ERROR',
      message: `DXF $INSUNITS=${insUnits} (expected 4 = mm). Conversion not implemented — re-export the DWG with mm units or set $INSUNITS=4.`,
    })
    await prisma.document.update({
      where: { id: document.id },
      data: { status: 'FAILED' },
    })
    throw new Error(`PARSE_DXF: $INSUNITS=${insUnits}, only mm (4) supported`)
  }

  const presentLayers = new Set(Object.keys(parsed.tables?.layer?.layers ?? {}))
  const roomLabelsLayer = pickLayer(layerMap.roomLabels, presentLayers)
  const doorsLayer = pickLayer(layerMap.doors, presentLayers)
  const windowsLayer = pickLayer(layerMap.windows, presentLayers)

  // Ensure a Sheet row exists so TakeoffItem.sourceSheetId can point at
  // something. One sheet per DXF, pageNo=1, sheetType='dxf_plan'.
  // Idempotent re-runs: upsert by (documentId, pageNo).
  const sheet = await prisma.sheet.upsert({
    where: { documentId_pageNo: { documentId: document.id, pageNo: 1 } },
    create: {
      organizationId: job.organizationId,
      documentId: document.id,
      pageNo: 1,
      drawingNo: document.filename.replace(/\.dxf$/i, ''),
      title: document.filename,
      discipline: 'ARCH',
      sheetType: 'dxf_plan',
      hasTextLayer: true,
    },
    update: {
      drawingNo: document.filename.replace(/\.dxf$/i, ''),
      title: document.filename,
    },
  })

  // ROOMs
  const roomReport = roomLabelsLayer
    ? extractRooms(
        parsed.entities as Array<{ type: string; layer: string }>,
        roomLabelsLayer,
      )
    : { rooms: [], unpairedCodes: 0, unpairedNames: [], unknownLabels: 0, medianPairDistanceMm: null, maxPairDistanceMm: null }

  // Variance flag: if max pair distance > 5× median, the heuristic
  // may have mis-paired. Surface so the estimator double-checks.
  if (
    roomReport.medianPairDistanceMm !== null &&
    roomReport.maxPairDistanceMm !== null &&
    roomReport.medianPairDistanceMm > 0 &&
    roomReport.maxPairDistanceMm > 5 * roomReport.medianPairDistanceMm
  ) {
    await upsertValidationFlag({
      client: prisma,
      organizationId: job.organizationId,
      projectId: document.projectId,
      rule: 'DXF_LABEL_PAIR_VARIANCE_HIGH',
      severity: 'WARN',
      message: `DXF ${document.filename}: room-label pair distance varies a lot (median ${roomReport.medianPairDistanceMm.toFixed(0)}mm, max ${roomReport.maxPairDistanceMm.toFixed(0)}mm). Some rooms may be paired to the wrong name — verify in the review table.`,
    })
  }

  // No rooms found → emit "not a plan sheet" flag and exit cleanly.
  if (roomReport.rooms.length === 0 && roomLabelsLayer !== null) {
    await upsertValidationFlag({
      client: prisma,
      organizationId: job.organizationId,
      projectId: document.projectId,
      rule: 'DXF_NO_ROOMS_FOUND',
      severity: 'INFO',
      message: `DXF ${document.filename}: no rooms detected on layer "${roomLabelsLayer}". Likely an elevation / detail / RCP sheet — uploaded but no rooms to extract.`,
    })
  }

  let roomsCreated = 0
  let roomsUpdated = 0
  for (const r of roomReport.rooms) {
    const description =
      r.name && r.name.length > 0 ? r.name : '(unnamed)'
    const meta = {
      code: r.code,
      area_m2: r.areaM2,
      sourceFormat: 'DXF' as const,
      pairDistanceMm: r.pairDistanceMm,
      position: { x: r.x, y: r.y },
    }
    // Upsert by (project, category=ROOM, tag=code). Tags collide
    // cross-doc (GF-04 in A101 and A101-revised both refer to the
    // same room) — newest write wins per MULTI-DOC #3 verdict.
    const existing = await prisma.takeoffItem.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        deletedAt: null,
        category: 'ROOM',
        tag: r.code,
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.takeoffItem.update({
        where: { id: existing.id },
        data: {
          description,
          unit: 'm²',
          qtyAi: r.areaM2,
          basis: 'MEASURED',
          confidence: r.name ? 98 : 75,
          status: r.name ? 'EDITED' : 'AI',
          sourceSheetId: sheet.id,
          sourceNote: `DXF ${document.filename}`,
          meta: meta as object,
        },
      })
      roomsUpdated += 1
    } else {
      await prisma.takeoffItem.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          category: 'ROOM',
          tag: r.code,
          description,
          unit: 'm²',
          qtyAi: r.areaM2,
          basis: 'MEASURED',
          confidence: r.name ? 98 : 75,
          status: r.name ? 'EDITED' : 'AI',
          sourceSheetId: sheet.id,
          sourceNote: `DXF ${document.filename}`,
          meta: meta as object,
        },
      })
      roomsCreated += 1
    }
  }

  // DOORs / WINDOWs
  //
  // DXF MVP investigation (LM1929 test, 2026-06-24) — the LAMI window
  // layer (LAMI-A-GLAZ) has ZERO text labels and 1,441 INSERTs that
  // are curtain-wall PROFILES (76mm/78mm corrugated mullions), not
  // schedule entries. Counting INSERTs there returns garbage. The
  // window schedule lives on a separate sheet (I303 WINDOWS &
  // CURTAINS - GF.dxf), which the existing vision-based extraction
  // already handles correctly. So for MVP: skip windows in
  // PARSE_DXF, let vision keep ownership of the WINDOW category. If a
  // future firm's files DO put schedulable window tags on the plan
  // layer, the user can re-enable by flipping the constant or by
  // adding a per-project setting.
  const PARSE_DXF_EMIT_WINDOWS = false
  const doors = doorsLayer
    ? extractSchedule('DOOR', parsed.entities as Array<{ type: string; layer: string }>, doorsLayer)
    : []
  const windows: ParsedSchedule[] =
    PARSE_DXF_EMIT_WINDOWS && windowsLayer
      ? extractSchedule('WINDOW', parsed.entities as Array<{ type: string; layer: string }>, windowsLayer)
      : []
  let schedulesCreated = 0
  let schedulesUpdated = 0
  for (const s of [...doors, ...windows]) {
    const meta = {
      sourceFormat: 'DXF' as const,
      blockNames: s.blockNames,
      tagSource: s.tagSource,
    }
    const existing = await prisma.takeoffItem.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        deletedAt: null,
        category: s.category,
        tag: s.tag,
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.takeoffItem.update({
        where: { id: existing.id },
        data: {
          description: `${s.category === 'DOOR' ? 'Door' : 'Window'} ${s.tag}${s.tagSource === 'block-name' ? ' (block-name only)' : ''}`,
          unit: 'nr',
          qtyAi: s.count,
          basis: 'MEASURED',
          confidence: s.tagSource === 'mtext' ? 98 : 75,
          status: s.tagSource === 'mtext' ? 'EDITED' : 'AI',
          sourceSheetId: sheet.id,
          sourceNote: `DXF ${document.filename}`,
          meta: meta as object,
        },
      })
      schedulesUpdated += 1
    } else {
      await prisma.takeoffItem.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          category: s.category,
          tag: s.tag,
          description: `${s.category === 'DOOR' ? 'Door' : 'Window'} ${s.tag}${s.tagSource === 'block-name' ? ' (block-name only)' : ''}`,
          unit: 'nr',
          qtyAi: s.count,
          basis: 'MEASURED',
          confidence: s.tagSource === 'mtext' ? 98 : 75,
          status: s.tagSource === 'mtext' ? 'EDITED' : 'AI',
          sourceSheetId: sheet.id,
          sourceNote: `DXF ${document.filename}`,
          meta: meta as object,
        },
      })
      schedulesCreated += 1
    }
  }

  // Race-safety dedup: the worker loop uses setInterval(tick, 1500)
  // which does NOT await the previous tick, so two PARSE_DXF jobs for
  // the same project can run in parallel (worker dispatches both
  // before the first finishes). Within that window, two handlers can
  // both `findFirst({tag: 'D02'})` → both miss → both create → two
  // rows for the same tag. The real fix lives in runner.ts (loop +
  // await instead of setInterval); until that lands, collapse any
  // (project, category, tag) duplicates we just created. Keep the
  // newest createdAt — matches the MULTI-DOC #3 verdict (most recent
  // architect spec wins).
  const dupCheck = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      deletedAt: null,
      category: { in: ['ROOM', 'DOOR', 'WINDOW'] },
      tag: { not: null },
    },
    select: { id: true, category: true, tag: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const seen = new Set<string>()
  const raceLoserIds: string[] = []
  for (const r of dupCheck) {
    const k = `${r.category}|${r.tag}`
    if (seen.has(k)) raceLoserIds.push(r.id)
    else seen.add(k)
  }
  if (raceLoserIds.length > 0) {
    await prisma.takeoffItem.updateMany({
      where: { id: { in: raceLoserIds } },
      data: { deletedAt: new Date() },
    })
  }

  // Cross-source dedup for ROOMs — DXF wins.
  //
  // Why the SAME normalizer extractRooms uses (not a local one):
  // run-6 showed vision had stored rooms with token-sorted normalized
  // forms ("MASTER BEDROOM — L1" → key "BEDROOM MASTER"). A simpler
  // local norm produced "MASTER BEDROOM" → would have missed the
  // pair and left both rows surviving. Importing normalizeRoomName
  // keeps the key contract identical between the two handlers.
  //
  // Tie-breaker: when a group has multiple MEASURED rows (vision had
  // some MEASURED rooms via the bbox-spatial pass; DXF adds more),
  // prefer the one whose meta.sourceFormat === 'DXF' — the architect's
  // explicit number beats vision's measurement. Falls back to highest
  // confidence when neither is DXF.
  const allRoomItems = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      category: 'ROOM',
      deletedAt: null,
    },
    select: {
      id: true,
      tag: true,
      description: true,
      basis: true,
      confidence: true,
      qtyAi: true,
      meta: true,
    },
  })
  const groups = new Map<string, typeof allRoomItems>()
  for (const r of allRoomItems) {
    const k = normalizeRoomName(r.description)
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const isDxfSource = (row: (typeof allRoomItems)[number]): boolean => {
    const m = (row.meta ?? {}) as Record<string, unknown>
    return m.sourceFormat === 'DXF'
  }
  const sourceScore = (row: (typeof allRoomItems)[number]): number =>
    (isDxfSource(row) ? 1000 : 0) +
    (row.basis === 'MEASURED' ? 100 : row.basis === 'DERIVED' ? 50 : 0) +
    row.confidence
  let visionLosersSoftDeleted = 0
  for (const [, group] of groups) {
    if (group.length === 1) continue
    // Survivor = highest sourceScore. Losers = the rest, but only if
    // a MEASURED or DXF row is in the group — never soft-delete an
    // unrelated row.
    const hasAuthoritative = group.some((r) => isDxfSource(r) || r.basis === 'MEASURED')
    if (!hasAuthoritative) continue
    const sorted = group.slice().sort((a, b) => sourceScore(b) - sourceScore(a))
    const survivor = sorted[0]!
    const losers = sorted.slice(1)
    if (losers.length === 0) continue
    // Carry CONFIRMED finish_code AND finishSuggestion from losers
    // to the survivor. The confirmed code matters more — QUANTIFY
    // groups rooms into floor-finish lines by meta.finish_code; if
    // the survivor lacks it, the room drops into the UNASSIGNED
    // bucket (was the regression on the first DXF thread into
    // run-6: LIVING's confirmed ST01 didn't follow the soft-delete
    // and SCREED stayed at 304.77 instead of becoming 427.70).
    //
    // Two donors, picked independently:
    //  - finish_code donor = first loser with meta.finish_code set
    //    (the human's confirmed assignment).
    //  - finishSuggestion donor = first loser with a non-null
    //    finishSuggestion.code (the AI's proposal — only if no
    //    confirmed code exists).
    const survivorMeta = (survivor.meta ?? {}) as Record<string, unknown>
    const survivorHasFinishCode =
      typeof survivorMeta.finish_code === 'string' && survivorMeta.finish_code.length > 0
    const survivorHasSuggestion = !!(
      survivorMeta.finishSuggestion as { code?: string } | undefined
    )?.code
    if (!survivorHasFinishCode || !survivorHasSuggestion) {
      const finishCodeDonor = !survivorHasFinishCode
        ? losers.find((l) => {
            const lm = (l.meta ?? {}) as Record<string, unknown>
            return typeof lm.finish_code === 'string' && (lm.finish_code as string).length > 0
          })
        : undefined
      const suggestionDonor = !survivorHasSuggestion
        ? losers.find((l) => {
            const lm = (l.meta ?? {}) as Record<string, unknown>
            const ls = lm.finishSuggestion as { code?: string | null } | null | undefined
            return !!ls?.code
          })
        : undefined
      if (finishCodeDonor || suggestionDonor) {
        const codeDm = (finishCodeDonor?.meta ?? {}) as Record<string, unknown>
        const suggDm = (suggestionDonor?.meta ?? {}) as Record<string, unknown>
        const mergedMeta: Record<string, unknown> = { ...survivorMeta }
        if (finishCodeDonor) {
          mergedMeta.finish_code = codeDm.finish_code
          if (codeDm.finish_evidence !== undefined && !mergedMeta.finish_evidence) {
            mergedMeta.finish_evidence = codeDm.finish_evidence
          }
          mergedMeta.finishCodeCarriedFromTakeoffItemId = finishCodeDonor.id
        }
        if (suggestionDonor) {
          mergedMeta.finishSuggestion = suggDm.finishSuggestion
          if (suggDm.finish_evidence !== undefined && !mergedMeta.finish_evidence) {
            mergedMeta.finish_evidence = suggDm.finish_evidence
          }
          mergedMeta.finishSuggestionCarriedFromTakeoffItemId = suggestionDonor.id
        }
        await prisma.takeoffItem.update({
          where: { id: survivor.id },
          data: { meta: mergedMeta as object },
        })
      }
    }
    await prisma.takeoffItem.updateMany({
      where: { id: { in: losers.map((l) => l.id) } },
      data: { deletedAt: new Date() },
    })
    visionLosersSoftDeleted += losers.length
  }

  // Mark Document READY — terminal stage.
  await prisma.document.update({
    where: { id: document.id },
    data: { status: 'READY' },
  })

  return {
    documentId: document.id,
    layersResolved: { roomLabels: roomLabelsLayer, doors: doorsLayer, windows: windowsLayer },
    rooms: {
      total: roomReport.rooms.length,
      created: roomsCreated,
      updated: roomsUpdated,
      unpairedCodes: roomReport.unpairedCodes,
      unpairedNames: roomReport.unpairedNames.length,
      unknownLabels: roomReport.unknownLabels,
      medianPairDistanceMm: roomReport.medianPairDistanceMm,
      maxPairDistanceMm: roomReport.maxPairDistanceMm,
    },
    doors: { uniqueTags: doors.length, totalCount: doors.reduce((s, d) => s + d.count, 0) },
    windows: {
      uniqueTags: windows.length,
      totalCount: windows.reduce((s, w) => s + w.count, 0),
      skipped: !PARSE_DXF_EMIT_WINDOWS,
    },
    schedules: { created: schedulesCreated, updated: schedulesUpdated },
    raceLosersSoftDeleted: raceLoserIds.length,
    visionLosersSoftDeleted,
  }
}
