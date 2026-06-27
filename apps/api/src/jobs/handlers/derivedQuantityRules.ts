/**
 * SPRINT-1.1 — DerivedQuantityRule engine.
 *
 * One schema, not five emitters. Each rule says:
 *   - which source data it consumes (STAIRCASE / DOOR / ROOM)
 *   - what TakeoffItem shape it emits (category, tag, unit)
 *   - which rate-library slot prices it
 *   - a PURE FUNCTION from source context → quantity
 *
 * Rates are NEVER baked into a rule. The formula returns a quantity
 * (and a reasoning string for the audit chip); the BOQ generator
 * looks up the unit rate via `rateLibraryCode` at PRICE time. If the
 * rate-library slot is empty, the line still emits + flows through
 * the eligibility gate (SPRINT-1.2), which keeps it out of the BOQ
 * until the user populates a rate.
 *
 * Sprint-1 seeds 5 rules (STAIRCASE×3, DOOR×2) that fill the gaps the
 * coverage matrix surfaced. Adding more rules later is a single push
 * to RULES — no new handlers, no new code in QUANTIFY.
 *
 * Status: DESIGN STUB. Not yet imported by QUANTIFY — waiting for
 * design sign-off before wiring.
 */
import type { TakeoffCategory } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────
// Source contexts
//
// Each "source" defines the shape of data the formula receives. The
// engine builds these once per project at QUANTIFY time from the
// existing extractor outputs (ROOMs, schedule DOORs, STAIRCASE
// detection). Per-emission rules (one row per ROOM) receive one
// context per source element; aggregate rules (one row for the whole
// project) receive a single rolled-up context.
// ─────────────────────────────────────────────────────────────────

export interface StaircaseCtx {
  source: 'STAIRCASE'
  /** One entry per detected STAIRCASE room. */
  staircases: Array<{
    roomId: string
    /** Risers detected from the drawing (null when not measurable). */
    risers: number | null
    /** Tread depth in metres if known; null otherwise. */
    treadDepth_m: number | null
    /** Stair width in metres (from drawing or default). */
    stairWidth_m: number | null
    /** Landing area in m² (from drawing or per-floor heuristic). */
    landingArea_m2: number | null
    /** Convenience: total run length in lm (risers × treadDepth). */
    totalLm: number | null
  }>
}

export interface DoorCtx {
  source: 'DOOR'
  /** Sum of door counts across the schedule (after sub-type split). */
  totalCount: number
  /** Sum of (count × width_mm)/1000 across all doors, in lm. */
  totalWidth_lm: number
  /** Per-tag breakdown for rules that need it (e.g. ironmongery
   *  PC rate depends on door type). */
  byTag: Array<{ tag: string; count: number; width_mm: number | null }>
}

export interface RoomCtx {
  source: 'ROOM'
  /** The single ROOM the per-room rule is firing on. */
  room: {
    id: string
    name: string
    description: string
    area_m2: number
    /** Aspect-prior or measured perimeter; null when unknown. */
    perimeter_lm: number | null
    finishCode: string | null
  }
}

export type SourceContext = StaircaseCtx | DoorCtx | RoomCtx

// ─────────────────────────────────────────────────────────────────
// Rule schema
// ─────────────────────────────────────────────────────────────────

export type Emission =
  /** One line per project, formula gets the aggregated context. */
  | 'aggregate'
  /** One line per ROOM (formula called per room). Sprint-1 doesn't
   *  use this — existing per-room emitters (paint, skirting, vanity)
   *  stay as they are. Reserved for future generality. */
  | 'per-room'

export interface DerivedQuantityRule {
  /** Stable id used as meta.derivedRuleId + for log lines. */
  id: string

  /** Which source the formula consumes. */
  source: 'STAIRCASE' | 'DOOR' | 'ROOM'

  /** aggregate = one BoqLine per project; per-room = one per ROOM. */
  emission: Emission

  /** TakeoffItem category for the emission. Drives section routing
   *  via CATEGORY_TO_SECTION. */
  targetCategory: TakeoffCategory

