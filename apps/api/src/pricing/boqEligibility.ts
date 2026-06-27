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
import type { Prisma, PrismaClient, TakeoffStatus, TakeoffCategory } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────
// Rate-library snapshot
//
// Pre-loaded once per BOQ-gen so the predicate is a pure hash
// lookup. Two signals:
//
//   rates      — code → rate value. Map carries BOTH populated
//                slots (value > 0) AND empty slots (value = 0 /
//                null) so the gate can distinguish "slot exists
//                AND priced" from "slot exists BUT unpopulated".
//                Empty slots make the line visible in the BOQ as
//                "rate pending", not silently priced × 0.
//   assemblies — TakeoffCategory values that have at least one
//                Assembly routed via takeoffCategory. Assemblies
//                compose components → always priced when present.
// ─────────────────────────────────────────────────────────────────

export interface RateLibrarySnapshot {
  rates: ReadonlyMap<string, number>
  assemblies: ReadonlySet<TakeoffCategory>
}

/**
 * Pre-load the snapshot from the DB. Cheap — one indexed read per
 * source. The result is read-only; safe to reuse across many items
 * in a single BOQ generation.
 */
export async function loadRateLibrarySnapshot(
  client: PrismaClient | { rateLibraryItem: PrismaClient['rateLibraryItem']; assembly: PrismaClient['assembly'] },
  organizationId: string,
): Promise<RateLibrarySnapshot> {
  const [items, assemblies] = await Promise.all([
    client.rateLibraryItem.findMany({
      where: {
        OR: [{ organizationId }, { organizationId: null }], // org + global
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
    // Store ALL slots — empty ones too (value=0 means unpopulated;
    // the gate decides what to do).
    rates.set(it.code, Number.isFinite(v) ? v : 0)
  }
  const asmSet = new Set<TakeoffCategory>()
  for (const a of assemblies) {
    if (a.takeoffCategory) asmSet.add(a.takeoffCategory as TakeoffCategory)
  }
  return { rates, assemblies: asmSet }
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

/// SPRINT-1.2 (refined) — the warning tells the estimator WHICH
/// action clears the line:
///   RATE_MISSING       — the rate-library slot exists, populate it
///   RATE_SLOT_MISSING  — no slot exists, create the entry suggested
/// null = no warning (line is fully priced).
export type GateWarning = 'RATE_MISSING' | 'RATE_SLOT_MISSING' | null

export interface EligibilityVerdict {
  eligible: boolean
  /** Short reason for the gate's decision — surfaced on the BoqLine
   *  description so the engineer knows why a line is rate-pending. */
  reason: string
  /** Which rate-library code matched (null when no slot or matched
   *  via Assembly-by-category). */
  matchedCode: string | null
  /** When no slot matches OR an empty slot was found: the code the
   *  estimator needs to populate (or create). */
  suggestedCode: string | null
  /** True when a slot exists AND rate>0 → line ships PRICED. False
   *  otherwise → line ships VISIBLE as UNPRICED so the detected
   *  quantity is never silenced. Only meaningful when eligible=true. */
  isPriced: boolean
  /** Categorical reason a non-priced line is unpriced. Drives the
   *  audit chip + the visible "RATE MISSING" / "RATE SLOT MISSING"
   *  badge in the XLSX export. */
  warning: GateWarning
}

/**
 * The ONE rule. Pure — no DB access, no side effects. The caller
 * pre-loads the RateLibrarySnapshot once + applies this per item.
 *
 * Behaviour (post-Sprint-1.2 refinement):
 *   qty=0                            → INELIGIBLE (nothing to show)
 *   qty>0 + populated slot           → eligible + isPriced=true (PRICED)
 *   qty>0 + slot exists, rate=0      → eligible + isPriced=false (rate pending)
 *   qty>0 + NO slot                   → eligible + isPriced=false (rate pending,
 *                                       suggestedCode tells user what to add)
 *
 * The gate NEVER suppresses a real detected quantity. A line with a
 * known qty but unknown rate stays visible so the estimator can see
 * what was found AND what they need to populate to price it.
 */
export function isBoqEligible(
  item: EligibilityItem,
  rateLib: RateLibrarySnapshot,
): EligibilityVerdict {
  // Items already promoted upstream skip the gate.
  if (item.status !== 'AI') {
    return {
      eligible: true,
      reason: `status=${item.status} (promoted upstream)`,
      matchedCode: null,
      suggestedCode: null,
      isPriced: true,
      warning: null,
    }
  }

  // The gate's ONLY suppression rule: qty must be > 0. Everything
  // else (missing rate, missing slot) flows through as visible
  // UNPRICED. Detection and pricing are independent concerns —
  // never let pricing gaps silence detected scope.
  const qty = num(item.qtyFinal ?? item.qtyAi)
  if (qty <= 0) {
    return {
      eligible: false,
      reason: 'qty=0 — nothing to show',
      matchedCode: null,
      suggestedCode: null,
      isPriced: false,
      warning: null,
    }
  }

  const slot = findRateLibrarySlot(item, rateLib)
  if (!slot) {
    // No slot at all — the line ships VISIBLE as UNPRICED. Estimator
    // sees the detected qty + the exact code they need to create.
    const suggested = suggestRateLibraryCode(item)
    return {
      eligible: true,
      reason: suggested
        ? `RATE SLOT MISSING — create rate-library entry '${suggested}' to price this line`
        : `RATE SLOT MISSING — no slot exists for category=${item.category}${item.tag ? ` tag=${item.tag}` : ''}; create a RateLibraryItem or Assembly that covers it`,
      matchedCode: null,
      suggestedCode: suggested,
      isPriced: false,
      warning: 'RATE_SLOT_MISSING',
    }
  }
  if (!slot.isPriced) {
    // Slot exists but rate=0. Estimator just needs to populate the
    // value on the existing slot.
    return {
      eligible: true,
      reason: `RATE MISSING — slot '${slot.code ?? '[Assembly]'}' exists but rate is 0; populate the value to price this line`,
      matchedCode: slot.code,
      suggestedCode: slot.code,
      isPriced: false,
      warning: 'RATE_MISSING',
    }
  }
  return {
    eligible: true,
    reason: `priced via rate slot ${slot.code ?? '[Assembly]'}`,
    matchedCode: slot.code,
    suggestedCode: null,
    isPriced: true,
    warning: null,
  }
}

/**
 * What rate-library code SHOULD exist for this item? Used to populate
 * `suggestedCode` on the gate verdict when no slot matches. Mirrors
 * the lookup order in findRateLibrarySlot so the suggestion is the
 * same code the gate would have tried.
 */
function suggestRateLibraryCode(item: EligibilityItem): string | null {
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

/**
 * Find the rate-library slot that would price this item — and
 * report whether it's populated. Pure — hash lookups only.
 *
 * Signals tried in order:
 *   1. meta.rateLibraryCode in rates       (derivedQuantityRules path)
 *   2. meta.rateHint in rates              (legacy emitter path)
 *   3. category in assemblies              (Assembly routes by category;
 *                                           Assembly is always priced
 *                                           via component composition)
 *   4. category-derived code in rates      (FF-{finishCode}, SK-*, CL-*)
 *
 * Returns null when no slot matches (gate denies admission).
 * Returns {code, isPriced} when a slot exists — isPriced=false means
 * the slot is in the library but rate is 0 / unpopulated; the BOQ
 * generator routes that line as PROVISIONAL_SUM (rate pending) so it
 * stays visible to the engineer.
 */
interface SlotMatch {
  /** RateLibraryItem.code that matched, or null for Assembly-by-category. */
  code: string | null
  isPriced: boolean
}

function findRateLibrarySlot(item: EligibilityItem, rateLib: RateLibrarySnapshot): SlotMatch | null {
  const meta = (item.meta ?? {}) as Record<string, unknown>

  const tryCode = (code: string): SlotMatch | null => {
    if (!rateLib.rates.has(code)) return null
    const rate = rateLib.rates.get(code) ?? 0
    return { code, isPriced: rate > 0 }
  }

  // (1) Explicit code from derivedQuantityRules.
  if (typeof meta.rateLibraryCode === 'string') {
    const m = tryCode(meta.rateLibraryCode)
    if (m) return m
  }
  // (2) Legacy rate-hint.
  if (typeof meta.rateHint === 'string') {
    const m = tryCode(meta.rateHint)
    if (m) return m
  }
  // (3) Assembly-by-category (Assembly composes components → always
  //     produces a non-zero rate when present).
  if (rateLib.assemblies.has(item.category)) {
    return { code: null, isPriced: true }
  }
  // (4) Category-derived codes.
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

function num(d: { toString(): string } | null | undefined): number {
  if (!d) return 0
  const n = Number.parseFloat(d.toString())
  return Number.isFinite(n) ? n : 0
}
