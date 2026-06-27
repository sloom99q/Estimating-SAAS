/**
 * SPRINT-1.2 — BoqEligibilityGate.
 *
 * ONE global rule for whether an AI-status TakeoffItem may enter the
 * BOQ. Replaces every per-category auto-promote (SK promotes when X;
 * VAN promotes when Y; KITCHEN promotes when Z). The rule:
 *
 *   status === 'AI' && qty > 0 && hasRateLibrarySlot(item) → admit
 *
 * In english:
 *   "we keep AI suggestions out of the BOQ until we can actually price
 *    them — measured by whether the user has populated a rate-library
 *    slot that covers this item's category / tag."
 *
 * Items not at status=AI bypass this gate entirely (they're already
 * promoted by upstream filters). EDITED + APPROVED ship as today.
 *
 * Status: DESIGN STUB. Not yet imported by the BOQ route — waiting
 * for design sign-off before wiring.
 */
import type { TakeoffStatus, TakeoffCategory } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────
// Rate-library snapshot
//
// Pre-loaded once per BOQ-gen so the predicate is a pure hash
// lookup. Two signals — either is enough to count as "we can price
// this":
//
//   codes      — RateLibraryItem.code values (org-scope + global)
//   assemblies — TakeoffCategory values that have at least one
//                Assembly routed via takeoffCategory
//
// Plus the meta-driven fallbacks below. Anything that PRICE's
// waterfall could resolve = passes the gate.
// ─────────────────────────────────────────────────────────────────

export interface RateLibrarySnapshot {
  codes: ReadonlySet<string>
  assemblies: ReadonlySet<TakeoffCategory>
}

// ─────────────────────────────────────────────────────────────────
// Item shape — pluck only what the gate needs from TakeoffItem
// ─────────────────────────────────────────────────────────────────

export interface EligibilityItem {
  status: TakeoffStatus
  qtyAi: { toString(): string } | null
  qtyFinal: { toString(): string } | null
  category: TakeoffCategory
  tag: string | null
  /** Drives rate-hint detection. Common keys:
   *    rateHint              — explicit (e.g. 'SKIRTING-PR01')
   *    floorFinishCode       — e.g. 'ST01' → 'FF-ST01'
   *    rateLibraryCode       — set by derivedQuantityRules emissions
   */
  meta: unknown
}

// ─────────────────────────────────────────────────────────────────
// The predicate
// ─────────────────────────────────────────────────────────────────

export interface EligibilityVerdict {
  eligible: boolean
  /** Short reason for the gate's decision — shown in QUANTIFY logs +
   *  the BOQ-generation summary so the operator can debug "why isn't
   *  my SK line in the BOQ?". */
  reason: string
}

/**
 * The ONE rule. Pure — no DB access, no side effects. The caller
 * pre-loads the RateLibrarySnapshot once + applies this per item.
 */
export function isBoqEligible(
  item: EligibilityItem,
  rateLib: RateLibrarySnapshot,
): EligibilityVerdict {
  // Items already promoted upstream skip the gate.
  if (item.status !== 'AI') {
    return { eligible: true, reason: `status=${item.status} (promoted upstream)` }
  }

  const qty = num(item.qtyFinal ?? item.qtyAi)
  if (qty <= 0) {
    return { eligible: false, reason: 'qty=0 — nothing to price' }
  }

  if (!hasRateLibrarySlot(item, rateLib)) {
    return {
      eligible: false,
      reason: `no rate-library slot for category=${item.category}${item.tag ? ` tag=${item.tag}` : ''} — add a RateLibraryItem or Assembly that covers it`,
    }
  }

  return { eligible: true, reason: 'AI suggestion with qty + matching rate slot' }
}

/**
 * Does the rate library have an entry that could price this item?
 * Cheapest possible check — pure hash lookup against the snapshot.
 *
 * Signals tried in order:
 *   1. meta.rateLibraryCode in codes      (derivedQuantityRules path)
 *   2. meta.rateHint in codes              (legacy emitter path)
 *   3. category in assemblies              (Assembly routes by category)
 *   4. category-derived code in codes      (FF-{finishCode}, SK-{finishCode})
 *
 * No DB query. No PRICE-waterfall re-implementation. If the user
 * adds a rate-library entry, this returns true on the next BOQ-gen.
 */
function hasRateLibrarySlot(item: EligibilityItem, rateLib: RateLibrarySnapshot): boolean {
  const meta = (item.meta ?? {}) as Record<string, unknown>

  // (1) Explicit code from derivedQuantityRules.
  if (typeof meta.rateLibraryCode === 'string' && rateLib.codes.has(meta.rateLibraryCode)) {
    return true
  }

  // (2) Legacy rate-hint (KITCHEN-* / VAN-* emissions stamp these).
  if (typeof meta.rateHint === 'string' && rateLib.codes.has(meta.rateHint)) {
    return true
  }

  // (3) Any Assembly routed for this category.
  if (rateLib.assemblies.has(item.category)) {
    return true
  }

  // (4) Category-derived rate codes — only the patterns the existing
  // PRICE waterfall would try.
  if (item.category === 'FLOOR_FINISH' && typeof meta.floorFinishCode === 'string') {
    if (rateLib.codes.has(`FF-${meta.floorFinishCode}`)) return true
  }
  if (item.category === 'SKIRTING' && typeof meta.floorFinishCode === 'string') {
    if (rateLib.codes.has(`SK-${meta.floorFinishCode}`)) return true
    if (rateLib.codes.has('SKIRTING-LM')) return true
  }
  if (item.category === 'CEILING' && typeof meta.ceilingCode === 'string') {
    if (rateLib.codes.has(`CL-${meta.ceilingCode}`)) return true
  }

  return false
}

function num(d: { toString(): string } | null | undefined): number {
  if (!d) return 0
  const n = Number.parseFloat(d.toString())
  return Number.isFinite(n) ? n : 0
}