  /** Stable tag pattern. For aggregate rules this is the literal tag
   *  ('STAIR-TREAD'). For per-room rules append the roomId at runtime. */
  targetTag: string

  /** Display unit ('lm', 'm²', 'nr', 'item'). */
  outputUnit: string

  /** Human-readable line description (prefix). The formula appends
   *  a reasoning string so the audit chip reads naturally. */
  baseDescription: string

  /** Rate-library code the BOQ uses for pricing — e.g. 'STAIR-TREAD-LM'.
   *  Looked up at PRICE time; missing entry → eligibility gate keeps
   *  the line out of the BOQ until the user populates. */
  rateLibraryCode: string

  /** Pure function. context → { qty, reasoning } or null = skip. */
  formula: (ctx: SourceContext) => { qty: number; reasoning: string } | null
}

// ─────────────────────────────────────────────────────────────────
// Sprint-1 seed rules
// ─────────────────────────────────────────────────────────────────

const STAIR_TREAD: DerivedQuantityRule = {
  id: 'sprint1.stair-tread',
  source: 'STAIRCASE',
  emission: 'aggregate',
  targetCategory: 'OTHER',
  targetTag: 'STAIR-TREAD',
  outputUnit: 'lm',
  baseDescription: 'Stair tread (Grainy marble or per finish-plan)',
  rateLibraryCode: 'STAIR-TREAD-LM',
  formula: (ctx) => {
    if (ctx.source !== 'STAIRCASE') return null
    let totalLm = 0
    const parts: string[] = []
    for (const s of ctx.staircases) {
      if (s.totalLm == null) continue
      totalLm += s.totalLm
      parts.push(`stair ${s.roomId.slice(-6)} ${s.totalLm.toFixed(2)} lm`)
    }
    if (totalLm <= 0) return null
    return { qty: totalLm, reasoning: `Σ stair tread length = ${totalLm.toFixed(2)} lm (${parts.join(', ')})` }
  },
}

const STAIR_LAND: DerivedQuantityRule = {
  id: 'sprint1.stair-landing',
  source: 'STAIRCASE',
  emission: 'aggregate',
  targetCategory: 'OTHER',
  targetTag: 'STAIR-LAND',
  outputUnit: 'm²',
  baseDescription: 'Stair landing finish',
  rateLibraryCode: 'STAIR-LAND-M2',
  formula: (ctx) => {
    if (ctx.source !== 'STAIRCASE') return null
    let totalArea = 0
    const parts: string[] = []
    for (const s of ctx.staircases) {
      if (s.landingArea_m2 == null) continue
      totalArea += s.landingArea_m2
      parts.push(`stair ${s.roomId.slice(-6)} ${s.landingArea_m2.toFixed(2)} m²`)
    }
    if (totalArea <= 0) return null
    return { qty: totalArea, reasoning: `Σ landing area = ${totalArea.toFixed(2)} m² (${parts.join(', ')})` }
  },
}

const STAIR_HANDRAIL: DerivedQuantityRule = {
  id: 'sprint1.stair-handrail',
  source: 'STAIRCASE',
  emission: 'aggregate',
  targetCategory: 'JOINERY',
  targetTag: 'STAIR-HANDRAIL',
  outputUnit: 'rm',
  baseDescription: 'Stair handrail (wall-mounted, MDF + natural veneer)',
  rateLibraryCode: 'STAIR-HANDRAIL-RM',
  formula: (ctx) => {
    if (ctx.source !== 'STAIRCASE') return null
    let totalLm = 0
    for (const s of ctx.staircases) {
      if (s.totalLm == null) continue
      // Handrail length ≈ stair length (per flight, single side). The
      // multiplier lives in the rule formula, not in a rate.
      totalLm += s.totalLm
    }
    if (totalLm <= 0) return null
    return { qty: totalLm, reasoning: `Handrail length = stair length = ${totalLm.toFixed(2)} rm` }
  },
}

