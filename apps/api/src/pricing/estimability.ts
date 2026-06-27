/**
 * CLASSIFIER-1 (2026-06-27) — default estimability per TakeoffCategory.
 *
 * The whole-product principle, articulated by an estimator reading
 * real UAE contractor quotes: ~40-50% of a villa BOQ is genuinely
 * provisional — the contractor doesn't estimate joinery, stone
 * cladding, façade, home automation, MEP-without-drawings. They
 * write P/S allowances and let suppliers quote. The app should mirror
 * that: MEASURE the measurable, REFUSE the rest as P/S. Don't fake
 * confidence with sockets = rooms × 6 guesses.
 *
 * This table encodes WHICH categories get which default. The
 * classifier is purely category-driven for now; later phases can
 * override per item (e.g. if the project DOES include an MEP drawing
 * set, the MEP categories promote from PROVISIONAL → DERIVED).
 */
import type { Estimability, TakeoffCategory } from '@prisma/client'

/// Default estimability assigned to a TakeoffItem at creation. The
/// reviewer can override per row; this is just the starting point.
///
/// Rationale per bucket:
///
///   MEASURED — read directly from drawing/schedule. No math.
///     - ROOM (areas from MTEXT/vision)
///     - DOOR / WINDOW (counts from schedule)
///
///   DERIVED — measured fact × multiplier (formula visible).
///     - FLOOR_FINISH, WALL_FINISH, CEILING — area derivations
///     - SCREED — Σ floor area
///     - PAINT — perimeter × height
///     - PLASTER, BLOCKWORK, WATERPROOFING — area-driven
///     - SANITARY — fixture count from bathroom rooms
///
///   PROVISIONAL — contractor-typical P/S. The app deliberately
///     does NOT pretend to estimate. UAE villa norms:
///     - JOINERY (kitchens, wardrobes, vanities — custom by supplier)
///     - METAL, GRC (fabrication scopes vary wildly)
///     - EXTERNAL (landscape, pool — separate scopes)
///     - SKIRTING (cost is supplier-driven by material; we surface
///       linear-metres but pricing is P/S until material chosen)
///     - STRUCTURE_PROV, MEP_PROV (already typed as P/S)
///     - MEP_HVAC, MEP_ELEC, MEP_PLUMB, MEP_ELV (each discipline
///       defaults to ONE P/S allowance until the engineer's drawings
///       are uploaded; per CLASSIFIER-3).
///
///   PLACEHOLDER — pure guesses we never show an engineer. Currently
///     none default here at category level; the MEP rule engine
///     flips individual rules to PLACEHOLDER when factor/rate
///     confidence < threshold.
///
///   MANUAL — human-typed lines, handled at insert (not via this
///     defaulter).
///
///   AREA_STATEMENT — never billable; the BOQ generator already
///     filters them. Marked MEASURED for completeness; never reaches
///     the BOQ.
///
///   OTHER — catch-all; defaults to PROVISIONAL because we don't
///     know enough about the line to confidently price it.
export const DEFAULT_ESTIMABILITY: Record<TakeoffCategory, Estimability> = {
  ROOM: 'MEASURED',
  AREA_STATEMENT: 'MEASURED',
  DOOR: 'MEASURED', // rate-cardable (variance is bounded); price normally
  // CLASSIFIER-5 — windows ship as P/S even though we measure the
  // count. Glazing-spec cost variance (curtain wall systems) makes
  // count × default-rate misleading; estimator promotes to MEASURED
  // when a real glazing-spec quote arrives.
  WINDOW: 'PROVISIONAL_SUM',

  FLOOR_FINISH: 'DERIVED',
  WALL_FINISH: 'DERIVED',
  CEILING: 'DERIVED',
  SCREED: 'DERIVED',
  PAINT: 'DERIVED',
  PLASTER: 'DERIVED',
  BLOCKWORK: 'DERIVED',
  WATERPROOFING: 'DERIVED',
  SANITARY: 'DERIVED',

  // CLASSIFIER-5 — LUMP_SUM (supplier-quoted whole-scope) for the
  // canonical contractor-LS categories.
  JOINERY: 'LUMP_SUM',

  // CLASSIFIER-5 — PROVISIONAL_SUM (allowance pending) for the
  // categories real UAE quotes mark as P/S until supplier quote /
  // scope confirmation.
  SKIRTING: 'PROVISIONAL_SUM',
  METAL: 'PROVISIONAL_SUM',
  GRC: 'PROVISIONAL_SUM',
  EXTERNAL: 'PROVISIONAL_SUM',
  STRUCTURE_PROV: 'PROVISIONAL_SUM',
  MEP_PROV: 'PROVISIONAL_SUM',

  // MEP rule-engine categories — these only EXIST when QUANTIFY
  // emits TakeoffItems for them, which (per CLASSIFIER-4
  // PRECONDITION RULE) only happens when the project has real
  // MEP-discipline sheets. When present, hasMepDrawings is true,
  // so effectiveEstimability auto-promotes PROVISIONAL_SUM →
  // DERIVED for these.
  MEP_HVAC: 'PROVISIONAL_SUM',
  MEP_ELEC: 'PROVISIONAL_SUM',
  MEP_PLUMB: 'PROVISIONAL_SUM',
  MEP_ELV: 'PROVISIONAL_SUM',

  // SPRINT-1.3 — contractor-typical P/S categories. All collapse via
  // CLASSIFIER-2 into a single PROVISIONAL_SUM row per category, with
  // psAmount=null until the user sets an allowance.
  STONE_CLADDING: 'PROVISIONAL_SUM',
  FACADE_SCREEN: 'PROVISIONAL_SUM',
  HOME_AUTOMATION: 'PROVISIONAL_SUM',

  OTHER: 'PROVISIONAL_SUM',
}

