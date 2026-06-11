/**
 * ADR-014 unit-match policy tests. The PRICE handler proper is integration-
 * tested via the smoke runs; these tests cover the unit-comparison helpers in
 * isolation.
 */
import { describe, expect, test } from 'bun:test'

// Mirror of the canoniser inside price.ts. Kept here so the test pins the
// vocabulary the rest of the system has to honour.
function canonicaliseUnit(s: string | null | undefined): string {
  const raw = (s ?? '').trim().toLowerCase()
  if (raw === '') return ''
  if (raw === 'nr' || raw === 'no' || raw === 'each' || raw === 'ea') return 'nr'
  if (raw === 'm²' || raw === 'm2' || raw === 'sqm') return 'm²'
  if (raw === 'm' || raw === 'lm' || raw === 'linear' || raw === 'metres' || raw === 'meters') {
    return 'lm'
  }
  if (raw === 'lumpsum' || raw === 'ls' || raw === 'lot') return 'lumpsum'
  return raw
}

function unitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicaliseUnit(a) === canonicaliseUnit(b)
}

describe('ADR-014 — unit-match precondition', () => {
  test('matching units (case + whitespace tolerated)', () => {
    expect(unitsMatch('m²', 'm²')).toBe(true)
    expect(unitsMatch('M²', ' m² ')).toBe(true)
    expect(unitsMatch('nr', 'Nr')).toBe(true)
  })

  test('different units never match', () => {
    expect(unitsMatch('m²', 'nr')).toBe(false)
    expect(unitsMatch('nr', 'm²')).toBe(false)
    expect(unitsMatch('lumpsum', 'nr')).toBe(false)
  })

  test('S6-4 lexicon synonyms collapse to the same canonical', () => {
    // extractors say 'nr' / 'm' / 'm²'; §8 writes 'No' / 'lm' / 'm²'
    expect(unitsMatch('nr', 'No')).toBe(true)
    expect(unitsMatch('m', 'lm')).toBe(true)
    expect(unitsMatch('linear', 'lm')).toBe(true)
    expect(unitsMatch('m2', 'm²')).toBe(true)
    expect(unitsMatch('sqm', 'm²')).toBe(true)
    expect(unitsMatch('LS', 'lumpsum')).toBe(true)
  })

  test('synonym table does NOT collapse genuinely different units', () => {
    expect(unitsMatch('nr', 'lm')).toBe(false)
    expect(unitsMatch('m²', 'lm')).toBe(false)
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
