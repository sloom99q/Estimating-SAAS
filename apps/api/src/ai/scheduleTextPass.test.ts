import { describe, expect, test } from 'bun:test'
import { scheduleTextPass } from './scheduleTextPass'

const DOOR_BLOB = `
        DOOR TAG             COUNT          Width       Height   Panel_Height                     DESCRIPTION
        D01             6                 1.00          3.00       3.00               D01 1000 X 3000
        D02             4                 0.90          3.00       2.70               D02 900 X 3000 White FP 2700
        D03             2                 1.00          3.00       2.40               D03 1000 X 3000 White FP 2400
        D04             2                 0.90          3.00       2.40
        D05             1                 0.80          3.00       2.40
        D06             2                 0.90          2.40       2.40
        D07             1                 0.50          3.00       2.10
        D08             4                 0.90          2.40       2.40
        D10             2                 0.90          3.00       2.70
`

const WINDOW_BLOB = `
        CW01 3.03 4.04 1 Sliding Windows GROUND FLOOR
        CW03 0.90 6.42 1 Standard Fixed GROUND FLOOR
        CW04 0.70 6.40 2 Standard Fixed GROUND FLOOR
        CW05 3.00 1.80 6 Standard Fixed
        CW06 3.00 1.20 1 Standard Fixed GROUND FLOOR
        CW08 3.00 11.58 2 Sliding Windows GROUND FLOOR
        CW09 1.00 11.48 5 Standard Fixed FIRST FLOOR
        CW10 3.00 1.20 2 Standard Fixed FIRST FLOOR
        CW11 3.00 4.10 1 Sliding Windows FIRST FLOOR
        CW12 3.00 1.20 2 Standard Fixed
        CW13 0.60 3.39 1 Standard Fixed FIRST FLOOR
        CW14 2.40 2.10 2 Standard Fixed FIRST FLOOR
        CW15 0.60 6.42 1 Standard Fixed FIRST FLOOR
        CW16 3.00 2.10 2 Standard Fixed FIRST FLOOR
        CW17 3.00 4.63 1 Sliding Windows FIRST FLOOR
        CW18 2.70 0.30 1 Standard Fixed GROUND FLOOR
        CW19 2.70 1.19 1 Standard Fixed GROUND FLOOR
        CW20 2.00 3.00 1 Main Door GROUND FLOOR
`

describe('scheduleTextPass — Plot 4357 real layouts', () => {
  test('door schedule yields 9 unique tags (D09 absent)', () => {
    const rows = scheduleTextPass(DOOR_BLOB, 'DOOR')
    const tags = rows.map((r) => r.tag).sort()
    expect(tags).toEqual(['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D10'])
  })

  test('door D01 parses 6 × 1000mm × 3000mm', () => {
    const rows = scheduleTextPass(DOOR_BLOB, 'DOOR')
    const d01 = rows.find((r) => r.tag === 'D01')
    expect(d01).toBeDefined()
    expect(d01!.count).toBe(6)
    expect(d01!.width_mm).toBe(1000)
    expect(d01!.height_mm).toBe(3000)
  })

  test('door D05 parses 1 × 800 × 3000', () => {
    const d05 = scheduleTextPass(DOOR_BLOB, 'DOOR').find((r) => r.tag === 'D05')
    expect(d05).toBeDefined()
    expect(d05!.count).toBe(1)
    expect(d05!.width_mm).toBe(800)
    expect(d05!.height_mm).toBe(3000)
  })

  test('window schedule yields 18 distinct tags (CW02 + CW07 absent from this slice)', () => {
    const rows = scheduleTextPass(WINDOW_BLOB, 'WINDOW')
    // Test fixture omits CW02 (the famous swap-trap row) and CW07 (which sits
    // on a different visual line in the real PDF). Both make the parser's
    // CW02-detection requirement explicit and intentional.
    expect(rows.length).toBe(18)
    expect(rows.map((r) => r.tag)).not.toContain('CW02')
    expect(rows.map((r) => r.tag)).toContain('CW01')
    expect(rows.map((r) => r.tag)).toContain('CW20')
  })

  test('window CW01 parses 3030 × 4040 with floor remark', () => {
    const cw01 = scheduleTextPass(WINDOW_BLOB, 'WINDOW').find((r) => r.tag === 'CW01')
    expect(cw01).toBeDefined()
    expect(cw01!.width_mm).toBe(3030)
    expect(cw01!.height_mm).toBe(4040)
    expect(cw01!.count).toBe(1)
    expect(cw01!.remarks).toBe('GROUND FLOOR')
  })

  test('window CW05 has no floor (some rows skip it)', () => {
    const cw05 = scheduleTextPass(WINDOW_BLOB, 'WINDOW').find((r) => r.tag === 'CW05')
    expect(cw05).toBeDefined()
    expect(cw05!.remarks).toBeNull()
    expect(cw05!.count).toBe(6)
  })

  test('parsing the door blob with kind=WINDOW returns 0 (tag anchor refuses)', () => {
    const rows = scheduleTextPass(DOOR_BLOB, 'WINDOW')
    expect(rows.length).toBe(0)
  })
})
