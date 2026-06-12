import { describe, expect, it } from 'bun:test'
import {
  AREA_STATEMENT_CATEGORY,
  isAreaStatement,
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
