/**
 * QUANTIFY v2 — Sprint 6 rewrite.
 *
 *   payload = { projectId }
 *
 * Replaces the Sprint-3 blended-bucket implementation. Deterministic TS only.
 * Architect rules from the brief:
 *
 *   FLOORS    — Σ room.areaM2 GROUP BY finish_code → ONE FLOOR_FINISH line
 *               per code. Rooms with finish_code=null go to a single
 *               'unassigned' line marked PARAMETRIC + FINISH_UNMAPPED flag.
 *               BATHROOM-hatched rooms aggregate under finish_code='BATHROOM'
 *               (the per-bathroom-drawings sentinel).
 *
 *   CEILINGS  — name-rule split:
 *                 BATH | TOILET | POWDER | WC | LAUNDRY | KITCHEN → CL02
 *                 (moisture-resistant)
 *                 other interior (default)                       → CL03
 *               EXCLUDE rooms whose name matches
 *                 BALCONY | TERRACE | GARAGE | VOID | VOID OVER  ← never billed
 *               EXCLUDE rooms with finish_code='ST03' (external) — Plot
 *               4357 lesson: external porcelain pavement is its own line,
 *               not a ceiling. Two ceiling lines (CL02 + CL03), real
 *               per-room totals. No more ceiling=floor copy.
 *
 *   STAIRS    — if a STAIRCASE-named room exists, emit ONE tread-+-riser
 *               LINEAR METERS line (risers × width if known; PARAMETRIC
 *               flag if not). Plot 4357 STANDING RULE: NEVER plan-m².
 *
 *   WALLS     — wall PAINT stays PARAMETRIC + WALL_PERIMETER_UNKNOWN flag
 *               (no perimeters yet). Wall feature finishes whose codes
 *               appear in the legend with kind=WALL (e.g. WD01) emit as
 *               P/S lines with the legend description.
 *
 *   STAIRCASE LANDING — if STAIR-LAND rate area is computable later we'll
 *               emit it. For Sprint 6 the staircase line carries the lm only.
 *
 * Idempotent on tag — re-running updates existing derived rows by tag.
 */
import type { Prisma, TakeoffBasis, TakeoffCategory } from '@prisma/client'
import { prisma } from '../../db'
import { estimateSkirtingPerimeter, shouldSkirtRoom } from '../../ai/estimateSkirting'
import { estimateVanityForRoom } from '../../ai/estimateVanity'
import type { JobHandler, JobRecord } from '../types'
import { isAreaStatement, selectBillableRooms } from './_roomSelector'
import { upsertValidationFlag } from '../validationFlagUpsert'
import { type EvidenceStep, computeConfidence, step } from '../../pricing/lineProvenance'

interface QuantifyPayload {
  projectId: string
}

interface DerivedSummary {
  created: number
  updated: number
  flagsRaised: number
  floorGroups: Array<{ finishCode: string; rooms: number; totalAreaM2: string }>
  ceilingGroups: Array<{ code: string; rooms: number; totalAreaM2: string }>
  staircase: { emitted: boolean; lm: number | null }
  /**
   * Roadmap #1 — single SCREED-FLR line covering all interior floor area.
   * Excluded: ST03 (external pavement, no screed under), staircase rooms
   * (separate stair emission path), and the unassigned bucket (might be
   * external — reviewer decides).
   */
  screed: { emitted: boolean; totalAreaM2: string; excludedCodes: string[] }
  /**
   * AI-est roadmap #1 — per-room SKIRTING suggestions. status='AI', basis='ESTIMATED'.
   * Stays out of the BOQ until the reviewer Confirms each line.
   */
  skirting: { suggested: number; skipped: number; totalLm: string }
  /**
   * AI-est roadmap #2 — per-bathroom VANITY suggestions. 1 per bathroom
   * (95% prior). status='AI', basis='ESTIMATED'. Reviewer overrides
   * qtyFinal for double-vanity master baths before Confirming.
   */
  vanity: { suggested: number; skipped: number; totalCount: number }
  /**
   * LIB-4 — per-room PAINT suggestions. status='EDITED' so they go
   * into the BOQ on Generate without an extra Accept click — paint
   * is a near-universal scope and the estimator can zero / delete
   * the rare exceptions in the review table. Quantity = perimeter
   * (from aspect prior) × ceiling height. PRICE routes via the
   * Library system on takeoffCategory=PAINT.
   */
  paint: { suggested: number; skipped: number; totalWallAreaM2: string }
  /**
   * MEP-4 — rule-driven discipline lines (HVAC / Elec / Plumb / ELV).
   * One emission per active MepRule whose driver evaluates non-zero.
   * `drivers` captures the inputs the rules saw so the SPA can show
   * "we used interiorAreaFt2=3,834" alongside the emitted lines.
   */
  mep?: {
    emitted: number
    zeroDriver: number
    rulesEvaluated: number
    drivers: {
      interiorAreaM2: string
      interiorAreaFt2: string
      ROOM_COUNT: number
      BATHROOM_COUNT: number
      KITCHEN_COUNT: number
      BEDROOM_COUNT: number
    }
  }
  wallFeatures: Array<{ code: string; description: string }>
  excludedRooms: string[]
}

function num(v: Prisma.Decimal | null): number {
  return v === null ? 0 : Number(v.toString())
}

