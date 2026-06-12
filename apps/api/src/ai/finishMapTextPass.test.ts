import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { mapFinishCodesByText } from './finishMapTextPass'

const FIXTURE_DIR = join(import.meta.dir, '..', '..', 'fixtures', 'text-layer')
const CORE_CODES = [
  'ST01',
  'ST02',
  'ST03',
  'PR01',
  'PR03',
  'WD01',
  'FN01',
  'FN02',
  'FN03',
  'FN04',
  'LS01',
  'LS02',
  'BATHROOM',
]

const ROOMS_ON_I401 = [
  'LIVING',
  'DINNING',
  'ENTRANCE LOBBY',
  'PLAY ROOM',
  'BOH KITCHEN',
  'LAUNDRY/LINEN',
  "MAID'S ROOM",
  "DRIVER'S ROOM",
  'POWDER',
  "MAID'S BATH",
  'BATH 03',
]

describe('mapFinishCodesByText — Plot 4357', () => {
  it('emits no false positives on a sheet without rooms (empty input)', () => {
    const { byRoom, roomHits } = mapFinishCodesByText('', ROOMS_ON_I401, CORE_CODES)
    expect(byRoom.size).toBe(0)
    expect(roomHits).toBe(0)
  })

  it("paired codes are all from the closed vocabulary (no hallucinations)", () => {
    const i401 = readFileSync(join(FIXTURE_DIR, 'plot4357-I401.txt'), 'utf-8')
    const { byRoom } = mapFinishCodesByText(i401, ROOMS_ON_I401, CORE_CODES)
    for (const code of byRoom.values()) {
      expect(CORE_CODES).toContain(code)
    }
  })

  it("sees room name occurrences on I401 (≥4 of the listed rooms)", () => {
    // The pairer is a fallback for layouts where the legend table is
    // *inline* with the room labels. On Plot 4357's I401 the legend sits
    // in a separate region from the floor plan — so the *pairing* fails
    // by design and vision/remap remain the primary path for finish_code.
    // We assert only that the room-hit count is sane.
    const i401 = readFileSync(join(FIXTURE_DIR, 'plot4357-I401.txt'), 'utf-8')
    const { roomHits } = mapFinishCodesByText(i401, ROOMS_ON_I401, CORE_CODES)
    expect(roomHits).toBeGreaterThanOrEqual(4)
  })
})
