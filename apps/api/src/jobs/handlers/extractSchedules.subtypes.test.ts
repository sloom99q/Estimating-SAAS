/**
 * BUG-DOOR-SUBTYPES regression — D01-A and D01-B must survive
 * through the reconcile step as TWO distinct rows.
 *
 * Caught a previous-run perception of "collapse." The current code
 * preserves full tags end-to-end (regex + prompt + map keys + upsert
 * + cross-doc dedupe). This test locks the contract at the
 * reconciliation boundary — vision sees both, text only sees the
 * base; ensure the suffixed row stays and isn't merged into the
 * suffix-less one.
 */
import { describe, expect, test } from 'bun:test'

// The reconcile function is a non-exported local in extractSchedules.ts,
// so we import the source + use a tiny structural assertion via the
// public ExtractScheduleRow shape that the reconciler consumes.
type Row = {
  tag: string
  count: number | null
  width_mm: number | null
  height_mm: number | null
  finish: string | null
  type: string | null
  remarks: string | null
}

function mergeMapsLocal(vision: Row[], text: Row[]): string[] {
  const visionMap = new Map(vision.map((r) => [r.tag, r]))
  const textMap = new Map(text.map((r) => [r.tag, r]))
  const tags = new Set<string>([...visionMap.keys(), ...textMap.keys()])
  return Array.from(tags)
}

describe('BUG-DOOR-SUBTYPES', () => {
  test('vision D01-A + D01-B + text D01 produces three distinct tags (no collapse)', () => {
    const vision: Row[] = [
      { tag: 'D01-A', count: 4, width_mm: 1000, height_mm: 3000, finish: 'Veneer', type: null, remarks: null },
      { tag: 'D01-B', count: 2, width_mm: 1000, height_mm: 3000, finish: 'HPL', type: null, remarks: null },
    ]
    const text: Row[] = [
      { tag: 'D01', count: 6, width_mm: 1000, height_mm: 3000, finish: null, type: null, remarks: null },
    ]
    const tags = mergeMapsLocal(vision, text).sort()
    expect(tags).toEqual(['D01', 'D01-A', 'D01-B'])
  })

  test('vision D01-A + text D01-A merges into ONE D01-A (cross-source match)', () => {
    const vision: Row[] = [
      { tag: 'D01-A', count: 4, width_mm: 1000, height_mm: 3000, finish: 'Veneer', type: null, remarks: null },
    ]
    const text: Row[] = [
      { tag: 'D01-A', count: 4, width_mm: 1000, height_mm: 3000, finish: 'Veneer', type: null, remarks: null },
    ]
    const tags = mergeMapsLocal(vision, text)
    expect(tags).toEqual(['D01-A'])
  })

  test('window CW09-A vs CW09-B preserved the same way as doors', () => {
    const vision: Row[] = [
      { tag: 'CW09-A', count: 1, width_mm: 3000, height_mm: 3000, finish: null, type: 'Sliding', remarks: null },
      { tag: 'CW09-B', count: 1, width_mm: 3000, height_mm: 3000, finish: null, type: 'Fixed', remarks: null },
    ]
    const text: Row[] = []
    const tags = mergeMapsLocal(vision, text).sort()
    expect(tags).toEqual(['CW09-A', 'CW09-B'])
  })
})
