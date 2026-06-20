import { describe, expect, it } from 'bun:test'
import {
  composeKitchenReasoning,
  computeKitchenCrop,
  KITCHEN_TOOL,
  normalizeKitchenVision,
  parseScaleDenominator,
  type KitchenVisionRaw,
} from './estimateKitchenPass'

describe('parseScaleDenominator', () => {
  it('parses common forms', () => {
    expect(parseScaleDenominator('1:75')).toBe(75)
    expect(parseScaleDenominator('1/50')).toBe(50)
    expect(parseScaleDenominator('1 : 100')).toBe(100)
  })

  it('picks the first scale when multiple are listed', () => {
    // Plot 4357 lists "1:75 / 1:200" for some detail sheets
    expect(parseScaleDenominator('1:75 / 1:200')).toBe(75)
  })

  it('returns null for null/missing/malformed', () => {
    expect(parseScaleDenominator(null)).toBeNull()
    expect(parseScaleDenominator(undefined)).toBeNull()
    expect(parseScaleDenominator('')).toBeNull()
    expect(parseScaleDenominator('NTS')).toBeNull()
    expect(parseScaleDenominator('1:0')).toBeNull()
  })
})

describe('computeKitchenCrop', () => {
  it('applies a 1.5 m margin in pixels when scale is known (1:75 @ 220 DPI)', () => {
    // 1.5 m at 1:75 = 20 mm on paper. At 220 DPI = 173.2 px.
    // Floors to MIN_CROP_PX = 1200 in each dimension.
    const crop = computeKitchenCrop({
      nameBox: { xMin: 100, yMin: 200, xMax: 150, yMax: 215 },
      scaleDenominator: 75,
      renderDpi: 220,
      sheetPixelWidth: 6000,
      sheetPixelHeight: 4000,
      sheetPointWidth: 1190.55, // A1 width in points (approx)
      sheetPointHeight: 841.89,
    })
    // Width/height should be 1200 because the scale-based margin (~173 px
    // each side = 346 px total + ~150 px label = ~500 px) is well below
    // MIN_CROP_PX = 1200.
    expect(crop.width).toBe(1200)
    expect(crop.height).toBe(1200)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
  })

  it('clamps to sheet bounds when label is near the edge', () => {
    const crop = computeKitchenCrop({
      nameBox: { xMin: 5, yMin: 5, xMax: 30, yMax: 20 }, // top-left corner
      scaleDenominator: 75,
      renderDpi: 220,
      sheetPixelWidth: 6000,
      sheetPixelHeight: 4000,
      sheetPointWidth: 1190.55,
      sheetPointHeight: 841.89,
    })
    expect(crop.x).toBe(0)
    expect(crop.y).toBe(0)
    expect(crop.width).toBeLessThanOrEqual(6000)
    expect(crop.height).toBeLessThanOrEqual(4000)
  })

  it('uses the fixed 300 px margin when scale is missing', () => {
    // Without scale, fall back to 300 px margin (still well below MIN_CROP_PX = 1200).
    const crop = computeKitchenCrop({
      nameBox: { xMin: 500, yMin: 500, xMax: 600, yMax: 530 },
      scaleDenominator: null,
      renderDpi: 220,
      sheetPixelWidth: 6000,
      sheetPixelHeight: 4000,
      sheetPointWidth: 1190.55,
      sheetPointHeight: 841.89,
    })
    expect(crop.width).toBe(1200)
    expect(crop.height).toBe(1200)
  })

  it('expands above MIN_CROP_PX when the label is huge (unusual, but valid)', () => {
    // 600 px label with 300 px margin each side = 1200 px (right at floor),
    // 700 px label with 300 px margin each side = 1300 px (above floor).
    const crop = computeKitchenCrop({
      nameBox: { xMin: 500, yMin: 500, xMax: 500 + 229, yMax: 500 + 229 }, // ~700 px @ 220 DPI
      scaleDenominator: null,
      renderDpi: 220,
      sheetPixelWidth: 6000,
      sheetPixelHeight: 4000,
      sheetPointWidth: 1190.55,
      sheetPointHeight: 841.89,
    })
    expect(crop.width).toBeGreaterThanOrEqual(1200)
    expect(crop.height).toBeGreaterThanOrEqual(1200)
  })
})