/// Pure — no DB. Returns the default estimability for a category.
/// `meta` can carry overrides (e.g. an MEP rule with low factor +
/// rate confidence flips to PLACEHOLDER; a JOINERY line tagged with
/// supplier quote evidence promotes to MEASURED).
export function classifyEstimability(
  category: TakeoffCategory,
  meta?: Record<string, unknown> | null,
): Estimability {
  // PLACEHOLDER override: any item whose meta carries a
  // `mepFactorConfidence` AND `mepRateConfidence` both below 0.6 is
  // a guess — never let it hit an engineer-facing export.
  if (meta && typeof meta === 'object') {
    const factor = typeof meta.mepFactorConfidence === 'number' ? meta.mepFactorConfidence : null
    const rate = typeof meta.mepRateConfidence === 'number' ? meta.mepRateConfidence : null
    if (factor !== null && rate !== null && factor < 0.6 && rate < 0.6) {
      return 'PLACEHOLDER'
    }
  }
  return DEFAULT_ESTIMABILITY[category] ?? 'PROVISIONAL'
}

/// MEP-discipline categories — used for auto-promote (when MEP
/// drawings exist) + collapse-by-discipline (CLASSIFIER-2).
export const MEP_CATEGORIES: ReadonlySet<TakeoffCategory> = new Set([
  'MEP_HVAC',
  'MEP_ELEC',
  'MEP_PLUMB',
  'MEP_ELV',
])

/// CLASSIFIER-2 (override) — per-project map: which categories the
/// user has explicitly pinned to a specific Estimability. Pinned
/// values WIN over auto-promote (a contractor may have drawings yet
/// still choose to quote MEP provisional).
///
/// Stored as Project.estimabilityOverrides Json. Empty / null =
/// no overrides; defaults + auto-promote apply.
export type EstimabilityOverrides = Partial<Record<TakeoffCategory, Estimability>>

export function parseEstimabilityOverrides(raw: unknown): EstimabilityOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const out: EstimabilityOverrides = {}
  const ESTIMABILITY_SET: ReadonlySet<Estimability> = new Set([
    'MEASURED',
    'DERIVED',
    'PROVISIONAL',
    'PLACEHOLDER',
    'MANUAL',
  ])
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && ESTIMABILITY_SET.has(v as Estimability)) {
      out[k as TakeoffCategory] = v as Estimability
    }
  }
  return out
}

/// Compute the effective estimability for an item, applying:
///   1. Project override (user-pinned WINS over everything).
///   2. Auto-promote: if MEP drawings exist for the project, MEP
///      categories promote PROVISIONAL → DERIVED.
///   3. Per-item PLACEHOLDER detection from meta (low conf rules).
///   4. Category default.
export function effectiveEstimability(args: {
  category: TakeoffCategory
  meta?: Record<string, unknown> | null
  overrides?: EstimabilityOverrides
  hasMepDrawings?: boolean
}): Estimability {
  const overrideValue = args.overrides?.[args.category]
  if (overrideValue) return overrideValue

  const base = classifyEstimability(args.category, args.meta)
  // Auto-promote: MEP categories flip PROVISIONAL_SUM → DERIVED when
  // the project has any MEP-discipline drawing sheets. PLACEHOLDER
  // stays PLACEHOLDER even with drawings (rate guess doesn't
  // become credible just because we have the floor plan). LUMP_SUM
  // stays LUMP_SUM (the contractor already has a fixed quote, not
  // promoting that to DERIVED just because we got plans).
  if (
    args.hasMepDrawings &&
    base === 'PROVISIONAL_SUM' &&
    MEP_CATEGORIES.has(args.category)
  ) {
    return 'DERIVED'
  }
  return base
}

/// CLASSIFIER-2 — default P/S allowance per discipline, in AED. Used
/// when an item routes to PROVISIONAL without a more specific
/// estimator-set amount.
///
/// MEP NUMBERS ARE REAL — pulled from the engineer's actual takeoff
/// for the Lami villa reference project (2026-06-27). These are
/// contractor-confirmed discipline subtotals, NOT sketches. The
/// engineer also confirmed his main 2.059M AED quote is WITHOUT MEP
/// — MEP is a separate provisional ON TOP of that figure. So the
/// BOQ correctly carries these as P/S lines additive to the priced
/// scope (HVAC + Elec + Plumb&Drainage + ELV = 791k AED MEP
/// provisional total).
///
/// Set to `null` when the BOQ should emit a P/S line with no
/// pre-filled amount — surfaces as '—' in the XLSX (per ADR-014).
export const DEFAULT_PROVISIONAL_AED: Partial<Record<TakeoffCategory, number | null>> = {
  // MEP disciplines — discipline-level lump-sums from engineer
  // takeoff. MEP_PLUMB covers plumbing + drainage as one figure
  // (the engineer reported them combined; the app doesn't yet
  // split them).
  MEP_HVAC: 252000,
  MEP_ELEC: 190000,
  MEP_PLUMB: 235000,
  MEP_ELV: 114000,
  // Joinery + finishes that the contractor quotes from suppliers.
  JOINERY: null, // depend on schedule — leave blank
  METAL: null,
  GRC: null,
  EXTERNAL: null,
  SKIRTING: null,
  // Structural / catch-alls.
  STRUCTURE_PROV: null,
  MEP_PROV: null,
  OTHER: null,
}
