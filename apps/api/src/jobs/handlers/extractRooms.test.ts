import { describe, expect, it } from 'bun:test'
import { normalizeRoomName } from './extractRooms'

/**
 * Tests reflect the PRO-GRADE normalizer landed on the ai-estimation-engine
 * branch (commits f489db2 → 173a1a6). The five-stage pipeline:
 *   1. drop floor decorator after `—`
 *   2. uppercase + canonical apostrophes + KITCHEN OCR alias
 *   3. strip room codes (GF-NN, FF-NN, B1-NN, etc.) + punctuation
 *   4. canonicalizations: BED ROOM → BEDROOM, BATH ROOM → BATHROOM,
 *      BATHROOM → BATH, BOH KITCHEN → KITCHEN, DINNING → DINING,
 *      LOBBY[S] → LOBBY
 *   5. drop ROOM suffix + non-identity floor markers (GF/FF/RF/L1/L2),
 *      preserve LOWER/UPPER/B1/B2 (expert call on 2026-06-20)
 *   6. token-sort so "02 BEDROOM" ↔ "BEDROOM 02"
 *
 * Structural rooms (STAIR/LANDING/STORE/VOID/SHAFT) keep their floor
 * marker — see the structural-keeps-floor test below.
 */
describe('normalizeRoomName — pro-grade (post-AI-est-engine branch)', () => {
  it('strips floor-code suffixes and the em-dash decorator', () => {
    expect(normalizeRoomName('LIVING — GF')).toBe('LIVING')
    expect(normalizeRoomName('LIVING FF-10')).toBe('LIVING')
    expect(normalizeRoomName('  ENTRANCE LOBBY  ')).toBe('ENTRANCE LOBBY')
    expect(normalizeRoomName('LOUNGE, FORMAL')).toBe('FORMAL LOUNGE')
  })

  it('canonicalises BATHROOM/BATH ROOM/BATH variants to a single key', () => {
    // MASTER BATH ↔ MASTER BATHROOM ↔ Master Bathroom (FF) — all merge.
    const masterKey = normalizeRoomName('MASTER BATH')
    expect(normalizeRoomName('MASTER BATHROOM')).toBe(masterKey)
    expect(normalizeRoomName('Master Bathroom (FF)')).toBe(masterKey)
    expect(normalizeRoomName('master bath ff-10')).toBe(masterKey)
    expect(normalizeRoomName('MASTER BATH ROOM')).toBe(masterKey)
  })

  it('canonicalises BOH KITCHEN ↔ Kitchen (expert call 2026-06-20)', () => {
    expect(normalizeRoomName('BOH KITCHEN')).toBe(normalizeRoomName('KITCHEN'))
    expect(normalizeRoomName('BOH Kitchen — GF')).toBe(normalizeRoomName('Kitchen'))
  })

  it('keeps NON-BOH kitchen variants distinct', () => {
    // DRY KITCHEN / OUTDOOR KITCHEN are different physical rooms in
    // larger villas; they MUST stay separate from a plain "KITCHEN".
    expect(normalizeRoomName('DRY KITCHEN')).not.toBe(normalizeRoomName('KITCHEN'))
    expect(normalizeRoomName('OUTDOOR KITCHEN')).not.toBe(normalizeRoomName('KITCHEN'))
  })

  it('collapses BOW/BOX/ION/BOY KITCHEN OCR aliases to the KITCHEN bucket', () => {
    const kitchenKey = normalizeRoomName('KITCHEN')
    expect(normalizeRoomName('BOW KITCHEN')).toBe(kitchenKey)
    expect(normalizeRoomName('BOX KITCHEN')).toBe(kitchenKey)
    expect(normalizeRoomName('Ion Kitchen')).toBe(kitchenKey)
    expect(normalizeRoomName('Boy Kitchen')).toBe(kitchenKey)
  })

  it('strips generic ROOM suffix so "LIVING ROOM" ↔ "LIVING"', () => {
    expect(normalizeRoomName('LIVING ROOM')).toBe(normalizeRoomName('LIVING'))
    expect(normalizeRoomName('PLAY ROOM')).toBe(normalizeRoomName('PLAY'))
    expect(normalizeRoomName('FAMILY ROOM')).toBe(normalizeRoomName('FAMILY'))
    expect(normalizeRoomName('POWDER ROOM')).toBe(normalizeRoomName('POWDER'))
  })

  it('collapses internal whitespace + curly apostrophes', () => {
    // Curly → straight + uppercase + token-sort
    const maidKey = normalizeRoomName("MAID'S")
    expect(normalizeRoomName('MAID’S')).toBe(maidKey)
    expect(normalizeRoomName('MAIDʼS')).toBe(maidKey)
    // MAID'S ROOM → ROOM stripped → MAID'S
    expect(normalizeRoomName("MAID'S ROOM")).toBe(maidKey)
    expect(normalizeRoomName('MAID’S ROOM — GF')).toBe(maidKey)
    // whitespace collapse
    expect(normalizeRoomName('PLAY   ROOM')).toBe(normalizeRoomName('PLAY'))
    expect(normalizeRoomName('LIVING\tROOM')).toBe(normalizeRoomName('LIVING'))
  })

  it('token-sort: "02 BEDROOM" ↔ "BEDROOM 02"', () => {
    expect(normalizeRoomName('02 BEDROOM')).toBe(normalizeRoomName('BEDROOM 02'))
    expect(normalizeRoomName('BATH 01')).toBe(normalizeRoomName('01 BATH'))
  })

  it('preserves numeric distinguishers — BATH 01 vs BATH 02 stay separate', () => {
    expect(normalizeRoomName('BATH 01')).not.toBe(normalizeRoomName('BATH 02'))
    expect(normalizeRoomName('BATH 02')).not.toBe(normalizeRoomName('BATH 03'))
  })

  it('preserves LOWER/UPPER for stair landings (expert call 2026-06-20)', () => {
    // Stair landings on different flights are distinct floor areas.
    const lowerKey = normalizeRoomName('Stair Landing (GF - Lower)')
    const upperKey = normalizeRoomName('Stair Landing (GF - Upper)')
    expect(lowerKey).not.toBe(upperKey)
  })

  it('preserves GF/FF on structural rooms (stair landings + stores)', () => {
    // STRUCTURAL_NAME_RE exempts STAIR/LANDING/STORE/VOID/SHAFT from
    // the floor-marker strip — the 4 landings (GF-Lower, GF-Upper,
    // FF-Lower, FF-Upper) stay as 4 distinct buckets.
    const a = normalizeRoomName('Stair Landing (GF - Lower)')
    const b = normalizeRoomName('Stair Landing (FF - Lower)')
    expect(a).not.toBe(b)
  })

  it('cross-floor collapse for normal rooms (S8-2 design)', () => {
    // For non-structural rooms, GF/FF/RF/L1/L2 are stripped so a same-
    // named room across floors merges — picks the row with area+finish.
    expect(normalizeRoomName('MASTER BATH — GF')).toBe(normalizeRoomName('MASTER BATH — FF'))
  })

  it('the live S7-5 dup pairs still collapse', () => {
    const pairs: Array<[string, string]> = [
      ['MASTER BATH', 'MASTER BATH FF-10'],
      ['BOH KITCHEN', 'BOH Kitchen'],
      ["MAID'S ROOM", "MAID’S ROOM"],
      ['DRIVER’S ROOM — GF', "DRIVER'S ROOM"],
    ]
    for (const [a, b] of pairs) {
      expect(normalizeRoomName(a)).toBe(normalizeRoomName(b))
    }
  })
})
