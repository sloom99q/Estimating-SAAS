import { describe, expect, it } from 'bun:test'
import {
  ASPECT_RATIO_TABLE,
  estimateSkirtingPerimeter,
  shouldSkirtRoom,
} from './estimateSkirting'

describe('estimateSkirtingPerimeter', () => {
  it('returns null for zero/null/negative area', () => {
    expect(estimateSkirtingPerimeter('LIVING', null)).toBeNull()
    expect(estimateSkirtingPerimeter('LIVING', 0)).toBeNull()
    expect(estimateSkirtingPerimeter('LIVING', -1)).toBeNull()
  })

  it('picks the LIVING/BEDROOM prior at 1.4:1 for LIVING', () => {
    const r = estimateSkirtingPerimeter('LIVING', 35.2)
    expect(r).not.toBeNull()
    expect(r!.aspectRatio).toBe(1.4)
    expect(r!.priorName).toContain('LIVING/BEDROOM')
    // 1.4:1 with area 35.2: short = √(35.2/1.4) ≈ 5.02; long = 7.03; P = 24.1
    expect(r!.perimeterLm).toBeCloseTo(24.10, 1)
  })

  it('picks CORRIDOR/PASSAGE at 5:1 — the canary 4×√area gets badly wrong', () => {
    const r = estimateSkirtingPerimeter('CORRIDOR — L1', 23.27)
    expect(r).not.toBeNull()
    expect(r!.aspectRatio).toBe(5.0)
    // 5:1 with 23.27: short = √(23.27/5) ≈ 2.16; long = 10.78; P = 25.88
    // (vs 4×√23.27 = 19.30, a 25% under-estimate the canary corrects)
    expect(r!.perimeterLm).toBeCloseTo(25.88, 1)
  })

  it('picks BATHROOM at 1.4:1', () => {
    const r = estimateSkirtingPerimeter('MAID\'S BATH', 2.67)
    expect(r!.aspectRatio).toBe(1.4)
    expect(r!.priorName).toContain('BATHROOM/POWDER')
  })

  it('picks KITCHEN at 1.5:1', () => {
    const r = estimateSkirtingPerimeter('BOH KITCHEN', 28.01)
    expect(r!.aspectRatio).toBe(1.5)
  })

  it('picks SERVICE for MAID, DRIVER, LAUNDRY', () => {
    expect(estimateSkirtingPerimeter("MAID'S ROOM", 10)!.priorName).toContain('SERVICE')
    expect(estimateSkirtingPerimeter("DRIVER'S ROOM", 10)!.priorName).toContain('SERVICE')
    expect(estimateSkirtingPerimeter('LAUNDRY/LINEN', 10)!.priorName).toContain('SERVICE')
  })

  it('picks BALCONY/TERRACE at 3:1', () => {
    expect(estimateSkirtingPerimeter('MASTER BALCONY', 12)!.aspectRatio).toBe(3.0)
    expect(estimateSkirtingPerimeter('FAMILY ROOM TERRACE', 23.3)!.aspectRatio).toBe(3.0)
  })

  it('falls back to GENERIC 1.3:1 for unknown labels', () => {
    const r = estimateSkirtingPerimeter('SKYLIGHT 04 ABOVE', 10)
    expect(r!.aspectRatio).toBe(1.3)
    expect(r!.priorName).toContain('GENERIC')
    expect(r!.confidence).toBe(50)
  })

  it('reasoning line is human-readable and includes sides + perimeter', () => {
    const r = estimateSkirtingPerimeter('LIVING', 35.2)!
    expect(r.reasoning).toContain('LIVING/BEDROOM')
    expect(r.reasoning).toMatch(/area 35\.20 m²/)
    expect(r.reasoning).toMatch(/perimeter 24\.\d{2} lm/)
  })

  it('table rules are ordered specifically — CORRIDOR before BEDROOM', () => {
    // Sanity: the "passage" / "corridor" rule must fire before the
    // catch-all bedroom/living rule, otherwise CORRIDOR would land on
    // the 1.4 prior (a 25%-too-low perimeter for a 5:1 corridor).
    const corridorIdx = ASPECT_RATIO_TABLE.findIndex((r) => r.match.test('CORRIDOR'))
    const bedroomIdx = ASPECT_RATIO_TABLE.findIndex((r) => r.match.test('BEDROOM'))
    expect(corridorIdx).toBeGreaterThanOrEqual(0)
    expect(bedroomIdx).toBeGreaterThanOrEqual(0)
    expect(corridorIdx).toBeLessThan(bedroomIdx)
  })
})

describe('shouldSkirtRoom', () => {
  it('skirts a confirmed PR01 living room', () => {
    expect(shouldSkirtRoom('LIVING — GF', 'PR01')).toBe(true)
  })

  it('does NOT skirt a BATHROOM-finished room (waterproofing wraps up)', () => {
    expect(shouldSkirtRoom('MAID\'S BATH', 'BATHROOM')).toBe(false)
  })

  it('does NOT skirt ST03 external pavement', () => {
    expect(shouldSkirtRoom('PEDESTRIAN ENTRANCE', 'ST03')).toBe(false)
  })

  it('does NOT skirt staircase rooms', () => {
    expect(shouldSkirtRoom('STAIRCASE', 'ST01')).toBe(false)
    expect(shouldSkirtRoom('Stair Landing (GF - Upper)', 'ST01')).toBe(false)
  })

  it('does NOT skirt balconies/terraces (parapet, not wall)', () => {
    expect(shouldSkirtRoom('MASTER BALCONY', 'PR01')).toBe(false)
    expect(shouldSkirtRoom('FAMILY ROOM TERRACE', 'ST01')).toBe(false)
  })

  it('does NOT skirt unconfirmed rooms (null finish_code)', () => {
    expect(shouldSkirtRoom('LIVING', null)).toBe(false)
  })
})
