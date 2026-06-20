import { describe, expect, it } from 'bun:test'
import {
  composeWardrobeReasoning,
  normalizeWardrobeVision,
  WARDROBE_TOOL,
  type WardrobeVisionRaw,
} from './estimateWardrobesPass'

describe('normalizeWardrobeVision', () => {
  it('caps confidence at 55 — one tier lower than kitchen (honest about being weakest)', () => {
    const raw: WardrobeVisionRaw = {
      wallsWithWardrobes: 1,
      totalLm: 4.2,
      perWallReasoning: 'north 4.2 m',
      hatchingPattern: 'parallel-line',
      builtInVsWalkIn: 'built-in',
      confidence: 95, // inflated self-report
      uncertainty: 'clear',
    }
    expect(normalizeWardrobeVision(raw).confidence).toBe(55)
  })

  it('coerces unknown hatching/kind enums to safe defaults', () => {
    const e = normalizeWardrobeVision({
      wallsWithWardrobes: 0,
      totalLm: 0,
      perWallReasoning: '',
      hatchingPattern: 'rainbow' as never,
      builtInVsWalkIn: 'phasers' as never,
      confidence: 30,
      uncertainty: '',
    } as WardrobeVisionRaw)
    expect(e.hatchingPattern).toBe('ambiguous')
    expect(e.layoutKind).toBe('unclear')
  })

  it('clamps negatives + NaN to zero', () => {
    const e = normalizeWardrobeVision({
      wallsWithWardrobes: -1,
      totalLm: Number.NaN,
      perWallReasoning: 'x',
      hatchingPattern: 'none',
      builtInVsWalkIn: 'built-in',
      confidence: -5,
      uncertainty: 'y',
    } as WardrobeVisionRaw)
    expect(e.wallsWithWardrobes).toBe(0)
    expect(e.totalLm).toBe(0)
    expect(e.confidence).toBe(0)
  })

  it('preserves a lower honest confidence', () => {
    expect(
      normalizeWardrobeVision({
        wallsWithWardrobes: 1,
        totalLm: 4.2,
        perWallReasoning: 'n 4.2',
        hatchingPattern: 'parallel-line',
        builtInVsWalkIn: 'built-in',
        confidence: 30,
        uncertainty: 'hatching could be wall texture',
      }).confidence,
    ).toBe(30)
  })
})

describe('composeWardrobeReasoning', () => {
  const sample = {
    wallsWithWardrobes: 1,
    totalLm: 4.2,
    hatchingPattern: 'parallel-line' as const,
    layoutKind: 'built-in' as const,
    confidence: 45,
    perWallReasoning: 'north wall 4.2 m = 4.2 lm',
    uncertainty: 'hatching pattern faint near the south edge',
  }

  it('leads with the hatching pattern signal (most important for the expert)', () => {
    const r = composeWardrobeReasoning(sample)
    expect(r.startsWith('Hatching: parallel-line')).toBe(true)
    expect(r).toContain('Kind: built-in')
    expect(r).toContain('north wall 4.2 m')
    expect(r).toContain('UNCERTAINTY')
  })

  it('handles empty reasoning + uncertainty without crashing', () => {
    const r = composeWardrobeReasoning({
      ...sample,
      perWallReasoning: '',
      uncertainty: '',
    })
    expect(r).toContain('Hatching: parallel-line')
    expect(r).toContain('(no breakdown given)')
    expect(r).not.toContain('UNCERTAINTY')
  })

  it('preserves all five hatching pattern values', () => {
    const patterns = ['parallel-line', 'block', 'annotation-only', 'none', 'ambiguous'] as const
    for (const hp of patterns) {
      const r = composeWardrobeReasoning({ ...sample, hatchingPattern: hp })
      expect(r).toContain(`Hatching: ${hp}`)
    }
  })

  it('shows walk-in as a distinct kind (signal to expert that lm is dubious)', () => {
    const r = composeWardrobeReasoning({ ...sample, layoutKind: 'walk-in' })
    expect(r).toContain('Kind: walk-in')
  })
})

describe('WARDROBE_TOOL schema', () => {
  it('requires the reasoning + uncertainty fields (no optional dodging)', () => {
    const schema = WARDROBE_TOOL.input_schema as { required: string[] }
    expect(schema.required).toContain('perWallReasoning')
    expect(schema.required).toContain('hatchingPattern')
    expect(schema.required).toContain('builtInVsWalkIn')
    expect(schema.required).toContain('uncertainty')
    expect(schema.required).toContain('confidence')
  })
})