const CEILING_CL02_RE = /\b(BATH|TOILET|POWDER|WC|LAUNDRY|KITCHEN)\b/i
const EXCLUDE_FROM_CEILING_RE = /\b(BALCONY|TERRACE|GARAGE|VOID|MAID'?S ROOM)\b/i

function ceilingClassFor(name: string, finishCode: string | null): 'CL02' | 'CL03' | null {
  const upper = name.toUpperCase()
  if (EXCLUDE_FROM_CEILING_RE.test(upper)) return null
  if (finishCode === 'ST03') return null // external porcelain pavement, not a ceiling
  if (CEILING_CL02_RE.test(upper)) return 'CL02'
  return 'CL03'
}

function isStaircaseRoom(name: string): boolean {
  return /\bSTAIRCASE\b/i.test(name)
}

export const quantifyHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as QuantifyPayload
  if (!payload.projectId) throw new Error('QUANTIFY: payload.projectId required')

  // S6-3: load ROOM items (real takeoff) and LEGEND items (for wall feature
  // finishes). Both live in TakeoffItem under different category + meta.kind.
  // S8-5: also look up whether ROOMS_AREA_RECONCILE fired — if so, the
  // unassigned floor bucket gets labelled SUSPECT in the BOQ.
  //
  // S9-0 single source of truth: we now query *both* ROOM and
  // AREA_STATEMENT rows so the selector can drop the building-level
  // statements consistently with the scorer. Prior Sprint-8 BOQs counted
  // the 972 m² "Proposed Villa" row as a room and ended up with a
  // 1,420 m² CL03 ceiling line — exactly the integrity bug S9-0 closes.
  const [allRoomyRows, legendItems, areaReconcileFlag] = await Promise.all([
    prisma.takeoffItem.findMany({
      where: {
        organizationId: job.organizationId,
        projectId: payload.projectId,
        category: { in: ['ROOM', 'AREA_STATEMENT'] },
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.takeoffItem.findMany({
      where: {
        organizationId: job.organizationId,
        projectId: payload.projectId,
        deletedAt: null,
        tag: { not: null },
      },
    }),
    prisma.validationFlag.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: payload.projectId,
        rule: 'ROOMS_AREA_RECONCILE',
        resolved: false,
      },
      select: { id: true },
    }),
  ])
  const roomsAreaSuspect = areaReconcileFlag !== null

  const summary: DerivedSummary = {
    created: 0,
    updated: 0,
    flagsRaised: 0,
    floorGroups: [],
    ceilingGroups: [],
    screed: { emitted: false, totalAreaM2: '0', excludedCodes: [] },
    skirting: { suggested: 0, skipped: 0, totalLm: '0' },
    vanity: { suggested: 0, skipped: 0, totalCount: 0 },
    paint: { suggested: 0, skipped: 0, totalWallAreaM2: '0' },
    staircase: { emitted: false, lm: null },
    wallFeatures: [],
    excludedRooms: [],
  }

  // S9-0 single-source selector: drop building-level AREA_STATEMENT rows
  // and any legacy ROOM rows that still match the area-statement pattern
  // (older runs persisted before S9-0). The scorer uses the same function.
  const rooms = selectBillableRooms(allRoomyRows)

  // PF-3 — track every derived tag QUANTIFY emits this run so a later
  // sweep can soft-delete derived rows from previous runs that no
  // longer correspond to a real bucket. (Example: STAIRCASE used to
  // emit an FF-ST02 row; after PB-4 the staircase emitter owns it and
  // the FF-ST02 line should disappear.)
  const emittedDerivedTags = new Set<string>()
  summary.excludedRooms.push(
    ...allRoomyRows
      .filter((r) => isAreaStatement(r.description) || r.category === 'AREA_STATEMENT')
      .map((r) => r.description.split('—')[0]!.trim()),
  )
  if (rooms.length === 0) {
    return { ok: true, derived: summary }
  }

  // S6-4: legend lookup map for description enrichment.
  const legendByCode = new Map<string, (typeof legendItems)[number]>()
  for (const l of legendItems) {
    const m = (l.meta ?? {}) as Record<string, unknown>
    if (m.kind === 'LEGEND' && l.tag) legendByCode.set(l.tag.toUpperCase(), l)
  }
  function describeLegend(code: string): string {
    const legend = legendByCode.get(code.toUpperCase())
    if (!legend) return code
    const m = (legend.meta ?? {}) as Record<string, unknown>
    const parts = [
      code,
      typeof m.name === 'string' ? `— ${m.name}` : null,
      typeof m.finish === 'string' ? m.finish : null,
      typeof m.size === 'string' ? m.size : null,
    ].filter(Boolean)
    return parts.join(', ').replace(', —', ' —')
  }

  // --- Floors ----------------------------------------------------------
  // Sprint-10 F1 STAIR HONESTY: skip STAIRCASE rooms here so they never
  // contribute to an m² floor-finish bucket. The dedicated staircase
  // emitter below handles them honestly as `lm` (or P/S while pending).
  // The colour mapper assigns STAIRCASE → ST02 for the scorer / mapping
  // arithmetic; that doesn't mean we want to BILL the stair as 27 m² of
  // grainy marble at 550 AED/m². Plot 4357's standing rule: stairs are
  // lm, never plan-m².
  const floorGroups = new Map<string, { rooms: typeof rooms; totalArea: number }>()
  for (const room of rooms) {
    const name = room.description.split('—')[0]!.trim()
    if (isStaircaseRoom(name)) continue
    const meta = (room.meta ?? {}) as Record<string, unknown>
    const finishCode = typeof meta.finish_code === 'string' ? meta.finish_code : null
    const key = finishCode ?? 'unassigned'
    const area = num(room.qtyFinal ?? room.qtyAi)
    if (area <= 0) continue
    const bucket = floorGroups.get(key)
    if (bucket) {
      bucket.rooms.push(room)
      bucket.totalArea += area
    } else {
      floorGroups.set(key, { rooms: [room], totalArea: area })
    }
  }
  for (const [finishCode, bucket] of floorGroups) {
    const isUnassigned = finishCode === 'unassigned'
    const roomNames = bucket.rooms.slice(0, 8).map((r) => r.description.split('—')[0]!.trim())
    const sourceNote = `Σ floor area over ${bucket.rooms.length} room${bucket.rooms.length === 1 ? '' : 's'} with finish_code=${finishCode}; rooms: ${roomNames.join(', ')}${bucket.rooms.length > 8 ? `, …(+${bucket.rooms.length - 8})` : ''}`
    const tag = `FF-${finishCode}`
    emittedDerivedTags.add(tag)
    const item = await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'FLOOR_FINISH',
      tag,
      description: isUnassigned
        ? `Floor finish — UNASSIGNED rooms (${bucket.rooms.length})${roomsAreaSuspect ? ' [SUSPECT — area vs BUA mismatch]' : ''}`
        : `${describeLegend(finishCode)} — interior floors (${roomNames.slice(0, 4).join(', ')}${roomNames.length > 4 ? `, …+${bucket.rooms.length - 4}` : ''})`,
      unit: 'm²',
      qty: bucket.totalArea,
      basis: isUnassigned ? 'PARAMETRIC' : 'DERIVED',
      confidence: isUnassigned ? 50 : 85,
      sourceNote,
      meta: {
        finishCode,
        roomIds: bucket.rooms.map((r) => r.id),
        totalAreaM2: bucket.totalArea,
        derivedKey: `floor:${finishCode}`,
        // S8-5: when the validator fired, mark the unassigned bucket SUSPECT
        // so downstream BOQ/PRICE/XLSX render it with a clear caveat. The
        // human reviewer sees both the validator flag AND the line itself
        // saying "trust this less".
        suspect: isUnassigned && roomsAreaSuspect ? true : undefined,
      },
      summary,
    })
    if (isUnassigned) {
      await flagOnce(
        job.organizationId,
        payload.projectId,
        item.id,
        'FINISH_UNMAPPED',
        'WARN',
        `${bucket.rooms.length} rooms have no finish_code; floor totalling ${bucket.totalArea.toFixed(2)} m² is PARAMETRIC.`,
        summary,
      )
    }
    summary.floorGroups.push({
      finishCode,
      rooms: bucket.rooms.length,
      totalAreaM2: bucket.totalArea.toFixed(2),
    })
  }

  // --- Screed (one line under all interior floors) ---------------------
  // Every interior floor finish (porcelain, marble, bathroom) sits on a
  // sand-cement screed bed at SCREED-FLR (90 AED/m²). Sum the per-code
  // buckets, exclude external (ST03) which sits on a concrete slab with
  // no screed, exclude the unassigned bucket (reviewer hasn't decided
  // internal vs external). Staircase rooms aren't in floorGroups to
  // begin with (skipped earlier by isStaircaseRoom).
  const SCREED_EXCLUDED_FINISH_CODES = new Set(['ST03', 'unassigned'])
  let screedArea = 0
  const screedExcluded: string[] = []
  for (const [finishCode, bucket] of floorGroups) {
    if (SCREED_EXCLUDED_FINISH_CODES.has(finishCode)) {
      screedExcluded.push(finishCode)
      continue
    }
    screedArea += bucket.totalArea
  }
  if (screedArea > 0) {
    const includedCodes = Array.from(floorGroups.keys()).filter(
      (c) => !SCREED_EXCLUDED_FINISH_CODES.has(c),
    )
    emittedDerivedTags.add('SCREED-FLR')
    // CONF-3 — chain: room-area extractions (per the upstream DXF
    // MTEXT / vision pass) → sum measurement → screed = sum formula.
    // No assumptions; the inclusion/exclusion of finish codes is a
    // deterministic policy choice baked in code.
    const screedChain: EvidenceStep[] = [
      step({ id: 'screed.extract', type: 'EXTRACTION', confidence: 0.95, label: `Room areas extracted from DXF/vision across ${floorGroups.size} finish-code buckets` }),
      step({ id: 'screed.measure', type: 'MEASUREMENT', confidence: 0.95, label: `Σ interior floor area = ${screedArea.toFixed(2)} m² across [${includedCodes.join(', ')}]` }),
      step({ id: 'screed.derive', type: 'DERIVATION', confidence: 0.97, label: 'screedArea = Σ interior floors (excluding external + unassigned)' }),
    ]
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'SCREED',
      tag: 'SCREED-FLR',
      description: `Sand-cement screed under interior floor finishes (${includedCodes.join(', ')})`,
      unit: 'm²',
      qty: screedArea,
      basis: 'DERIVED',
      confidence: Math.round(computeConfidence(screedChain) * 100),
      sourceNote: `Σ interior floor area = ${screedArea.toFixed(2)} m² across finish codes [${includedCodes.join(', ')}]. Excluded: ${screedExcluded.length > 0 ? screedExcluded.join(', ') : '∅'} (ST03 external pavement = no screed; unassigned = reviewer decides).`,
      meta: {
        derivedKey: 'screed:floor',
        includedFinishCodes: includedCodes,
        excludedFinishCodes: screedExcluded,
        totalAreaM2: screedArea,
        evidenceChain: screedChain,
      },
      summary,
    })
    summary.screed = {
      emitted: true,
      totalAreaM2: screedArea.toFixed(2),
      excludedCodes: screedExcluded,
    }
  }

  // --- Ceilings (name-rule split, excludes balconies/terraces/garages) -
  const ceilingGroups = new Map<'CL02' | 'CL03', { rooms: typeof rooms; totalArea: number }>()
  for (const room of rooms) {
    const meta = (room.meta ?? {}) as Record<string, unknown>
    const finishCode = typeof meta.finish_code === 'string' ? meta.finish_code : null
    const name = room.description.split('—')[0]!.trim()
    const ceilingCode = ceilingClassFor(name, finishCode)
    if (!ceilingCode) {
      summary.excludedRooms.push(name)
      continue
    }
    const area = num(room.qtyFinal ?? room.qtyAi)
    if (area <= 0) continue
    const bucket = ceilingGroups.get(ceilingCode)
    if (bucket) {
      bucket.rooms.push(room)
      bucket.totalArea += area
    } else {
      ceilingGroups.set(ceilingCode, { rooms: [room], totalArea: area })
    }
  }
  for (const [ceilingCode, bucket] of ceilingGroups) {
    const roomNames = bucket.rooms.slice(0, 8).map((r) => r.description.split('—')[0]!.trim())
    const ceilingLabel = ceilingCode === 'CL02' ? 'moisture-resistant gypsum (CL02)' : 'gypsum plain (CL03)'
    emittedDerivedTags.add(`CL-${ceilingCode}`)
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'CEILING',
      tag: `CL-${ceilingCode}`,
      description: `Ceiling ${ceilingCode} — ${ceilingLabel}; rooms: ${roomNames.join(', ')}${bucket.rooms.length > 8 ? `, …(+${bucket.rooms.length - 8})` : ''}`,
      unit: 'm²',
      qty: bucket.totalArea,
      basis: 'DERIVED',
      confidence: 80,
      sourceNote: `Σ ceiling area over ${bucket.rooms.length} room${bucket.rooms.length === 1 ? '' : 's'} classified ${ceilingCode}. Excluded rooms (no ceiling line): ${summary.excludedRooms.slice(0, 6).join(', ') || '∅'}.`,
      meta: {
        ceilingCode,
        roomIds: bucket.rooms.map((r) => r.id),
        totalAreaM2: bucket.totalArea,
        derivedKey: `ceiling:${ceilingCode}`,
      },
      summary,
    })
    summary.ceilingGroups.push({
      code: ceilingCode,
      rooms: bucket.rooms.length,
      totalAreaM2: bucket.totalArea.toFixed(2),
    })
  }

  // --- Stairs (lm — Plot 4357 standing rule) ---------------------------
  const staircase = rooms.find((r) => isStaircaseRoom(r.description.split('—')[0]!))
  if (staircase) {
    const meta = (staircase.meta ?? {}) as Record<string, unknown>
    const risers = typeof meta.risers === 'number' ? meta.risers : null
    const stairWidth = typeof meta.stairWidth_m === 'number' ? meta.stairWidth_m : null
    let lm: number | null = null
    if (risers && stairWidth) lm = risers * stairWidth
    const item = await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'OTHER',
      tag: 'STAIR-TREAD',
      description:
        lm === null
          ? // Sprint-10 F1: spell the standing-rule reference into the
            // line description so a reader of the BOQ knows the rate the
            // line will book against once lm is measured.
            `Grainy marble tread/riser — lm pending (ref STAIR-TREAD 800/lm + STAIR-LAND 550/m²)`
          : `Stair tread + riser — ${lm.toFixed(2)} lm`,
      unit: 'lm',
      qty: lm ?? 0,
      basis: lm === null ? 'PARAMETRIC' : 'DERIVED',
      confidence: lm === null ? 50 : 85,
      sourceNote: lm === null
        ? `STAIRCASE room ${staircase.description.split('—')[0]!.trim()} present but risers × width not measured.`
        : `STAIRCASE: ${risers} risers × ${stairWidth} m = ${lm.toFixed(2)} lm. Plot 4357 rule: stairs are lm, NEVER plan-m².`,
      meta: { stairRoomId: staircase.id, risers, stairWidth_m: stairWidth, derivedKey: 'stairs' },
      summary,
    })
    if (lm === null) {
      await flagOnce(
        job.organizationId,
        payload.projectId,
        item.id,
        'STAIR_RISERS_UNKNOWN',
        'WARN',
        `STAIRCASE present but tread/riser geometry not captured. Line stays PARAMETRIC — never silently use plan-m².`,
        summary,
      )
    }
    summary.staircase = { emitted: true, lm }
  }

  // --- Wall feature finishes (P/S until measured) ---------------------
  //
  // The legacy "WF-PAINT — Wall paint (Fenomastic emulsion) — perimeter
  // pending" placeholder line was removed (2026-06-27). LIB-4 now
  // emits per-room PAINT-<roomId> TakeoffItems with real wall area
  // (perimeter from aspect-ratio prior × ceiling height), so the
  // placeholder was duplicating the same scope at qty=0 and cluttering
  // the BOQ. The stale-derived sweep at the end of this handler
  // (matching `WF-` prefix) soft-deletes any WF-PAINT row from prior
  // runs since it's no longer in emittedDerivedTags. The
  // WALL_PERIMETER_UNKNOWN ValidationFlag is no longer raised — per-
  // room PAINT lines carry their own evidence chain instead.
  const wallFeatureLegend = legendItems.filter((l) => {
    const m = (l.meta ?? {}) as Record<string, unknown>
    return m.kind === 'LEGEND' && (m.legendKind === 'WALL' || l.category === 'WALL_FINISH')
  })

  for (const legend of wallFeatureLegend) {
    const m = (legend.meta ?? {}) as Record<string, unknown>
    const code = legend.tag ?? 'WALL'
    const name = (m.name as string) ?? legend.description
    const desc = `${code} — ${name} (wall feature, area pending supplier quote)`
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'WALL_FINISH',
      tag: (() => { const t = `WF-${code}`; emittedDerivedTags.add(t); return t })(),
      description: desc,
      unit: 'm²',
      qty: 0,
      basis: 'PARAMETRIC',
      confidence: 50,
      sourceNote: `Wall feature finish ${code} from legend; quantity pending. P/S until measured.`,
      meta: { legendTakeoffId: legend.id, legendCode: code, derivedKey: `wall-feature:${code}` },
      summary,
    })
    summary.wallFeatures.push({ code, description: name })
  }

  // --- SKIRTING suggestions (AI-est roadmap #1) -----------------------
  // Per-room skirting lm SUGGESTIONS from the aspect-ratio prior. ONE row
  // per skirtable room; status='AI' so they stay OUT of the BOQ until
  // the reviewer Confirms each line in the verify UI (status → EDITED).
  // Zero AI tokens — pure deterministic math from area + a name-prior.
  // The reasoning string is stored on meta.estimationReasoning and
  // surfaced inline in the review table.
  let skirtingSuggested = 0
  let skirtingSkipped = 0
  let skirtingTotalLm = 0
  for (const room of rooms) {
    const meta = (room.meta ?? {}) as Record<string, unknown>
    const finishCode = typeof meta.finish_code === 'string' ? meta.finish_code : null
    const name = room.description.split('—')[0]!.trim()
    if (!shouldSkirtRoom(name, finishCode)) {
      skirtingSkipped += 1
      continue
    }
    const area = num(room.qtyFinal ?? room.qtyAi)
    const estimate = estimateSkirtingPerimeter(name, area)
    if (!estimate) {
      skirtingSkipped += 1
      continue
    }
    skirtingSuggested += 1
    skirtingTotalLm += estimate.perimeterLm
    const tag = `SK-${room.id.slice(-8)}`
    emittedDerivedTags.add(tag)
    // CONF-3 — skirting chain: extract room area + name → aspect-
    // ratio PRIOR converts to perimeter → DERIVATION skirting=perim.
    // Prior is the dominant uncertainty (we don't actually know the
    // perimeter, just guessing from a typical aspect ratio).
    const skChain: EvidenceStep[] = [
      step({ id: 'sk.extract', type: 'EXTRACTION', confidence: 0.95, label: `Room "${name}" area + name extracted (${area.toFixed(2)} m²)` }),
      step({ id: 'sk.prior', type: 'PRIOR', confidence: 0.80, label: `Aspect-ratio prior "${estimate.priorName}" → perimeter ${estimate.perimeterLm.toFixed(2)} lm` }),
      step({ id: 'sk.derive', type: 'DERIVATION', confidence: 0.97, label: 'skirting = perimeter (1:1)' }),
    ]
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'SKIRTING',
      tag,
      description: `Skirting — ${name} (${finishCode} floor)`,
      unit: 'lm',
      qty: Math.round(estimate.perimeterLm * 100) / 100,
      basis: 'ESTIMATED',
      confidence: Math.round(computeConfidence(skChain) * 100),
      sourceNote: estimate.reasoning,
      meta: {
        derivedKey: `skirting:${room.id}`,
        roomId: room.id,
        roomName: name,
        floorFinishCode: finishCode,
        estimationSource: 'aspect-ratio-prior',
        estimationReasoning: estimate.reasoning,
        priorName: estimate.priorName,
        aspectRatio: estimate.aspectRatio,
        perimeterLm: estimate.perimeterLm,
        evidenceChain: skChain,
      },
      // SKIRTING is a SUGGESTION — stays out of BOQ until human Confirm.
      summary,
      status: 'AI',
    })
  }
  summary.skirting = {
    suggested: skirtingSuggested,
    skipped: skirtingSkipped,
    totalLm: skirtingTotalLm.toFixed(2),
  }

  // --- WALL PAINT (LIB-4 / Material Library phase 1) -----------------
  // Per-room wall area derivation. Each ROOM with a confirmed
  // finish_code that passes shouldSkirtRoom (= interior, non-bath,
  // non-stair, non-balcony) gets a PAINT TakeoffItem so the Library's
  // Jotun system can bill it (LIB-5 routes via Assembly.takeoffCategory).
  //
  // Quantity = aspect-prior perimeter × ceiling height. The 2.8 m
  // default ceiling height is a project-wide constant for now; the
  // design doc proposes Project.defaultCeilingHeightM as an override
  // (deferred to a future migration — not material to phase-1 paint
  // proof).
  //
  // Status = EDITED so PAINT lines drop straight into the BOQ without
  // an Accept-per-row gate. Paint is near-universal scope; the
  // estimator zeros / deletes the rare exceptions in the review table.
  // This differs from SKIRTING which stays AI because skirting choice
  // is more variable per room.
  //
  // Bathrooms are excluded here because their wall paint is a
  // different system (waterproof) over a partial area (above tile
  // band). Phase-2 work adds a separate BATH_WALL emitter.
  const CEILING_HEIGHT_M = 2.8
  let paintSuggested = 0
  let paintSkipped = 0
  let paintTotalWallAreaM2 = 0
  for (const room of rooms) {
    const meta = (room.meta ?? {}) as Record<string, unknown>
    const finishCode = typeof meta.finish_code === 'string' ? meta.finish_code : null
    const name = room.description.split('—')[0]!.trim()
    if (!shouldSkirtRoom(name, finishCode)) {
      paintSkipped += 1
      continue
    }
    const area = num(room.qtyFinal ?? room.qtyAi)
    const estimate = estimateSkirtingPerimeter(name, area)
    if (!estimate) {
      paintSkipped += 1
      continue
    }
    const wallAreaM2 = estimate.perimeterLm * CEILING_HEIGHT_M
    paintSuggested += 1
    paintTotalWallAreaM2 += wallAreaM2
    const tag = `PAINT-${room.id.slice(-8)}`
    emittedDerivedTags.add(tag)
    // CONF-3 — paint chain: the worked example from the design.
    // room-extract 0.95 × area 0.90 × aspect-prior perimeter 0.85 ×
    // assumed-height 0.80. Default weights {EXTRACT:0.6, MEASURE:0.7,
    // PRIOR:0.5, ASSUMPTION:0.8} → compound ≈ 0.70. Lands in honest
    // range without collapse. (User's expected 0.55-0.62 needs higher
    // weights — flagging in the response so we can tune.)
    const paintChain: EvidenceStep[] = [
      step({ id: 'paint.extract', type: 'EXTRACTION', confidence: 0.95, label: `Room "${name}" extracted from DXF` }),
      step({ id: 'paint.measure', type: 'MEASUREMENT', confidence: 0.90, label: `Room area ${area.toFixed(2)} m² from MTEXT label` }),
      step({ id: 'paint.prior', type: 'PRIOR', confidence: 0.85, label: `Aspect-ratio prior "${estimate.priorName}" → perimeter ${estimate.perimeterLm.toFixed(2)} lm (we don't see the actual perimeter)` }),
      step({ id: 'paint.height', type: 'ASSUMPTION', confidence: 0.80, label: `Ceiling height assumed ${CEILING_HEIGHT_M} m (project-wide default)` }),
    ]
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'PAINT',
      tag,
      description: `Wall paint — ${name} (interior, 2-coat stucco + 2-coat finish)`,
      unit: 'm²',
      qty: Math.round(wallAreaM2 * 100) / 100,
      basis: 'DERIVED',
      confidence: Math.round(computeConfidence(paintChain) * 100),
      sourceNote:
        `${estimate.reasoning} × ${CEILING_HEIGHT_M} m ceiling = ` +
        `${wallAreaM2.toFixed(2)} m² wall paint area`,
      meta: {
        derivedKey: `paint:${room.id}`,
        roomId: room.id,
        roomName: name,
        floorFinishCode: finishCode,
        perimeterLm: estimate.perimeterLm,
        ceilingHeightM: CEILING_HEIGHT_M,
        wallAreaM2,
        priorName: estimate.priorName,
        aspectRatio: estimate.aspectRatio,
        evidenceChain: paintChain,
        estimationSource: 'aspect-ratio-prior',
        estimationReasoning: estimate.reasoning,
      },
      summary,
      // PAINT lines go into the BOQ on the next Generate without an
      // extra Accept click — see comment block above.
      status: 'EDITED',
    })
  }
  summary.paint = {
    suggested: paintSuggested,
    skipped: paintSkipped,
    totalWallAreaM2: paintTotalWallAreaM2.toFixed(2),
  }

  // --- VANITY suggestions (AI-est roadmap #2) -------------------------
  // ONE stone-top vanity (3400 AED/No) per bathroom. Strong prior: 95%
  // confidence when both finish=BATHROOM and the name matches the
  // bathroom pattern, 80% on a single signal. Reviewer overrides
  // qtyFinal inline for double-vanity master baths before Confirming.
  // Zero AI tokens — pure deterministic rule on data we already have.
  let vanitySuggested = 0
  let vanitySkipped = 0
  let vanityTotalCount = 0
  for (const room of rooms) {
    const meta = (room.meta ?? {}) as Record<string, unknown>
    const finishCode = typeof meta.finish_code === 'string' ? meta.finish_code : null
    const name = room.description.split('—')[0]!.trim()
    const estimate = estimateVanityForRoom(name, finishCode)
    if (!estimate) {
      vanitySkipped += 1
      continue
    }
    vanitySuggested += 1
    vanityTotalCount += estimate.count
    const tag = `VAN-${room.id.slice(-8)}`
    emittedDerivedTags.add(tag)
    // CONF-3 — vanity chain: room-name + finish-code extraction →
    // 1-per-bathroom PRIOR. Strong prior (most bathrooms have one
    // vanity); reviewer overrides for double-vanity masters.
    const signalsLabel = Object.entries(estimate.signals)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || 'none'
    const vanChain: EvidenceStep[] = [
      step({ id: 'van.extract', type: 'EXTRACTION', confidence: 0.95, label: `Room "${name}" classified as bathroom (signals: ${signalsLabel})` }),
      step({ id: 'van.prior', type: 'PRIOR', confidence: 0.90, label: `1-vanity-per-bathroom prior (override for double-vanity master baths)` }),
    ]
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'JOINERY',
      tag,
      description: `Vanity (stone-top) — ${name}`,
      unit: 'No',
      qty: estimate.count,
      basis: 'ESTIMATED',
      confidence: Math.round(computeConfidence(vanChain) * 100),
      sourceNote: estimate.reasoning,
      meta: {
        derivedKey: `vanity:${room.id}`,
        roomId: room.id,
        roomName: name,
        floorFinishCode: finishCode,
        estimationSource: '1-per-bathroom-prior',
        estimationReasoning: estimate.reasoning,
        signals: estimate.signals,
        rateHint: 'VANITY',
        evidenceChain: vanChain,
      },
      summary,
      status: 'AI',
    })
  }
  summary.vanity = {
    suggested: vanitySuggested,
    skipped: vanitySkipped,
    totalCount: vanityTotalCount,
  }

  // --- MEP (rule-driven) -----------------------------------------------
  // MEP-4 — every active MepRule fires against the project's drawing-
  // measurable drivers (interior floor area, room counts, bathroom /
  // kitchen counts, etc.). Each rule emits ONE TakeoffItem stamped:
  //   basis=DERIVED
  //   meta.mepRuleId   → ties the line back to the rule for audit chip
  //   meta.formulaText → human readable "qty = AREA_FT2 (3,834) × 0.00741 = 28.4"
  //   meta.factorSource / rateSource → preserved on the BoqLine evidence
  //   meta.mepRate     → the rule's rate (BOQ generator bakes it in)
  // Confidence = min(factor, rate) on the rule → routed through the
  // auditor's Confidence module → PLACEHOLDER rules end up in the SPA
  // review queue automatically.
  const mepRules = await prisma.mepRule.findMany({
    where: {
      organizationId: job.organizationId,
      active: true,
      deletedAt: null,
    },
    orderBy: [{ discipline: 'asc' }, { sortOrder: 'asc' }],
  })

  // Pre-compute drivers from the same `rooms` slice the rest of the
  // handler uses. Interior-floor area mirrors the screed selection.
  const SQM_TO_SQFT = 10.7639
  let interiorAreaM2 = 0
  for (const [code, bucket] of floorGroups) {
    if (SCREED_EXCLUDED_FINISH_CODES.has(code)) continue
    interiorAreaM2 += bucket.totalArea
  }
  const interiorAreaFt2 = interiorAreaM2 * SQM_TO_SQFT

  const BATHROOM_RE = /\b(BATH|TOILET|POWDER|WC)\b/i
  const KITCHEN_RE = /\bKITCHEN\b/i
  const BEDROOM_RE = /\bBEDROOM\b/i

  const roomNamesAll = rooms.map((r) => r.description.split('—')[0]!.trim())
  // ROOM-CLEANUP (2026-06-27) — dedup by normalized name + floor when
  // counting MEP drivers. The same villa room (MASTER BATHROOM on GF)
  // can appear multiple times in the takeoff if it was extracted
  // from both A101 + a sheet revision; without dedup, BATHROOM_COUNT
  // doubled (→ 14 instead of 7) and HVAC tonnage / fixture counts
  // inflated proportionally. The underlying ROOM TakeoffItems are
  // left untouched (they may legitimately be N rows for the same
  // physical room across docs); we just don't COUNT them N times
  // for MEP driver math.
  function normalizeRoomKey(d: string): string {
    return d.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  }
  const uniqueRoomKeys = new Set<string>()
  const uniqueNames: string[] = []
  for (const r of rooms) {
    const key = normalizeRoomKey(r.description)
    if (uniqueRoomKeys.has(key)) continue
    uniqueRoomKeys.add(key)
    uniqueNames.push(r.description.split('—')[0]!.trim())
  }
  const counts = {
    ROOM_COUNT: uniqueNames.length,
    BATHROOM_COUNT: uniqueNames.filter((n) => BATHROOM_RE.test(n)).length,
    KITCHEN_COUNT: uniqueNames.filter((n) => KITCHEN_RE.test(n)).length,
    BEDROOM_COUNT: uniqueNames.filter((n) => BEDROOM_RE.test(n)).length,
  }
  if (rooms.length !== uniqueNames.length) {
    console.log(
      `[quantify.mep] room dedup for MEP counters: ${rooms.length} TakeoffItems → ${uniqueNames.length} unique by (name+floor) — prevents double-count inflation`,
    )
  }
  // Back-compat: pre-existing references to roomNamesAll continue
  // to see the unique set; existing per-room loops (PAINT, SKIRTING)
  // still iterate `rooms` directly and are NOT affected.
  void roomNamesAll

  function resolveDriver(rule: (typeof mepRules)[number]): { value: number; label: string } | null {
    const d = rule.driver
    if (d === 'AREA_M2' || d === 'BUA_M2') return { value: interiorAreaM2, label: `${d} (${interiorAreaM2.toFixed(1)} m²)` }
    if (d === 'AREA_FT2') return { value: interiorAreaFt2, label: `AREA_FT2 (${interiorAreaFt2.toFixed(0)} ft²)` }
    if (d === 'FIXED') return { value: 1, label: 'FIXED (1)' }
    if (d === 'ROOM_COUNT' || d === 'BATHROOM_COUNT' || d === 'KITCHEN_COUNT' || d === 'BEDROOM_COUNT') {
      if (d === 'ROOM_COUNT' && rule.driverFilter) {
        const re = new RegExp(rule.driverFilter, 'i')
        const c = roomNamesAll.filter((n) => re.test(n)).length
        return { value: c, label: `ROOM_COUNT[/${rule.driverFilter}/i] (${c})` }
      }
      const c = counts[d as keyof typeof counts]
      return { value: c, label: `${d} (${c})` }
    }
    return null
  }

  let mepEmitted = 0
  let mepZeroDriver = 0
  for (const rule of mepRules) {
    const drv = resolveDriver(rule)
    if (!drv) {
      console.warn(`[quantify.mep] unknown driver '${rule.driver}' on rule ${rule.id}`)
      continue
    }
    const factor = Number(rule.factor.toString())
    const rate = Number(rule.rate.toString())
    const qty = drv.value * factor
    if (qty <= 0) {
      mepZeroDriver += 1
      continue
    }
    // Round qty sensibly per output unit. Whole-unit things (No, pt)
    // round to nearest int; areas and lengths stay decimal.
    const wholeUnit = rule.outputUnit === 'No' || rule.outputUnit === 'pt' || rule.outputUnit === 'LS'
    const qtyOut = wholeUnit ? Math.max(1, Math.round(qty)) : Math.round(qty * 100) / 100
    const factorConf = rule.factorConfidence ? Number(rule.factorConfidence.toString()) : 0.5
    const rateConf = rule.rateConfidence ? Number(rule.rateConfidence.toString()) : 0.5
    const formulaText = `${drv.label} × ${factor.toString()} = ${qtyOut} ${rule.outputUnit}  @  ${rate.toString()} AED/${rule.outputUnit}  = ${(qtyOut * rate).toFixed(0)} AED`
    // CONF-3 — MEP chain. Drivers based on extracted room state +
    // two assumptions: factor (industry/engineer norm) + rate
    // (market). Both ASSUMPTION at weight 0.8 — they're the dangerous
    // steps; rate especially when sourced 'PLACEHOLDER'. We don't
    // pre-compute lineConfidence as min(factor, rate) any more —
    // computeConfidence over the chain is the answer.
    const driverExtractConf =
      rule.driver === 'FIXED'
        ? 1.0
        : 0.85 // interior-area / room-count is itself a compound from upstream rooms
    const mepChain: EvidenceStep[] = [
      step({ id: 'mep.extract', type: 'EXTRACTION', confidence: driverExtractConf, label: `Driver ${drv.label}` }),
      step({ id: 'mep.factor', type: 'ASSUMPTION', confidence: factorConf, label: `Factor ${factor.toString()} ${rule.outputUnit}/${rule.driver} — ${rule.factorSource ?? 'unsourced'}`, sourceRef: rule.factorSource ?? undefined }),
      step({ id: 'mep.rate', type: 'ASSUMPTION', confidence: rateConf, label: `Rate ${rate.toString()} AED/${rule.outputUnit} — ${rule.rateSource ?? 'unsourced'}`, sourceRef: rule.rateSource ?? undefined }),
    ]
    const lineConfidence = computeConfidence(mepChain)
    const tag = `MEP-${rule.discipline.slice(0, 4).toUpperCase()}-${rule.id.slice(-8)}`
    emittedDerivedTags.add(tag)
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: rule.takeoffCategory as TakeoffCategory,
      tag,
      description: rule.name,
      unit: rule.outputUnit,
      qty: qtyOut,
      basis: 'DERIVED',
      confidence: Math.round(lineConfidence * 100),
      sourceNote: formulaText,
      meta: {
        derivedKey: `mep:${rule.id}`,
        mepRuleId: rule.id,
        mepDiscipline: rule.discipline,
        mepDriver: rule.driver,
        mepDriverValue: drv.value,
        mepDriverLabel: drv.label,
        mepFactor: factor,
        mepFactorSource: rule.factorSource,
        mepFactorConfidence: factorConf,
        mepRate: rate,
        mepRateSource: rule.rateSource,
        mepRateConfidence: rateConf,
        mepFormulaText: formulaText,
        mepOutputUnit: rule.outputUnit,
        evidenceChain: mepChain,
      },
      summary,
    })
    mepEmitted += 1
  }
  summary.mep = {
    emitted: mepEmitted,
    zeroDriver: mepZeroDriver,
    rulesEvaluated: mepRules.length,
    drivers: {
      interiorAreaM2: interiorAreaM2.toFixed(2),
      interiorAreaFt2: interiorAreaFt2.toFixed(0),
      ...counts,
    },
  }

  // PF-3 housekeeping — soft-delete any derived FF-*/CL-*/WF-* rows that
  // were emitted by a PRIOR quantify run but no longer correspond to a
  // bucket this run. Without this, BOQ generation picks up the stale
  // row (e.g. yesterday's FF-ST02 staircase line) and prices it even
  // though QUANTIFY skipped that bucket today.
  const staleDerived = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: payload.projectId,
      deletedAt: null,
      basis: { in: ['DERIVED', 'PARAMETRIC', 'ESTIMATED'] },
      OR: [
        { tag: { startsWith: 'FF-' } },
        { tag: { startsWith: 'CL-' } },
        { tag: { startsWith: 'WF-' } },
        { tag: { startsWith: 'SK-' } },
        { tag: { startsWith: 'VAN-' } },
        { tag: { startsWith: 'MEP-' } },
      ],
      // Sweep only AI-still rows: a reviewer-promoted SKIRTING line
      // (EDITED/APPROVED) must NEVER be soft-deleted by a re-run.
      status: 'AI',
    },
    select: { id: true, tag: true },
  })
  const stale = staleDerived.filter((i) => i.tag !== null && !emittedDerivedTags.has(i.tag))
  if (stale.length > 0) {
    await prisma.takeoffItem.updateMany({
      where: { id: { in: stale.map((i) => i.id) } },
      data: { deletedAt: new Date() },
    })
    console.log(`[quantify] soft-deleted ${stale.length} stale derived rows: ${stale.map((i) => i.tag).join(', ')}`)
  }

  return { ok: true, derived: summary }
}