describe('normalizeKitchenVision', () => {
  it('caps confidence at 60 (expert override 2026-06-20)', () => {
    const raw: KitchenVisionRaw = {
      kitchenLayout: 'L',
      baseLm: 8.4,
      baseReasoning: 'south 4.2 + west 4.2',
      wallLm: 5.2,
      wallReasoning: 'south wall only',
      hasIsland: false,
      islandLm: 0,
      confidence: 95, // model self-report; should be capped
      uncertainty: 'Wall above range hood was unclear',
    }
    expect(normalizeKitchenVision(raw).confidence).toBe(60)
  })

  it('preserves a lower confidence', () => {
    const raw: KitchenVisionRaw = {
      kitchenLayout: 'U',
      baseLm: 10,
      baseReasoning: '',
      wallLm: 4,
      wallReasoning: '',
      hasIsland: false,
      islandLm: 0,
      confidence: 45,
      uncertainty: 'Cut off',
    }
    expect(normalizeKitchenVision(raw).confidence).toBe(45)
  })

  it('coerces unknown layout to OTHER', () => {
    expect(
      normalizeKitchenVision({
        kitchenLayout: 'GARBAGE' as never,
        baseLm: 5,
        wallLm: 3,
        hasIsland: false,
        islandLm: 0,
        confidence: 50,
        uncertainty: '',
      } as KitchenVisionRaw).layout,
    ).toBe('OTHER')
  })

  it('clamps negatives to 0 and defaults missing strings to empty', () => {
    const e = normalizeKitchenVision({
      kitchenLayout: 'I',
      baseLm: -5,
      wallLm: Number.NaN,
      hasIsland: false,
      islandLm: -1,
      confidence: -10,
      uncertainty: '',
    } as KitchenVisionRaw)
    expect(e.baseLm).toBe(0)
    expect(e.wallLm).toBe(0)
    expect(e.islandLm).toBe(0)
    expect(e.confidence).toBe(0)
    expect(e.baseReasoning).toBe('')
    expect(e.wallReasoning).toBe('')
  })
})

describe('composeKitchenReasoning', () => {
  const sampleEstimate = {
    layout: 'L' as const,
    baseLm: 8.4,
    wallLm: 5.2,
    hasIsland: false,
    islandLm: 0,
    confidence: 55,
    baseReasoning: 'south wall 4.2 m + west wall 4.2 m = 8.4 lm',
    wallReasoning: 'south wall only — west wall has window',
    uncertainty: 'Range hood placement on the south wall was unclear',
  }

  it('renders layout + base breakdown + uncertainty on the base line', () => {
    const r = composeKitchenReasoning('base', sampleEstimate)
    expect(r).toContain('Layout: L')
    expect(r).toContain('south wall 4.2 m')
    expect(r).toContain('UNCERTAINTY')
  })

  it('shows island lm when present', () => {
    const r = composeKitchenReasoning('base', { ...sampleEstimate, hasIsland: true, islandLm: 2.5 })
    expect(r).toMatch(/island 2\.50 lm/)
    expect(r).toContain('Layout: L + island')
  })

  it('renders wall reasoning on the wall line', () => {
    const r = composeKitchenReasoning('wall', sampleEstimate)
    expect(r).toContain('Wall: south wall only')
    expect(r).toContain('UNCERTAINTY')
  })

  it('handles empty reasoning fields without crashing', () => {
    const r = composeKitchenReasoning('base', {
      ...sampleEstimate,
      baseReasoning: '',
      wallReasoning: '',
      uncertainty: '',
    })
    expect(r).toContain('(no breakdown given)')
    expect(r).not.toContain('UNCERTAINTY')
  })
})

describe('KITCHEN_TOOL schema', () => {
  it('requires all reasoning + uncertainty fields (no optional dodging)', () => {
    const schema = KITCHEN_TOOL.input_schema as {
      required: string[]
    }
    expect(schema.required).toContain('uncertainty')
    expect(schema.required).toContain('baseReasoning')
    expect(schema.required).toContain('wallReasoning')
    expect(schema.required).toContain('countertopReasoning')
    expect(schema.required).toContain('confidence')
  })
})

describe('countertop extension (AI-est roadmap #4b)', () => {
  it('normalizeKitchenVision carries countertopLm + reasoning through', () => {
    const r = normalizeKitchenVision({
      kitchenLayout: 'L',
      baseLm: 7.8,
      baseReasoning: 'n 6.4 + e 1.4',
      wallLm: 5,
      wallReasoning: 'n 5',
      countertopLm: 9.3,
      countertopReasoning: 'n 6.4 + e 1.4 + island top 1.5',
      hasIsland: true,
      islandLm: 2.5,
      confidence: 50,
      uncertainty: 'island depth unclear',
    })
    expect(r.countertopLm).toBe(9.3)
    expect(r.countertopReasoning).toMatch(/island top 1\.5/)
  })

  it('composeKitchenReasoning("counter", ...) surfaces the countertop breakdown', () => {
    const r = composeKitchenReasoning('counter', {
      layout: 'L',
      baseLm: 7.8,
      wallLm: 5,
      countertopLm: 9.3,
      hasIsland: true,
      islandLm: 2.5,
      confidence: 50,
      baseReasoning: '',
      wallReasoning: '',
      countertopReasoning: 'n 6.4 + e 1.4 + island top 1.5 = 9.3 lm',
      uncertainty: 'island depth unclear',
    })
    expect(r).toContain('Layout: L + island')
    expect(r).toContain('Counter: n 6.4')
    expect(r).toContain('UNCERTAINTY')
  })

  it('countertopLm defaults to 0 when missing — does not crash', () => {
    const r = normalizeKitchenVision({
      kitchenLayout: 'I',
      baseLm: 3,
      wallLm: 2,
      hasIsland: false,
      islandLm: 0,
      confidence: 40,
      uncertainty: '',
    })
    expect(r.countertopLm).toBe(0)
    expect(r.countertopReasoning).toBe('')
  })
})
