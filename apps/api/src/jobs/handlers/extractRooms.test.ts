import { describe, expect, it } from 'bun:test'
import { normalizeRoomName } from './extractRooms'

describe('normalizeRoomName — Sprint 8 S8-2', () => {
  it('collapses floor-code suffix variants', () => {
    expect(normalizeRoomName('MASTER BATH')).toBe('MASTER BATH')
    expect(normalizeRoomName('MASTER BATH FF-10')).toBe('MASTER BATH')
    expect(normalizeRoomName('MASTER BATH — L1')).toBe('MASTER BATH')
    expect(normalizeRoomName('master bath ff-10')).toBe('MASTER BATH')
  })

  it('normalises case differences', () => {
    expect(normalizeRoomName('BOH Kitchen')).toBe('BOH KITCHEN')
    expect(normalizeRoomName('boh kitchen')).toBe('BOH KITCHEN')
    expect(normalizeRoomName('BOH KITCHEN')).toBe('BOH KITCHEN')
  })

  it('normalises curly apostrophes to straight quotes', () => {
    expect(normalizeRoomName("MAID'S ROOM")).toBe("MAID'S ROOM")
    expect(normalizeRoomName('MAID’S ROOM')).toBe("MAID'S ROOM")
    expect(normalizeRoomName('MAIDʼS ROOM')).toBe("MAID'S ROOM")
  })

  it('collapses internal whitespace', () => {
    expect(normalizeRoomName('PLAY   ROOM')).toBe('PLAY ROOM')
    expect(normalizeRoomName('LIVING\tROOM')).toBe('LIVING ROOM')
    expect(normalizeRoomName('  ENTRANCE LOBBY  ')).toBe('ENTRANCE LOBBY')
  })

  it('strips common punctuation noise', () => {
    expect(normalizeRoomName('POWDER (GUEST)')).toBe('POWDER GUEST')
    expect(normalizeRoomName('LOUNGE, FORMAL')).toBe('LOUNGE FORMAL')
  })

  it('keeps the em-dashed code/floor decorator out of the key', () => {
    // matches the room handler's `${room.name} — ${floor}` description shape
    expect(normalizeRoomName('LIVING — GF')).toBe('LIVING')
    expect(normalizeRoomName("MAID’S ROOM — GF")).toBe("MAID'S ROOM")
  })

  it('the live S7-5 dup pairs collapse', () => {
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

  // PB-5 — kitchen OCR aliases observed on Plot 4357 runs
  it('collapses kitchen OCR aliases BOW/BOX/ION/BOY → BOH', () => {
    expect(normalizeRoomName('BOW KITCHEN')).toBe('BOH KITCHEN')
    expect(normalizeRoomName('BOX KITCHEN')).toBe('BOH KITCHEN')
    expect(normalizeRoomName('Ion Kitchen')).toBe('BOH KITCHEN')
    expect(normalizeRoomName('Boy Kitchen')).toBe('BOH KITCHEN')
    expect(normalizeRoomName('BOH KITCHEN — GF')).toBe('BOH KITCHEN')
  })

  it('does NOT mangle real "DRY KITCHEN" or similar non-BOH variants', () => {
    expect(normalizeRoomName('DRY KITCHEN')).toBe('DRY KITCHEN')
    expect(normalizeRoomName('OUTDOOR KITCHEN')).toBe('OUTDOOR KITCHEN')
  })
})