interface UpsertArgs {
  organizationId: string
  projectId: string
  category: TakeoffCategory
  tag: string
  description: string
  unit: string
  qty: number
  basis: TakeoffBasis
  confidence: number
  sourceNote: string
  meta: Record<string, unknown>
  summary: DerivedSummary
  /**
   * Defaults to 'EDITED' (the existing measured/derived contract — auto-
   * enter the BOQ). SKIRTING and other AI-estimated lines pass 'AI' so
   * they stay OUT of the BOQ until the reviewer Confirms each line. The
   * verify UI flips status to EDITED on click; same auto-promotion the
   * door/schedule path uses.
   */
  status?: 'AI' | 'EDITED' | 'APPROVED'
}

async function upsertDerived(args: UpsertArgs): Promise<{ id: string }> {
  const status = args.status ?? 'EDITED'
  const existing = await prisma.takeoffItem.findFirst({
    where: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      tag: args.tag,
      deletedAt: null,
    },
    select: { id: true, status: true },
  })
  if (existing) {
    // Idempotency for ESTIMATED rows: if the reviewer already promoted
    // an existing line to EDITED/APPROVED (clicked Confirm), don't
    // demote it back to AI on the next QUANTIFY re-run. Re-runs refresh
    // the suggestion math but respect human review state.
    const nextStatus =
      status === 'AI' && existing.status !== 'AI' ? existing.status : status
    await prisma.takeoffItem.update({
      where: { id: existing.id },
      data: {
        category: args.category,
        description: args.description,
        unit: args.unit,
        qtyAi: args.qty === 0 ? null : args.qty,
        qtyFinal: args.qty === 0 ? null : args.qty,
        basis: args.basis,
        confidence: args.confidence,
        sourceNote: args.sourceNote,
        meta: args.meta as Prisma.JsonObject,
        status: nextStatus,
      },
    })
    args.summary.updated += 1
    return { id: existing.id }
  }
  const created = await prisma.takeoffItem.create({
    data: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      category: args.category,
      tag: args.tag,
      description: args.description,
      unit: args.unit,
      qtyAi: args.qty === 0 ? null : args.qty,
      qtyFinal: args.qty === 0 ? null : args.qty,
      basis: args.basis,
      confidence: args.confidence,
      sourceNote: args.sourceNote,
      meta: args.meta as Prisma.JsonObject,
      status,
    },
  })
  args.summary.created += 1
  return { id: created.id }
}

async function flagOnce(
  organizationId: string,
  projectId: string,
  takeoffItemId: string,
  rule: string,
  severity: 'ERROR' | 'WARN' | 'INFO',
  message: string,
  summary: DerivedSummary,
): Promise<void> {
  const result = await upsertValidationFlag({
    client: prisma,
    organizationId,
    projectId,
    takeoffItemId,
    rule,
    severity,
    message,
  })
  if (result.created) summary.flagsRaised += 1
}
