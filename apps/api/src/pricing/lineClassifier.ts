/**
 * SPRINT-1.2 — line classifier (formerly BoqEligibilityGate).
 *
 * TWO ORTHOGONAL AXES. Don't conflate them.
 *
 *   1. LineState     — does this line appear in the BOQ at all?
 *                       ACTIVE     = qty>0 + valid scope → emit
 *                       SUPPRESSED = qty<=0 / invalid geometry /
 *                                    dedup-filtered → drop
 *
 *      Only scope-quality reasons suppress. Missing rates, missing
 *      slots, unknown categories, audit warnings — NONE of these
 *      affect LineState. A detected quantity NEVER disappears
 *      because of a pricing gap.
 *
 *   2. Pricing       — once a line is ACTIVE, can it be priced?
 *                       isPriced=true  → qty × rate, ships PRICED
 *                       isPriced=false → ships UNPRICED with a
 *                                        `warning` telling the
 *                                        estimator which action
 *                                        clears it
 *
 *      `warning` values:
 *          RATE_MISSING       — slot exists, populate the value
 *          RATE_SLOT_MISSING  — no slot, create the entry suggested
 *          null               — line is fully priced
 *
 * The classifier itself only sources LineState from the gate's
 * qty>0 check. Other suppression sources (NEVER_BOQ categories,
 * meta.kind='LEGEND', PLACEHOLDER estimability) live in the BOQ
 * generator and run before classify — they short-circuit the item
 * out of the bucket entirely.
 */
import type { Prisma, PrismaClient, TakeoffStatus, TakeoffCategory } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────
// Rate-library snapshot — unchanged from boqEligibility.ts
// ─────────────────────────────────────────────────────────────────

export interface RateLibrarySnapshot {
  rates: ReadonlyMap<string, number>
  assemblies: ReadonlySet<TakeoffCategory>
}

export async function loadRateLibrarySnapshot(
  client:
    | PrismaClient
    | { rateLibraryItem: PrismaClient['rateLibraryItem']; assembly: PrismaClient['assembly'] },
  organizationId: string,
): Promise<RateLibrarySnapshot> {
  const [items, assemblies] = await Promise.all([
    client.rateLibraryItem.findMany({
      where: {
        OR: [{ organizationId }, { organizationId: null }],
        deletedAt: null,
      },
      select: { code: true, rate: true },
    }),
    client.assembly.findMany({
      where: { organizationId, deletedAt: null, takeoffCategory: { not: null } },
      select: { takeoffCategory: true },
    }),
  ])
  const rates = new Map<string, number>()
  for (const it of items) {
    const v = Number(it.rate.toString())
    rates.set(it.code, Number.isFinite(v) ? v : 0)
  }
  const asmSet = new Set<TakeoffCategory>()
  for (const a of assemblies) {
    if (a.takeoffCategory) asmSet.add(a.takeoffCategory as TakeoffCategory)
  }
  return { rates, assemblies: asmSet }
}

// ─────────────────────────────────────────────────────────────────
// Item shape — pluck only what the classifier needs
// ─────────────────────────────────────────────────────────────────

export interface ClassifierItem {
  status: TakeoffStatus
  qtyAi: { toString(): string } | null
  qtyFinal: { toString(): string } | null
  category: TakeoffCategory
  tag: string | null
  meta: unknown
}

// ─────────────────────────────────────────────────────────────────
// Verdict — two orthogonal axes
// ─────────────────────────────────────────────────────────────────

/** Axis 1 — does the line appear in the BOQ? */
export type LineState = 'ACTIVE' | 'SUPPRESSED'

/** Axis 2 — when ACTIVE, why is the line not priced? */
export type GateWarning = 'RATE_MISSING' | 'RATE_SLOT_MISSING' | null

export interface LineClassification {
  /** Axis 1 — emission. */
  state: LineState
  /** Short reason for the state assignment + (when ACTIVE) the
   *  pricing warning, surfaced on the BoqLine for the engineer. */
  reason: string
  /** Axis 2 — pricing. Only meaningful when state='ACTIVE'. */
  isPriced: boolean
  /** Axis 2 — categorical reason a line is UNPRICED. */
  warning: GateWarning
  /** Which rate-library code actually matched (null when no slot
   *  matched, or matched via Assembly-by-category). */
  matchedCode: string | null
  /** When unpriced: the code the estimator needs to populate (or
   *  create). null when the line is fully priced. */
  suggestedCode: string | null
}

// ─────────────────────────────────────────────────────────────────
// The classifier
// ─────────────────────────────────────────────────────────────────

/**
 * Pure — no DB, no side effects. The caller pre-loads
 * RateLibrarySnapshot once + applies this per item.
 *
 * State logic (axis 1 — SUPPRESSION):
 *   AI item with qty<=0 → SUPPRESSED (nothing to show; geometry
 *                          /dedup filters live upstream in the BOQ
 *                          generator, not here)
 *   anything else        → ACTIVE
 *
 * Pricing logic (axis 2 — independent of state):
 *   non-AI item                → isPriced=true (upstream-promoted)
 *   AI + populated slot        → isPriced=true
 *   AI + slot exists, rate=0   → isPriced=false, warning=RATE_MISSING
 *   AI + no slot               → isPriced=false, warning=RATE_SLOT_MISSING
 */
