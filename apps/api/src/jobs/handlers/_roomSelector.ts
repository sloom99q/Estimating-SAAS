/**
 * Sprint-9 S9-0 — single source of truth for "which TakeoffItems are
 * billable rooms" vs "which are building-level statements".
 *
 * The Sprint-8 BOQ posted CL03 at 1,420 m² because QUANTIFY summed the
 * room areas without noticing that one of the rows was the *whole
 * building* ("Proposed G+1 Villa @ Plot 4357 Al Rahmaniya" = 972 m²).
 * Both the scorer and QUANTIFY now consume the same selector so they
 * can't drift apart again.
 *
 * Rule of thumb for AREA_STATEMENT (NOT a billable room):
 *   - Names that reference the whole project / plot / villa
 *   - Floor-level summaries ("GROUND FLOOR", "FIRST FLOOR", "ROOF" alone)
 *   - Roof-level summaries ("ACCESSIBLE ROOF", "NON-ACCESSIBLE ROOF",
 *     "ROOF ACCESS")
 *   - Sub-building structures the architect tags separately (GARAGE
 *     BLOCK, the main villa label)
 *   - Pseudo-rooms that are layout / overview captions (PLAN AREA,
 *     SETTING OUT, BUA)
 *
 * Rooms that LOOK building-level but ARE billable (POWDER ROOM,
 * MASTER BATHROOM, MAID'S ROOM) keep matching as rooms — we use
 * specific-word patterns, not generic area thresholds.
 */

import type { TakeoffItem } from '@prisma/client'

const AREA_STATEMENT_PATTERNS: RegExp[] = [
  /\bvilla\b/i,
  /\bplot\b/i,
  /\bproposed\b/i,
  /\bbua\b/i,
  /^\s*ground\s*floor(\s|$|—)/i,
  /^\s*first\s*floor(\s|$|—)/i,
  /^\s*roof(\s|$|—)/i,
  /\bsetting\s*out\b/i,
  /\bplan\s*area\b/i,
  /\bgarage\s*block\b/i,
  /\baccessible\s*roof\b/i,
  /\bnon[\s-]*accessible\s*roof\b/i,
  /\bplot\s*boundary\b/i,
]

/**
 * One billable-room test, shared by the scorer and QUANTIFY. Pass the
 * raw `description` (typically `"<name> — <floor>"`); the regex set
 * operates on the whole string so the floor decorator is fine.
 */
export function isAreaStatement(description: string): boolean {
  for (const re of AREA_STATEMENT_PATTERNS) {
    if (re.test(description)) return true
  }
  return false
}

/**
 * `selectBillableRooms(items)` — the one selector. Filters to category
 * ROOM (deleted or not handled by the caller), drops anything matching
 * `isAreaStatement`, returns the rest.
 */
export function selectBillableRooms<T extends Pick<TakeoffItem, 'category' | 'description' | 'deletedAt'>>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter(
    (i) => i.category === 'ROOM' && i.deletedAt === null && !isAreaStatement(i.description),
  )
}

/**
 * Mirror of selectBillableRooms — returns the *area-statement* rows so
 * a one-shot reclassifier can flip their category in place.
 */
export function selectAreaStatements<T extends Pick<TakeoffItem, 'category' | 'description' | 'deletedAt'>>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter(
    (i) => i.category === 'ROOM' && i.deletedAt === null && isAreaStatement(i.description),
  )
}

/** Free-text category we set on reclassified TakeoffItems. */
export const AREA_STATEMENT_CATEGORY = 'AREA_STATEMENT'
