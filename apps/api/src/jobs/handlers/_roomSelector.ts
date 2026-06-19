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
 * P3 — title-block / schedule-frame / drawing-meta strings that the
 * vision pass occasionally returns as "room names" on a cold UI upload.
 * These are NOT area statements (no measurable area) — they're just
 * artefacts of the LLM mis-reading the title-block region or a
 * schedule sheet. Hard-deny: drop at TakeoffItem creation.
 *
 * Distinct from AREA_STATEMENT (which gets stored at a separate
 * category and surfaces on the BUA card). A "DRAWING TITLE" entry has
 * no row in either table — it's just noise.
 */
const NOT_A_ROOM_PATTERNS: RegExp[] = [
  // Title-block / drawing-frame keywords.
  /^\s*drawing\s*(title|no|number|name)\b/i,
  /^\s*sheet\s*(no|number|size|name|title)\b/i,
  /^\s*scale\b/i,
  /^\s*revision\b/i,
  /^\s*project\s*(no|number|name|title)\b/i,
  /^\s*(drawn|checked|approved|date|zone|reference)\s*[:=]?\s*$/i,
  /^\s*(client|consultant|architect|contractor|owner|lead)\b/i,
  // Schedule-sheet headers.
  /^\s*(door|window|glazing|finish|finishes|finish[\s-]*schedule|room[\s-]*schedule|material[\s-]*schedule)\s*(schedule|types|list)?\s*$/i,
  /^\s*(legend|key\s*plan|key\s*to\s*finishes?|finish\s*key|notes?|general\s*notes?|specification\s*notes?)\s*$/i,
  /^\s*list\s*of\s*(materials?|finishes?|drawings?)\b/i,
  // Schedule meta + table titles.
  /^\s*area\s*(table|statement|schedule)\b/i,
  /^\s*(typ|typical|details?|section|elevation)\s*[:=]?\s*$/i,
  // Door / window / detail tags that NAME_RE accidentally lets through.
  /^\s*[A-Z]{1,3}\d{2,3}([-/][A-Z]?\d*)?\s*$/,
  // Generic compass / direction-only labels.
  /^\s*(north|south|east|west)\b/i,
  // P3 cold-upload — stair direction callouts ("UP (Stair)", "DN STAIR",
  // "DOWN (stair)"). The finish-mapper already denies these via
  // FINISH_EXCLUDED_NAME_RE; mirroring on the room funnel keeps them out
  // of the TakeoffItem table entirely so they can't be priced.
  /^\s*(up|dn|down)\s*\(?\s*stair/i,
  // P5/P6 — cold-upload dump (cmqk6jabm…) surfaced these non-room labels
  // that vision picked up off plan / finish-plan sheets. Not billable
  // rooms; not building-level statements either. Hard-deny.
  /^\s*future\s+lift\b/i,
  /^\s*flat\s+room\b/i,
  /^\s*high\s+level\s+window\b/i,
  /^\s*covered\s+gate\b/i,
  /^\s*home\s*$/i, // bare "Home" label from key-plan tiles
  /^\s*(garden|garden\s+area)\s*$/i,
  /^\s*b\.?\s*b\.?\s*q\.?\b/i, // B.B.Q. backyard amenity
  /^\s*(pedestrian|vehicular|driver['’]?s)\s+entrance\b/i,
  /\baccessway\b/i, // "DINING/LIVING/ACCESSWAY POOL" composite
  /\bsliding\s+door\s+future\s+lift\b/i, // "CORRIDOR SLIDING DOOR FUTURE LIFT" note
]

/**
 * P3 — true if `name` is clearly not a real room. Use BEFORE creating a
 * ROOM TakeoffItem. Applied after `isAreaStatement` returns false; the
 * two are complementary:
 *   - isAreaStatement(name)    → category = AREA_STATEMENT
 *   - isLikelyNotARoom(name)   → drop entirely (not stored)
 *   - else                     → category = ROOM
 *
 * Soft gates:
 *   - area < 0.5 m² is noise (smallest WC observed in corpus ≈ 1.2 m²);
 *     vision occasionally captures a label dimension as area.
 *   - name length > 60 chars is almost certainly a sentence picked up
 *     from a notes block — drop.
 *
 * Hard gate:
 *   - matches any NOT_A_ROOM_PATTERNS entry.
 */
export function isLikelyNotARoom(name: string, area: number | null): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length > 60) return true
  if (area !== null && area > 0 && area < 0.5) return true
  for (const re of NOT_A_ROOM_PATTERNS) {
    if (re.test(trimmed)) return true
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
