import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { parseBboxRoomAreaPairs, type BboxWord } from './roomsBboxParser'

// Sprint-7 S7-4 spatial-parser gate. Architect's TDD requirement: pin the
// ground-truth GF pairs against the fixture extracted from plot4357 p10.
// The parser MUST recover ≥8 of these before the pipeline gets to use it.
const FIXTURE_P10 = path.resolve(
  import.meta.dir,
  '../../fixtures/bbox/plot4357-p10.json',
)

interface BboxFixture {
  pageWidth: number | null
  pageHeight: number | null
  words: BboxWord[]
}

function loadFixture(): BboxFixture {
  return JSON.parse(fs.readFileSync(FIXTURE_P10, 'utf-8')) as BboxFixture
}

// Each printed pair: (name as it appears on the drawing, expected area in m²).
// Some areas are documented as "X or Y" in the ground truth — the parser
// just needs to land on either.
const GROUND_TRUTH_GF: Array<{ name: string | RegExp; expected: number | number[] }> = [
  { name: /MAID'?S ROOM\b/, expected: 7.22 },
  { name: /LAUNDRY\s*\/?\s*LINEN/, expected: 9.8 },
  { name: /DINNING/, expected: [21.38, 21.58] },
  { name: /BOH KITCHEN/, expected: 28.01 },
  { name: /LIVING\b/, expected: 58.82 },
  { name: /PLAY ROOM\b/, expected: 24.32 },
  { name: /ENTRANCE LOBBY/, expected: 18.29 },
  { name: /POWDER\b/, expected: 8.44 },
  { name: /BATH 03\b/, expected: 5.41 },
  { name: /MAID'?S BATH\b/, expected: 5.37 },
  { name: /DRIVER'?S ROOM/, expected: 10.11 },
]

function matches(pair: { name: string; area_m2: number }, expectedName: string | RegExp): boolean {
  if (typeof expectedName === 'string') return pair.name.toUpperCase().includes(expectedName.toUpperCase())
  return expectedName.test(pair.name.toUpperCase())
}

function areaWithin(actual: number, expected: number | number[], tol = 0.02): boolean {
  const list = Array.isArray(expected) ? expected : [expected]
  return list.some((e) => Math.abs(actual - e) / e <= tol)
}

describe('roomsBboxParser — Plot 4357 ground floor (p10)', () => {
  test('recovers ≥8 of the printed ground-truth pairs', () => {
    const bbox = loadFixture()
    const pairs = parseBboxRoomAreaPairs(bbox)
    expect(pairs.length).toBeGreaterThan(0)

    let hit = 0
    const matched: string[] = []
    for (const { name: expectedName, expected } of GROUND_TRUTH_GF) {
      const found = pairs.find(
        (p) => matches(p, expectedName) && areaWithin(p.area_m2, expected),
      )
      if (found) {
        hit += 1
        matched.push(`${found.name}→${found.area_m2}`)
      }
    }
    // Diagnostic on failure: print what was found.
    if (hit < 8) {
      const top = pairs.slice(0, 30).map((p) => `${p.name}|${p.area_m2}`)
      throw new Error(
        `Recovered ${hit}/11 ground-truth pairs (need ≥8). Matched: ${matched.join(', ')}. ` +
          `First parser pairs: ${top.join(' || ')}`,
      )
    }
    expect(hit).toBeGreaterThanOrEqual(8)
  })

  test('every emitted area is within a sane range (0 < area < 500 m²)', () => {
    const bbox = loadFixture()
    for (const p of parseBboxRoomAreaPairs(bbox)) {
      expect(p.area_m2).toBeGreaterThan(0)
      expect(p.area_m2).toBeLessThan(500)
    }
  })

  test('every pair links a NAME and an AREA bbox via measured distance', () => {
    const bbox = loadFixture()
    for (const p of parseBboxRoomAreaPairs(bbox)) {
      expect(p.distance).toBeGreaterThan(0)
      expect(p.distance).toBeLessThan(2000)
    }
  })
})
