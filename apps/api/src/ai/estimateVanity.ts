/**
 * AI-estimation engine roadmap #2 — VANITY count.
 *
 * Deterministic, zero-tokens. Strong prior: one stone-top vanity per
 * bathroom (typical residential villa). VANITY rate = 3400 AED/No
 * (rate code VANITY in the library).
 *
 * Honest reliability:
 *   - Both bathroom-finish AND bathroom-name match: ~95% (typical)
 *   - Single signal (finish only OR name only): ~80% (less certain,
 *     maybe a service WC without a vanity, or a powder room with
 *     a console basin rather than a stone-top vanity)
 *
 * The reviewer sees the suggestion + reasoning ("1 stone-top vanity
 * per bathroom · finish=BATHROOM + name matches bathroom pattern")
 * and overrides qtyFinal before Confirming (e.g. a double-vanity
 * master bath becomes qtyFinal=2). The output is a SUGGESTION at
 * status='AI' — never enters the BOQ until Confirm.
 *
 * What this does NOT estimate:
 *   - Double-vanity master baths (reviewer overrides 1 → 2 inline)
 *   - Service WCs without a vanity (reviewer rejects / sets to 0)
 *   - WC + separate vanity layouts (count stays 1; rare; reviewer judges)
 */

/** Same name pattern used by isBathroomNamed in finishMapColorPass. */
const BATHROOM_NAME_RE = /\b(BATH|TOILET|POWDER|WC|LAVATORY|RESTROOM)\b/i

/**
 * Names that contain a bathroom keyword but aren't a room with a vanity —
 * the BATH keyword is incidental ("SKYLIGHT 04 ABOVE BATH 01" is a
 * ceiling skylight feature, not a billable bathroom; VOID OVER BATH is
 * a structural void above a bathroom on the upper floor). Expert
 * confirmation on run-6: SKYLIGHT 04 ABOVE BATH 01 was a vision-side
 * false-positive that should never propose a vanity.
 */
const NON_ROOM_BATH_CONTEXT_RE = /\b(SKYLIGHT|VOID|ABOVE|OVER|UNDER)\b/i

export interface VanityEstimate {
  /** Suggested count. Always 1 for v1 (reviewer overrides inline). */
  count: number
  /** Confidence 0-100. */
  confidence: number
  /** Human-readable reasoning shown in the verify UI. */
  reasoning: string
  /** Which signals fired. */
  signals: { finishMatch: boolean; nameMatch: boolean }
}

/**
 * Should this room get a vanity suggestion? Two signals — finish_code
 * of BATHROOM (confirmed by reviewer or the BATHROOM sentinel from the
 * legend) or the room name matching the bathroom pattern.
 *
 * Either signal is enough to suggest. Both → higher confidence.
 * Neither → no suggestion (return null).
 */
export function estimateVanityForRoom(
  roomName: string,
  finishCode: string | null,
): VanityEstimate | null {
  // Drop the "bath keyword but not a room" false positives first.
  // Without this, ceiling skylights and structural voids that happen
  // to reference a bathroom in their label (e.g. "SKYLIGHT 04 ABOVE
  // BATH 01") would propose a vanity.
  if (NON_ROOM_BATH_CONTEXT_RE.test(roomName)) return null

  const isBathFinish = finishCode === 'BATHROOM'
  const isBathName = BATHROOM_NAME_RE.test(roomName)
  if (!isBathFinish && !isBathName) return null

  const both = isBathFinish && isBathName
  const confidence = both ? 95 : 80
  const reasons: string[] = []
  if (isBathFinish) reasons.push('finish=BATHROOM')
  if (isBathName) reasons.push('name matches bathroom pattern')
  const reasoning =
    `1 stone-top vanity per bathroom (typical residential) · ${reasons.join(' + ')}`
  return {
    count: 1,
    confidence,
    reasoning,
    signals: { finishMatch: isBathFinish, nameMatch: isBathName },
  }
}
