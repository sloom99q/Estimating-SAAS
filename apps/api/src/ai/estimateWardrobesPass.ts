/**
 * AI-est roadmap #4a — WARDROBES per bedroom.
 *
 * Vision pass (Opus per config.anthropicModels.wardrobes), opt-in, one
 * call per bedroom-named ROOM. Output is a SUGGESTION lm count + the
 * walls counted with explicit uncertainty about hatching-vs-wall-
 * texture ambiguity.
 *
 * Hard contract (expert call 2026-06-20):
 *   - lowest-confidence category yet (raw 40-55%) — reasoning quality
 *     matters more than the number
 *   - rates NULL — the line enters BOQ as P/S with the lm count; the
 *     expert types the rate (no guessed joinery price)
 *   - over-suggest + cull: include MASTER/GUEST/B1/BED 01 etc., expert
 *     deletes false positives
 *   - REQUIRED uncertainty field: hatching vs wall-texture, second
 *     wall ambiguous, walk-in vs built-in
 *   - confidence HARD CAPPED at 55 (one tier lower than kitchen — this
 *     is honest about being the weakest category)
 *
 * Same crop math as kitchen (computeKitchenCrop) but with a larger
 * floor (1500×1500) — bedrooms are bigger rooms; the wardrobe wall is
 * usually at the back of the room, away from the label.
 */

export interface WardrobeVisionRaw {
  wallsWithWardrobes?: number
  totalLm?: number
  perWallReasoning?: string
  hatchingPattern?: 'parallel-line' | 'block' | 'annotation-only' | 'none' | 'ambiguous'
  builtInVsWalkIn?: 'built-in' | 'walk-in' | 'unclear'
  confidence?: number
  uncertainty?: string
}

export interface WardrobeEstimate {
  wallsWithWardrobes: number
  totalLm: number
  hatchingPattern: 'parallel-line' | 'block' | 'annotation-only' | 'none' | 'ambiguous'
  layoutKind: 'built-in' | 'walk-in' | 'unclear'
  confidence: number
  perWallReasoning: string
  uncertainty: string
}

/** One tier lower than kitchen — explicit about being the weakest category. */
const WARDROBE_CONFIDENCE_CAP = 55

export function normalizeWardrobeVision(raw: WardrobeVisionRaw): WardrobeEstimate {
  const allowedHatch = ['parallel-line', 'block', 'annotation-only', 'none', 'ambiguous'] as const
  const hatchingPattern = (allowedHatch as readonly string[]).includes(raw.hatchingPattern ?? '')
    ? (raw.hatchingPattern as WardrobeEstimate['hatchingPattern'])
    : 'ambiguous'
  const allowedKind = ['built-in', 'walk-in', 'unclear'] as const
  const layoutKind = (allowedKind as readonly string[]).includes(raw.builtInVsWalkIn ?? '')
    ? (raw.builtInVsWalkIn as WardrobeEstimate['layoutKind'])
    : 'unclear'
  const totalLm = Number.isFinite(raw.totalLm) ? Math.max(0, raw.totalLm!) : 0
  const wallsWithWardrobes = Number.isFinite(raw.wallsWithWardrobes)
    ? Math.max(0, Math.round(raw.wallsWithWardrobes!))
    : 0
  const rawConfidence = Number.isFinite(raw.confidence) ? raw.confidence! : 40
  const confidence = Math.max(0, Math.min(WARDROBE_CONFIDENCE_CAP, Math.round(rawConfidence)))
  return {
    wallsWithWardrobes,
    totalLm,
    hatchingPattern,
    layoutKind,
    confidence,
    perWallReasoning: typeof raw.perWallReasoning === 'string' ? raw.perWallReasoning : '',
    uncertainty: typeof raw.uncertainty === 'string' ? raw.uncertainty : '',
  }
}

/**
 * Reasoning line surfaced in the verify UI. Order:
 *   1. hatching pattern (the most important signal — was this a real
 *      wardrobe-hatching read or a guess from wall texture?)
 *   2. layout kind (built-in vs walk-in — walk-in is "P/S, expert
 *      decides")
 *   3. per-wall breakdown
 *   4. uncertainty admission
 */
