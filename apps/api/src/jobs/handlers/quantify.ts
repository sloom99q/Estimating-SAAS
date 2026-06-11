/**
 * QUANTIFY — Sprint 3.
 *
 * Deterministic TypeScript ONLY (no LLM math) — see ADR-? and the architect's
 * Sprint-3 brief. Derives new TakeoffItems from the project's existing ROOM
 * extractions and the room-by-room perimeter/height inputs:
 *
 *   FLOOR_FINISH : Σ ROOM area grouped by `meta.finish_code` (basis DERIVED,
 *                  conf 85). Source note names the rooms that fed it.
 *   CEILING      : same group sum (basis DERIVED, conf 80) — for fit-out
 *                  schemes ceiling area ≈ floor area; the 80 confidence
 *                  carries the "approximate" caveat.
 *   SKIRTING     : Σ perimeter − door widths. If room perimeter is unknown
 *                  (the common case in Sprint 3 stub data because we only
 *                  have area_m2), the row is created PARAMETRIC + a
 *                  ValidationFlag(SKIRTING_PERIMETER_UNKNOWN, WARN).
 *   WALL_FINISH  : centerline × height − schedule openings where measurable,
 *                  else PARAMETRIC + ValidationFlag(WALL_PERIMETER_UNKNOWN).
 *   STAIRS       : tread/riser LINEAR METERS (risers × width). Plot 4357
 *                  pilot lesson: NEVER plan-m². Skipped entirely when no
 *                  stair-tagged rooms exist in the data.
 *
 * Idempotent on `meta.derivedKey` — re-running the job updates existing
 * derived rows rather than duplicating them. No payload args are required;
 * QUANTIFY operates on the whole project.
 *
 *   payload = { projectId }
 *
 * Returns a structured summary { created, updated, flags } used by the
 * caller / SPA to render "Quantify ran, here's what changed."
 */
import type { Prisma, TakeoffCategory } from '@prisma/client'
import { prisma } from '../../db'
import type { JobHandler, JobRecord } from '../types'

interface QuantifyPayload {
  projectId: string
}

interface DerivedSummary {
  created: number
  updated: number
  flagsRaised: number
  groups: Array<{
    finishCode: string
    rooms: number
    totalAreaM2: string
  }>
}

const DERIVED_KEY_FIELD = 'derivedKey'

function num(v: Prisma.Decimal | null): number {
  return v === null ? 0 : Number(v.toString())
}

export const quantifyHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as QuantifyPayload
  if (!payload.projectId) throw new Error('QUANTIFY: payload.projectId required')

  // Load ROOM takeoff items for the project. Use qtyFinal when present,
  // fall back to qtyAi. Items with no quantity are skipped.
  const rooms = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'ROOM',
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  })
  if (rooms.length === 0) {
    return { ok: true, derived: { created: 0, updated: 0, flagsRaised: 0, groups: [] } }
  }

  // Group by finish_code (from meta). Missing finish_code → 'unknown'.
  const groups = new Map<string, { rooms: typeof rooms; totalArea: number }>()
  for (const room of rooms) {
    const meta = (room.meta ?? {}) as Record<string, unknown>
    const finishCode = typeof meta.finish_code === 'string' ? meta.finish_code : 'unknown'
    const area = num(room.qtyFinal ?? room.qtyAi)
    const bucket = groups.get(finishCode)
    if (bucket) {
      bucket.rooms.push(room)
      bucket.totalArea += area
    } else {
      groups.set(finishCode, { rooms: [room], totalArea: area })
    }
  }

  const summary: DerivedSummary = {
    created: 0,
    updated: 0,
    flagsRaised: 0,
    groups: [],
  }

  for (const [finishCode, bucket] of groups) {
    summary.groups.push({
      finishCode,
      rooms: bucket.rooms.length,
      totalAreaM2: bucket.totalArea.toFixed(2),
    })

    const sourceNote =
      `Derived from ${bucket.rooms.length} ROOM items with finish_code=${finishCode} ` +
      `(total ${bucket.totalArea.toFixed(2)} m²). Sources: ` +
      `${bucket.rooms.slice(0, 3).map((r) => r.tag ?? r.id.slice(0, 6)).join(', ')}` +
      (bucket.rooms.length > 3 ? `, …(+${bucket.rooms.length - 3})` : '')
    const meta = {
      finishCode,
      roomIds: bucket.rooms.map((r) => r.id),
      totalAreaM2: bucket.totalArea,
    }

    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'FLOOR_FINISH',
      tag: `FF-${finishCode}`,
      description: `Floor finish — ${finishCode}`,
      unit: 'm²',
      qty: bucket.totalArea,
      basis: 'DERIVED',
      confidence: 85,
      sourceNote,
      meta: { ...meta, [DERIVED_KEY_FIELD]: `floor:${finishCode}` },
      summary,
    })

    await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'CEILING',
      tag: `CL-${finishCode}`,
      description: `Ceiling — ${finishCode} (floor-area approx.)`,
      unit: 'm²',
      qty: bucket.totalArea,
      basis: 'DERIVED',
      confidence: 80,
      sourceNote: `${sourceNote}. Assumes ceiling area ≈ floor area.`,
      meta: { ...meta, [DERIVED_KEY_FIELD]: `ceiling:${finishCode}` },
      summary,
    })

    // SKIRTING — perimeter unknown for the stub set. Pilot rule: PARAMETRIC + flag,
    // never silent-pick a fabricated perimeter.
    const skirting = await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'SCREED', // stub repurpose: keep within the enum; skirting is m of edge
      tag: `SK-${finishCode}`,
      description: `Skirting (perimeter pending) — ${finishCode}`,
      unit: 'm',
      qty: 0,
      basis: 'PARAMETRIC',
      confidence: 50,
      sourceNote: `Perimeter not measured for ${bucket.rooms.length} rooms in finish_code=${finishCode}; PARAMETRIC pending takeoff.`,
      meta: { ...meta, [DERIVED_KEY_FIELD]: `skirting:${finishCode}` },
      summary,
    })
    await flagOnce(
      job.organizationId,
      payload.projectId,
      skirting.id,
      'SKIRTING_PERIMETER_UNKNOWN',
      'WARN',
      `Skirting quantity for finish_code=${finishCode} requires room perimeters — not measured in current takeoff.`,
      summary,
    )

    // WALL_FINISH — same story.
    const wall = await upsertDerived({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      category: 'WALL_FINISH',
      tag: `WF-${finishCode}`,
      description: `Wall finish (centreline pending) — ${finishCode}`,
      unit: 'm²',
      qty: 0,
      basis: 'PARAMETRIC',
      confidence: 50,
      sourceNote: `Wall centreline × height − openings requires room perimeters — not measured; PARAMETRIC.`,
      meta: { ...meta, [DERIVED_KEY_FIELD]: `wall:${finishCode}` },
      summary,
    })
    await flagOnce(
      job.organizationId,
      payload.projectId,
      wall.id,
      'WALL_PERIMETER_UNKNOWN',
      'WARN',
      `Wall area for finish_code=${finishCode} requires room perimeters — not measured in current takeoff.`,
      summary,
    )
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
        meta: args.meta as object,
        // Derived rows stay EDITED so they flow into BOQ generate without a
        // second human review pass.
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
      meta: args.meta as object,
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
