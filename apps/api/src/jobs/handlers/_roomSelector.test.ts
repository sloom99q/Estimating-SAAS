import { describe, expect, it } from 'bun:test'
import {
  AREA_STATEMENT_CATEGORY,
  isAreaStatement,
  isFloorLegendCode,
  isLikelyNotARoom,
  selectAreaStatements,
  selectBillableRooms,
} from './_roomSelector'

import type { TakeoffCategory } from '@prisma/client'

function row(
  description: string,
  opts: { category?: TakeoffCategory; deletedAt?: Date | null } = {},
): { category: TakeoffCategory; description: string; deletedAt: Date | null } {
  return {
    category: opts.category ?? 'ROOM',
    description,
    deletedAt: opts.deletedAt ?? null,
  }
}

describe('isAreaStatement (Sprint 9 S9-0)', () => {
  it('flags the smoking gun — the whole-building "Proposed Villa" 972 m² row', () => {
    expect(isAreaStatement('Proposed G+1 Villa @ Plot 4357 Al Rahmaniya — GF')).toBe(true)
  })

  it('flags the garage block and roof labels that QUANTIFY mistook for rooms', () => {
    expect(isAreaStatement('Proposed Garage (Light Weight Steel Roof) — GF')).toBe(true)
    expect(isAreaStatement('ACCESSIBLE ROOF — Roof')).toBe(true)
    expect(isAreaStatement('NON-ACCESSIBLE ROOF — Roof')).toBe(true)
    expect(isAreaStatement('ROOF ACCESS — Roof')).toBe(true)
  })

  it('flags layout/overview captions', () => {
    expect(isAreaStatement('PLAN AREA — GF')).toBe(true)
    expect(isAreaStatement('MAIN VILLA — GF')).toBe(true)
    expect(isAreaStatement('SETTING OUT — GF')).toBe(true)
  })

  it('does NOT flag actual rooms that look "building-y"', () => {
    expect(isAreaStatement('MASTER BATHROOM — L1')).toBe(false)
    expect(isAreaStatement('POWDER ROOM — GF')).toBe(false)
    expect(isAreaStatement("MAID'S ROOM — GF")).toBe(false)
    expect(isAreaStatement('LIVING — GF')).toBe(false)
    expect(isAreaStatement('GARAGE — GF')).toBe(false) // a single-room garage is a room
  })
})

describe('selectBillableRooms / selectAreaStatements', () => {
  const items = [
    row('Proposed G+1 Villa @ Plot 4357 Al Rahmaniya — GF'),
    row('LIVING — GF'),
    row("MAID'S BATH — GF"),
    row('ACCESSIBLE ROOF — Roof'),
    row('DOOR D01 schedule', { category: 'DOOR' }),
    row('LAUNDRY/LINEN — GF', { deletedAt: new Date() }),
    row('PLAN AREA — GF'),
  ]

  it('keeps real rooms and drops the area statements', () => {
    const billable = selectBillableRooms(items)
    expect(billable.map((r) => r.description)).toEqual([
      'LIVING — GF',
      "MAID'S BATH — GF",
    ])
  })

  it('mirror selector returns just the area-statement rows', () => {
    const statements = selectAreaStatements(items)
    expect(statements.map((r) => r.description)).toEqual([
      'Proposed G+1 Villa @ Plot 4357 Al Rahmaniya — GF',
      'ACCESSIBLE ROOF — Roof',
      'PLAN AREA — GF',
    ])
  })

  it('exports a stable category string for the reclassifier', () => {
    expect(AREA_STATEMENT_CATEGORY).toBe('AREA_STATEMENT')
  })
})