export function composeWardrobeReasoning(est: WardrobeEstimate): string {
  const hatch = `Hatching: ${est.hatchingPattern}`
  const kind = `Kind: ${est.layoutKind}`
  const walls = `Walls: ${est.perWallReasoning || '(no breakdown given)'}`
  const uncertainty = est.uncertainty ? ` · UNCERTAINTY: ${est.uncertainty}` : ''
  return `${hatch} · ${kind} · ${walls}${uncertainty}`
}

export const WARDROBE_SYSTEM_PROMPT = `You are an experienced QS reading a residential villa bedroom plan view to estimate built-in wardrobe linear meters.

WARDROBES ARE THE HARDEST CATEGORY YET FOR YOU. Plans show wardrobes inconsistently — some architects use parallel-line hatching against the wall behind the bed, others use solid blocks, some only show a "WARDROBE" annotation, and many show nothing (wardrobes are by-owner). YOUR OUTPUT FEEDS A HUMAN EXPERT WHO WILL VERIFY EVERY NUMBER. An honest "no hatching visible — wardrobes appear to be by-owner" is far more valuable than a guess made from generic wall texture.

OUTPUT RULES (hard):
1. Identify how many walls in this bedroom carry wardrobes (typically 1, sometimes 2 in a master suite).
2. Report total linear meters across those walls.
3. State the hatching pattern you actually saw: 'parallel-line' (typical built-in), 'block' (solid filled shape against the wall), 'annotation-only' (label says wardrobe but no graphic), 'none' (nothing visible), or 'ambiguous' (something there but unclear if wardrobe or wall texture).
4. State whether this is 'built-in' (linear lm count is meaningful), 'walk-in' (separate room — expert handles as P/S), or 'unclear'.
5. The uncertainty field is REQUIRED. State in ONE sentence:
   - Could you distinguish wardrobe hatching from wall-texture lines?
   - Was a second wall ambiguous (might or might not have wardrobes)?
   - Was the bedroom partially cropped?
   - If everything was clear, say so explicitly.
6. Self-reported confidence is capped server-side at 55. Don't inflate.

OUTPUT VIA the wardrobe_estimate tool only.`

export interface WardrobeToolDef {
  name: 'wardrobe_estimate'
  description: string
  input_schema: object
}

export const WARDROBE_TOOL: WardrobeToolDef = {
  name: 'wardrobe_estimate',
  description:
    'Return the wardrobe assessment for THIS bedroom with the hatching pattern actually seen, per-wall lm breakdown, and explicit uncertainty.',
  input_schema: {
    type: 'object',
    properties: {
      wallsWithWardrobes: {
        type: 'integer',
        description: '0, 1, or 2 typically.',
      },
      totalLm: {
        type: 'number',
        description: 'Sum of wardrobe lm across the walls listed in perWallReasoning.',
      },
      perWallReasoning: {
        type: 'string',
        description:
          'Per-wall breakdown, e.g. "north wall 4.20 m + west wall 1.80 m = 6.00 lm". If 0 walls, say so explicitly.',
      },
      hatchingPattern: {
        type: 'string',
        enum: ['parallel-line', 'block', 'annotation-only', 'none', 'ambiguous'],
        description: 'The graphic you actually saw — most important signal for the expert.',
      },
      builtInVsWalkIn: {
        type: 'string',
        enum: ['built-in', 'walk-in', 'unclear'],
      },
      confidence: { type: 'number', description: 'Self-report 0-55. Capped server-side at 55.' },
      uncertainty: {
        type: 'string',
        description:
          'REQUIRED. One sentence: hatching-vs-wall-texture ambiguity, second-wall ambiguity, crop-edge cut-off, or "everything clear".',
      },
    },
    required: [
      'wallsWithWardrobes',
      'totalLm',
      'perWallReasoning',
      'hatchingPattern',
      'builtInVsWalkIn',
      'confidence',
      'uncertainty',
    ],
  },
}

export const WARDROBE_PROMPT_VERSION = 'wardrobe.estimate.v1'