const DOOR_THRESHOLD: DerivedQuantityRule = {
  id: 'sprint1.door-threshold',
  source: 'DOOR',
  emission: 'aggregate',
  targetCategory: 'OTHER',
  targetTag: 'THRESHOLD',
  outputUnit: 'lm',
  baseDescription: 'Door threshold (PC-rate, supply only)',
  rateLibraryCode: 'THRESHOLD-LM',
  formula: (ctx) => {
    if (ctx.source !== 'DOOR') return null
    if (ctx.totalWidth_lm <= 0) return null
    return {
      qty: ctx.totalWidth_lm,
      reasoning: `Σ door widths = ${ctx.totalWidth_lm.toFixed(2)} lm (across ${ctx.totalCount} door${ctx.totalCount === 1 ? '' : 's'})`,
    }
  },
}

const DOOR_IRONMONGERY: DerivedQuantityRule = {
  id: 'sprint1.door-ironmongery',
  source: 'DOOR',
  emission: 'aggregate',
  targetCategory: 'OTHER',
  targetTag: 'IRONMONGERY',
  outputUnit: 'nr',
  baseDescription: 'Door ironmongery (hardware set per door, PC-rate)',
  rateLibraryCode: 'IRONMONGERY-PC',
  formula: (ctx) => {
    if (ctx.source !== 'DOOR') return null
    if (ctx.totalCount <= 0) return null
    return {
      qty: ctx.totalCount,
      reasoning: `1 ironmongery set per door × ${ctx.totalCount} doors`,
    }
  },
}

/** All Sprint-1 rules. Adding a new one = push here + populate the
 *  rate-library slot. No other code path touched. */
export const SPRINT_1_RULES: DerivedQuantityRule[] = [
  STAIR_TREAD,
  STAIR_LAND,
  STAIR_HANDRAIL,
  DOOR_THRESHOLD,
  DOOR_IRONMONGERY,
]

// ─────────────────────────────────────────────────────────────────
// Engine signature (not implemented yet — design sign-off first)
// ─────────────────────────────────────────────────────────────────

/**
 * Run a ruleset against the project's source contexts. Each rule
 * that fires returns one upsert-payload (or null). QUANTIFY wires
 * the payloads through its existing upsertDerived() so the items
 * land in the takeoff with the same provenance + status semantics
 * as paint / skirting / vanity emissions.
 */
export interface RuleEmission {
  ruleId: string
  category: TakeoffCategory
  tag: string
  unit: string
  qty: number
  description: string
  reasoning: string
  rateLibraryCode: string
}

export function runDerivedQuantityRules(
  rules: DerivedQuantityRule[],
  contexts: {
    staircase?: StaircaseCtx
    door?: DoorCtx
    rooms?: RoomCtx[]
  },
): RuleEmission[] {
  const out: RuleEmission[] = []
  for (const rule of rules) {
    if (rule.emission === 'aggregate') {
      const ctx =
        rule.source === 'STAIRCASE' ? contexts.staircase
        : rule.source === 'DOOR' ? contexts.door
        : null
      if (!ctx) continue
      const result = rule.formula(ctx)
      if (!result) continue
      out.push({
        ruleId: rule.id,
        category: rule.targetCategory,
        tag: rule.targetTag,
        unit: rule.outputUnit,
        qty: result.qty,
        description: rule.baseDescription,
        reasoning: result.reasoning,
        rateLibraryCode: rule.rateLibraryCode,
      })
    } else {
      // per-room — reserved for future. Sprint-1 doesn't use this branch.
      for (const room of contexts.rooms ?? []) {
        const result = rule.formula(room)
        if (!result) continue
        out.push({
          ruleId: rule.id,
          category: rule.targetCategory,
          tag: `${rule.targetTag}-${room.room.id.slice(-8)}`,
          unit: rule.outputUnit,
          qty: result.qty,
          description: `${rule.baseDescription} — ${room.room.name}`,
          reasoning: result.reasoning,
          rateLibraryCode: rule.rateLibraryCode,
        })
      }
    }
  }
  return out
}
