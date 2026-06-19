import { afterEach, describe, expect, test } from 'bun:test'
import { normalizeFloor, setFloorAliases } from './floorNormalize'

afterEach(() => setFloorAliases(null))

describe('floorNormalize — Plot 4357 vocabulary', () => {
  test('canonical labels pass through unchanged', () => {
    expect(normalizeFloor('GF')).toBe('GF')
    expect(normalizeFloor('L1')).toBe('L1')
    expect(normalizeFloor('L2')).toBe('L2')
    expect(normalizeFloor('Roof')).toBe('Roof')
  })

  test('Plot 4357 live-run variants collapse to canonicals', () => {
    expect(normalizeFloor('Ground Floor')).toBe('GF')
    expect(normalizeFloor('FF')).toBe('L1')
    expect(normalizeFloor('First Floor')).toBe('L1')
    expect(normalizeFloor('first floor')).toBe('L1')
  })

  test('null / empty / whitespace pass through as null', () => {
    expect(normalizeFloor(null)).toBeNull()
    expect(normalizeFloor('')).toBeNull()
    expect(normalizeFloor('   ')).toBeNull()
  })

  test('unknown labels pass through verbatim (so dedupe still sees them)', () => {
    expect(normalizeFloor('Penthouse')).toBe('Penthouse')
  })

  test('setFloorAliases merges over defaults', () => {
    setFloorAliases({ Penthouse: 'PH' })
    expect(normalizeFloor('Penthouse')).toBe('PH')
    expect(normalizeFloor('GF')).toBe('GF') // defaults still in effect
  })

  test('setFloorAliases(null) restores defaults', () => {
    setFloorAliases({ XYZ: 'X' })
    setFloorAliases(null)
    expect(normalizeFloor('XYZ')).toBe('XYZ')
  })
})