export function classifyLine(
  item: ClassifierItem,
  rateLib: RateLibrarySnapshot,
): LineClassification {
  // EDITED / APPROVED already passed upstream filters.
  if (item.status !== 'AI') {
    return {
      state: 'ACTIVE',
      reason: `status=${item.status} (promoted upstream)`,
      isPriced: true,
      warning: null,
      matchedCode: null,
      suggestedCode: null,
    }
  }

  // Axis 1 — the ONE suppression rule the classifier owns: qty<=0.
  // No pricing concern affects this.
  const qty = num(item.qtyFinal ?? item.qtyAi)
  if (qty <= 0) {
    return {
      state: 'SUPPRESSED',
      reason: 'qty<=0 — nothing to show',
      isPriced: false,
      warning: null,
      matchedCode: null,
      suggestedCode: null,
    }
  }

  // From here, state=ACTIVE. Axis 2 (pricing) is independent.
  const slot = findRateLibrarySlot(item, rateLib)
  if (!slot) {
    const suggested = suggestRateLibraryCode(item)
    return {
      state: 'ACTIVE',
      reason: suggested
        ? `RATE SLOT MISSING — create rate-library entry '${suggested}' to price this line`
        : `RATE SLOT MISSING — no slot exists for category=${item.category}${item.tag ? ` tag=${item.tag}` : ''}`,
      isPriced: false,
      warning: 'RATE_SLOT_MISSING',
      matchedCode: null,
      suggestedCode: suggested,
    }
  }
  if (!slot.isPriced) {
    return {
      state: 'ACTIVE',
      reason: `RATE MISSING — slot '${slot.code ?? '[Assembly]'}' exists but rate is 0; populate the value to price this line`,
      isPriced: false,
      warning: 'RATE_MISSING',
      matchedCode: slot.code,
      suggestedCode: slot.code,
    }
  }
  return {
    state: 'ACTIVE',
    reason: `priced via rate slot ${slot.code ?? '[Assembly]'}`,
    isPriced: true,
    warning: null,
    matchedCode: slot.code,
    suggestedCode: null,
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

interface SlotMatch {
  code: string | null
  isPriced: boolean
}

function findRateLibrarySlot(item: ClassifierItem, rateLib: RateLibrarySnapshot): SlotMatch | null {
  const meta = (item.meta ?? {}) as Record<string, unknown>
  const tryCode = (code: string): SlotMatch | null => {
    if (!rateLib.rates.has(code)) return null
    const rate = rateLib.rates.get(code) ?? 0
    return { code, isPriced: rate > 0 }
  }
  if (typeof meta.rateLibraryCode === 'string') {
    const m = tryCode(meta.rateLibraryCode)
    if (m) return m
  }
  if (typeof meta.rateHint === 'string') {
    const m = tryCode(meta.rateHint)
    if (m) return m
  }
  if (rateLib.assemblies.has(item.category)) {
    return { code: null, isPriced: true }
  }
  if (item.category === 'FLOOR_FINISH' && typeof meta.floorFinishCode === 'string') {
    const m = tryCode(`FF-${meta.floorFinishCode}`)
    if (m) return m
  }
  if (item.category === 'SKIRTING') {
    if (typeof meta.floorFinishCode === 'string') {
      const m = tryCode(`SK-${meta.floorFinishCode}`)
      if (m) return m
    }
    const m = tryCode('SKIRTING-LM')
    if (m) return m
  }
  if (item.category === 'CEILING' && typeof meta.ceilingCode === 'string') {
    const m = tryCode(`CL-${meta.ceilingCode}`)
    if (m) return m
  }
  return null
}

function suggestRateLibraryCode(item: ClassifierItem): string | null {
  const meta = (item.meta ?? {}) as Record<string, unknown>
  if (typeof meta.rateLibraryCode === 'string') return meta.rateLibraryCode
  if (typeof meta.rateHint === 'string') return meta.rateHint
  if (item.category === 'FLOOR_FINISH' && typeof meta.floorFinishCode === 'string') {
    return `FF-${meta.floorFinishCode}`
  }
  if (item.category === 'SKIRTING') {
    if (typeof meta.floorFinishCode === 'string') return `SK-${meta.floorFinishCode}`
    return 'SKIRTING-LM'
  }
  if (item.category === 'CEILING' && typeof meta.ceilingCode === 'string') {
    return `CL-${meta.ceilingCode}`
  }
  return null
}

function num(d: { toString(): string } | null | undefined): number {
  if (!d) return 0
  const n = Number.parseFloat(d.toString())
  return Number.isFinite(n) ? n : 0
}
