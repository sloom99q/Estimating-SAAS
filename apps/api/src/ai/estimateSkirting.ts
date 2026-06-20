/**
 * AI-estimation engine roadmap #1 — SKIRTING.
 *
 * Deterministic, zero-tokens. The architect prints room AREA on the
 * plan view but never the perimeter. We estimate the perimeter from
 * the area + a per-room-type aspect-ratio prior, then derive the
 * skirting linear-meter count.
 *
 * Honest reliability:
 *   - Square rooms (BATHROOM, BEDROOM): ±10%
 *   - Mildly elongated rooms (LIVING, KITCHEN, FAMILY): ±15%
 *   - Strongly elongated rooms (CORRIDOR, BALCONY): ±20-25%
 *   - Irregular L/T-shaped rooms: ±30%
 *
 * The reviewer sees the suggestion + the reasoning ("LIVING typical
 * aspect 1.4:1 · area 35.20 m² → perimeter 24.5 m") and overrides
 * qtyFinal before clicking Confirm. The output is a SUGGESTION row in
 * the takeoff table at status='AI' — it never enters the BOQ until
 * the reviewer flips it to EDITED.
 *
 * Door deductions (~0.9m × N doors per room) skipped in v1 per the
 * design doc — perimeter error swamps the deduction. Add when accuracy
 * needs it.
 */

/** Aspect ratio = longer_side / shorter_side, observed-typical. */
interface AspectRatioRule {
  /** Case-insensitive substring tested against the room name. First match wins; rules are ordered by specificity. */
  match: RegExp
  /** longer / shorter side ratio. 1.0 = perfect square. */
  ratio: number
  /** Human-readable name for the reasoning line. */
  prior: string
  /** Confidence score for this match (0-100). High = name strongly implies shape. */
  confidence: number
}

/**
 * Observed-typical aspect ratios for the room types in a residential
 * villa. Order matters — first match wins, so put the more specific
 * patterns first (CORRIDOR before BEDROOM, etc.). Numbers from
 * everyday architectural observation; the reviewer overrides per row
 * when a particular room is squarer or more elongated than typical.
 */
export const ASPECT_RATIO_TABLE: AspectRatioRule[] = [
  { match: /\b(corridor|passage|hall)\b/i, ratio: 5.0, prior: 'CORRIDOR/PASSAGE 5:1', confidence: 70 },
  { match: /\b(balcony|terrace|veranda)\b/i, ratio: 3.0, prior: 'BALCONY/TERRACE 3:1', confidence: 65 },
  { match: /\b(bath|wc|toilet|powder|lavatory|restroom)\b/i, ratio: 1.4, prior: 'BATHROOM/POWDER 1.4:1', confidence: 75 },
  { match: /\b(kitchen)\b/i, ratio: 1.5, prior: 'KITCHEN 1.5:1', confidence: 70 },
  { match: /\b(foyer|lobby|entrance)\b/i, ratio: 1.5, prior: 'FOYER/LOBBY 1.5:1', confidence: 65 },
  { match: /\b(garage|driver|maid|laundry|linen|store|storage|utility|mep)\b/i, ratio: 1.3, prior: 'SERVICE ROOM 1.3:1', confidence: 70 },
  { match: /\b(bedroom|bd|guest|master|family|play|dining|dinning|living|sitting|study)\b/i, ratio: 1.4, prior: 'LIVING/BEDROOM 1.4:1', confidence: 70 },
]

/** Fallback when nothing matches: assume rectangular with mild aspect ratio. */
export const FALLBACK_RULE: AspectRatioRule = {
  match: /.*/,
  ratio: 1.3,
  prior: 'GENERIC 1.3:1',
  confidence: 50,
}

export interface SkirtingEstimate {
  /** Perimeter in linear meters. */
  perimeterLm: number
  /** Confidence 0-100. */
  confidence: number
  /** Human-readable reasoning shown in the verify UI. */
  reasoning: string
  /** Which prior rule fired. */
  priorName: string
  /** Aspect ratio used. */
  aspectRatio: number
}

/**
 * Compute perimeter from area + an aspect-ratio prior.
 *
 *   ratio = a / b      (a = long side, b = short side)
 *   area  = a × b      → b = √(area / ratio),  a = b × ratio = √(area × ratio)
 *   P     = 2 × (a + b)
 *
 * Returns null only when area is non-positive (room had no measured area).
 */
export function estimateSkirtingPerimeter(
  roomName: string,
  areaM2: number | null,
): SkirtingEstimate | null {
  if (areaM2 == null || !Number.isFinite(areaM2) || areaM2 <= 0) return null

  const rule = ASPECT_RATIO_TABLE.find((r) => r.match.test(roomName)) ?? FALLBACK_RULE
  const shortSide = Math.sqrt(areaM2 / rule.ratio)
  const longSide = shortSide * rule.ratio
  const perimeterLm = 2 * (longSide + shortSide)
  const reasoning =
    `${rule.prior} aspect prior · area ${areaM2.toFixed(2)} m² → ` +
    `${longSide.toFixed(2)} × ${shortSide.toFixed(2)} m → perimeter ${perimeterLm.toFixed(2)} lm`
  return {
    perimeterLm,
    confidence: rule.confidence,
    reasoning,
    priorName: rule.prior,
    aspectRatio: rule.ratio,
  }
}

/**
 * Should this room get skirting at all? Skip:
 *   - BATHROOM-finished rooms (waterproofing wraps up the wall, no
 *     skirting strip)
 *   - ST03 (external pavement)
 *   - Staircase rooms (separate stair lines emit via QUANTIFY OTHER)
 *   - Open spaces (balconies, terraces) where skirting would be a
 *     trip hazard / unsightly along the parapet — defer to estimator
 *     judgment
 *   - Rooms with no confirmed floor finish (don't estimate over the
 *     pending bucket — let the reviewer confirm a floor first)
 */
export function shouldSkirtRoom(
  roomName: string,
  finishCode: string | null,
): boolean {
  if (!finishCode) return false
  if (finishCode === 'BATHROOM') return false
  if (finishCode === 'ST03') return false
  if (/\b(stair|staircase)\b/i.test(roomName)) return false
  if (/\b(balcony|terrace|veranda)\b/i.test(roomName)) return false
  return true
}
