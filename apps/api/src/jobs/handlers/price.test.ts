/**
 * ADR-014 unit-match policy tests. The PRICE handler proper is integration-
 * tested via the smoke runs; these tests cover the unit-comparison helpers in
 * isolation.
 */
import { describe, expect, test } from 'bun:test'

function unitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  return norm(a) === norm(b)
}

describe('ADR-014 — unit-match precondition', () => {
  test('matching units (case + whitespace tolerated)', () => {
    expect(unitsMatch('m²', 'm²')).toBe(true)
    expect(unitsMatch('M²', ' m² ')).toBe(true)
    expect(unitsMatch('nr', 'Nr')).toBe(true)
  })

  test('different units never match', () => {
    expect(unitsMatch('m²', 'nr')).toBe(false)
    expect(unitsMatch('nr', 'm')).toBe(false)
    expect(unitsMatch('lumpsum', 'nr')).toBe(false)
  })

  test('null / undefined / empty cells do not match a real unit', () => {
    expect(unitsMatch(null, 'm²')).toBe(false)
    expect(unitsMatch('m²', undefined)).toBe(false)
    expect(unitsMatch('', 'm²')).toBe(false)
  })

  test('both empty match (degenerate case — both lines treated as unspecified)', () => {
    expect(unitsMatch(null, undefined)).toBe(true)
    expect(unitsMatch('', '')).toBe(true)
  })
})