describe('isLikelyNotARoom (P3 cold-upload deny gate)', () => {
  it('drops title-block / drawing-frame keywords', () => {
    expect(isLikelyNotARoom('DRAWING TITLE', 0)).toBe(true)
    expect(isLikelyNotARoom('DRAWING NO', 0)).toBe(true)
    expect(isLikelyNotARoom('SCALE', 0)).toBe(true)
    expect(isLikelyNotARoom('REVISION', 0)).toBe(true)
    expect(isLikelyNotARoom('PROJECT NO', 0)).toBe(true)
    expect(isLikelyNotARoom('DRAWN', null)).toBe(true)
    expect(isLikelyNotARoom('CHECKED', null)).toBe(true)
  })

  it('drops schedule-sheet headers', () => {
    expect(isLikelyNotARoom('DOOR SCHEDULE', null)).toBe(true)
    expect(isLikelyNotARoom('WINDOW SCHEDULE', null)).toBe(true)
    expect(isLikelyNotARoom('GLAZING TYPES', null)).toBe(true)
    expect(isLikelyNotARoom('FINISH SCHEDULE', null)).toBe(true)
    expect(isLikelyNotARoom('LEGEND', null)).toBe(true)
    expect(isLikelyNotARoom('KEY PLAN', null)).toBe(true)
    expect(isLikelyNotARoom('GENERAL NOTES', null)).toBe(true)
    expect(isLikelyNotARoom('AREA TABLE', null)).toBe(true)
  })

  it('drops bare door / window / detail tags that leak past NAME_RE', () => {
    expect(isLikelyNotARoom('D01', null)).toBe(true)
    expect(isLikelyNotARoom('CW09', null)).toBe(true)
    expect(isLikelyNotARoom('A301', null)).toBe(true)
    expect(isLikelyNotARoom('W14', null)).toBe(true)
  })

  it('drops micro-areas under 0.5 m² (vision capturing label dims as area)', () => {
    expect(isLikelyNotARoom('LIVING', 0.2)).toBe(true)
    expect(isLikelyNotARoom('LIVING', 0.49)).toBe(true)
  })

  it('drops names longer than 60 chars (sentences from notes blocks)', () => {
    const sentence = 'ALL FINISHES TO BE CONFIRMED BY THE CONTRACTOR PRIOR TO INSTALLATION'
    expect(isLikelyNotARoom(sentence, 12.5)).toBe(true)
  })

  it('drops stair direction callouts (UP / DN / DOWN — Stair)', () => {
    expect(isLikelyNotARoom('UP (Stair)', 0)).toBe(true)
    expect(isLikelyNotARoom('DN STAIR', 0)).toBe(true)
    expect(isLikelyNotARoom('DOWN (stair)', 0)).toBe(true)
  })

  it('drops cold-upload garbage names from dump cmqk6jabm', () => {
    expect(isLikelyNotARoom('FUTURE LIFT', 2.76)).toBe(true)
    expect(isLikelyNotARoom('FLAT ROOM', null)).toBe(true)
    expect(isLikelyNotARoom('High Level Window', null)).toBe(true)
    expect(isLikelyNotARoom('COVERED GATE', null)).toBe(true)
    expect(isLikelyNotARoom('Home', null)).toBe(true)
    expect(isLikelyNotARoom('Garden', null)).toBe(true)
    expect(isLikelyNotARoom('B.B.Q.', null)).toBe(true)
    expect(isLikelyNotARoom("DRIVER'S ENTRANCE", null)).toBe(true)
    expect(isLikelyNotARoom('PEDESTRIAN ENTRANCE', null)).toBe(true)
    expect(isLikelyNotARoom('VEHICULAR ENTRANCE', null)).toBe(true)
    expect(isLikelyNotARoom('DINING/LIVING/ACCESSWAY POOL', null)).toBe(true)
    expect(isLikelyNotARoom('CORRIDOR SLIDING DOOR FUTURE LIFT', 23.27)).toBe(true)
  })

  it('still keeps DRIVER\'S BATH / DRIVER\'S ROOM (billable rooms)', () => {
    expect(isLikelyNotARoom("DRIVER'S BATH", 2.67)).toBe(false)
    expect(isLikelyNotARoom("DRIVER'S ROOM", 10.11)).toBe(false)
  })

  it('KEEPS the real rooms — Phase-1 acceptance set', () => {
    expect(isLikelyNotARoom('LIVING', 35)).toBe(false)
    expect(isLikelyNotARoom("MAID'S BATH", 3.2)).toBe(false)
    expect(isLikelyNotARoom('MASTER BEDROOM', 28.4)).toBe(false)
    expect(isLikelyNotARoom('POWDER ROOM', 2.1)).toBe(false)
    expect(isLikelyNotARoom('ENTRANCE LOBBY', 12.8)).toBe(false)
    expect(isLikelyNotARoom('BOH KITCHEN', 16.4)).toBe(false)
    expect(isLikelyNotARoom('STAIRCASE', 9.6)).toBe(false)
  })
})

describe('isFloorLegendCode (PIVOT floor-only suggestion gate)', () => {
  it('admits real floor codes (ST01/ST03/PR01/PR03 + BATHROOM sentinel)', () => {
    expect(isFloorLegendCode('ST01')).toBe(true)
    expect(isFloorLegendCode('ST03')).toBe(true)
    expect(isFloorLegendCode('PR01')).toBe(true)
    expect(isFloorLegendCode('PR03')).toBe(true)
    expect(isFloorLegendCode('BATHROOM')).toBe(true)
  })

  it('rejects ST02 — stair-only code; would route a kitchen at 550 AED/m² otherwise', () => {
    expect(isFloorLegendCode('ST02')).toBe(false)
  })

  it('rejects FF furniture/joinery codes (the cmqka8hc6 cold-run leak)', () => {
    expect(isFloorLegendCode('FF01')).toBe(false) // JOINERY
    expect(isFloorLegendCode('FF02')).toBe(false) // WARDROBES
    expect(isFloorLegendCode('FF03')).toBe(false) // SINK & BATHROOM COUNTERS
    expect(isFloorLegendCode('FF04')).toBe(false) // KITCHEN CABINETRY
    expect(isFloorLegendCode('FF05')).toBe(false) // CUSTOM CABINETRY
    expect(isFloorLegendCode('FF06')).toBe(false) // STORAGE CABINETS
  })

  it('rejects FN wall codes (fluted GRC, dark grey, plaster)', () => {
    expect(isFloorLegendCode('FN01')).toBe(false)
    expect(isFloorLegendCode('FN02')).toBe(false)
    expect(isFloorLegendCode('FN03')).toBe(false)
    expect(isFloorLegendCode('FN04')).toBe(false)
  })

  it('rejects WD wood/veneer wall codes', () => {
    expect(isFloorLegendCode('WD01')).toBe(false)
    expect(isFloorLegendCode('WD02')).toBe(false)
  })

  it('rejects LS landscape codes (play sand, gravel)', () => {
    expect(isFloorLegendCode('LS01')).toBe(false)
    expect(isFloorLegendCode('LS02')).toBe(false)
  })

  it('rejects malformed or empty codes', () => {
    expect(isFloorLegendCode('')).toBe(false)
    expect(isFloorLegendCode('ST')).toBe(false) // missing digits
    expect(isFloorLegendCode('ST1')).toBe(false) // single digit
    expect(isFloorLegendCode('XX01')).toBe(false)
    expect(isFloorLegendCode('bathroom')).toBe(false) // case-sensitive sentinel
  })
})
