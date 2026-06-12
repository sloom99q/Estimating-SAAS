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
import type { Prisma, TakeoffCategory } from '@prisma/client'
import { prisma } from '../../db'
import type { JobHandler, JobRecord } from '../types'
import { isAreaStatement, selectBillableRooms } from './_roomSelector'

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
    staircase: { emitted: false, lm: null },
    wallFeatures: [],
    excludedRooms: [],
  }

  // S9-0 single-source selector: drop building-level AREA_STATEMENT rows
  // and any legacy ROOM rows that still match the area-statement pattern
  // (older runs persisted before S9-0). The scorer uses the same function.
  const rooms = selectBillableRooms(allRoomyRows)
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
  const floorGroups = new Map<string, { rooms: typeof rooms; totalArea: number }>()
  for (const room of rooms) {
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
          ? `Stair tread + riser (lm pending — risers × width unknown)`
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

  // --- Walls — paint stays PARAMETRIC; wall feature finishes emit P/S --
  const wallFeatureLegend = legendItems.filter((l) => {
    const m = (l.meta ?? {}) as Record<string, unknown>
    return m.kind === 'LEGEND' && (m.legendKind === 'WALL' || l.category === 'WALL_FINISH')
  })
  const paintItem = await upsertDerived({
    organizationId: job.organizationId,
    projectId: payload.projectId,
    category: 'WALL_FINISH',
    tag: 'WF-PAINT',
    description: 'Wall paint (Fenomastic emulsion) — perimeter pending',
    unit: 'm²',
    qty: 0,
    basis: 'PARAMETRIC',
    confidence: 50,
    sourceNote:
      'Wall centreline × height − openings requires room perimeters; not measured in current takeoff. PARAMETRIC.',
    meta: { derivedKey: 'wall:paint' },
    summary,
  })
  await flagOnce(
    job.organizationId,
    payload.projectId,
    paintItem.id,
    'WALL_PERIMETER_UNKNOWN',
    'WARN',
    'Wall paint area requires room perimeters — not measured in current takeoff.',
    summary,
  )

  for (const legend of wallFeatureLegend) {
    const m = (legend.meta ?? {}) as Record<string, unknown>
    const code = legend.tag ?? 'WALL'
    const name = (m.name as string) ?? legend.description
    const desc = `${code} — ${name} (wall feature, area pending supplier quote)`
    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'WALL_FINISH',
      tag: `WF-${code}`,
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
  basis: 'DERIVED' | 'PARAMETRIC' | 'PLACEHOLDER'
  confidence: number
  sourceNote: string
  meta: Record<string, unknown>
  summary: DerivedSummary
}

async function upsertDerived(args: UpsertArgs): Promise<{ id: string }> {
  const existing = await prisma.takeoffItem.findFirst({
    where: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      tag: args.tag,
      deletedAt: null,
    },
    select: { id: true },
  })
  if (existing) {
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
        status: 'EDITED',
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
      status: 'EDITED',
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
  const existing = await prisma.validationFlag.findFirst({
    where: { organizationId, projectId, takeoffItemId, rule, resolved: false },
    select: { id: true },
  })
  if (existing) return
  await prisma.validationFlag.create({
    data: { organizationId, projectId, takeoffItemId, rule, severity, message },
  })
  summary.flagsRaised += 1
}
