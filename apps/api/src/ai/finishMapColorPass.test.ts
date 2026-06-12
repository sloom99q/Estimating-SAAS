import { describe, expect, it } from 'bun:test'
import {
  CANONICAL_PALETTE,
  buildPalette,
  mapRoomsToFinishCodes,
  rgbDistance,
  sampleModalPatch,
  type PageImage,
} from './finishMapColorPass'

// Synthetic PageImage helper — paints a solid-fill rectangle on a white
// canvas at the given coords with the given colour, then returns the
// page-image. Used to drive the sampler without a real PDF render.
function paintRect(
  image: PageImage,
  rect: { x0: number; y0: number; x1: number; y1: number },
  color: { r: number; g: number; b: number },
): void {
  const { rgb, width } = image
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const idx = (y * width + x) * 3
      rgb[idx] = color.r
      rgb[idx + 1] = color.g
      rgb[idx + 2] = color.b
    }
  }
}

function blankWhite(width: number, height: number, dpi = 220): PageImage {
  const rgb = new Uint8Array(width * height * 3)
  rgb.fill(255)
  return { width, height, dpi, rgb }
}

describe('sampleModalPatch', () => {
  it('returns the painted colour when patch is a single solid block', () => {
    const img = blankWhite(100, 100)
    paintRect(img, { x0: 20, y0: 20, x1: 80, y1: 80 }, { r: 130, g: 170, b: 220 })
    const sample = sampleModalPatch(img, { x0: 30, y0: 30, x1: 70, y1: 70 })
    expect(sample).not.toBeNull()
    expect(sample!.color).toEqual({ r: 130, g: 170, b: 220 })
    expect(sample!.coverage).toBeGreaterThan(0.9)
  })

  it('returns null on an all-white patch (no signal)', () => {
    const img = blankWhite(100, 100)
    const sample = sampleModalPatch(img, { x0: 10, y0: 10, x1: 50, y1: 50 })
    expect(sample).toBeNull()
  })

  it('ignores near-black line pixels (text/borders) and picks the fill', () => {
    const img = blankWhite(100, 100)
    paintRect(img, { x0: 10, y0: 10, x1: 90, y1: 90 }, { r: 200, g: 150, b: 120 })
    paintRect(img, { x0: 40, y0: 40, x1: 60, y1: 60 }, { r: 20, g: 20, b: 20 })
    const sample = sampleModalPatch(img, { x0: 10, y0: 10, x1: 90, y1: 90 })
    expect(sample).not.toBeNull()
    expect(sample!.color).toEqual({ r: 200, g: 150, b: 120 })
  })
})

describe('buildPalette + mapRoomsToFinishCodes', () => {
  it('falls back to the canonical palette when no swatch is sampleable', () => {
    const img = blankWhite(50, 50)
    const palette = buildPalette(img, [], ['ST01', 'PR03'])
    expect(palette.get('ST01')?.color).toEqual(CANONICAL_PALETTE.ST01!)
    expect(palette.get('ST01')?.fromDocument).toBe(false)
    expect(palette.get('PR03')?.fromDocument).toBe(false)
  })

  it('matches a blue room patch to ST01 against the canonical palette', () => {
    const img = blankWhite(400, 400)
    // paint a room patch in ST01's nominal blue
    paintRect(img, { x0: 200, y0: 200, x1: 350, y1: 350 }, CANONICAL_PALETTE.ST01!)
    const palette = buildPalette(img, [], ['ST01', 'PR03', 'PR01', 'LS01'])
    const dpi = 220
    // Pretend "LIVING" sits at bbox (270, 200, 320, 215) in points;
    // pointToPx(270, 220) = 824 px — too far. So we use small points.
    const pointsPerPx = 72 / dpi
    const bbox = {
      name: 'LIVING',
      xMin: 270 * pointsPerPx,
      yMin: 250 * pointsPerPx,
      xMax: 290 * pointsPerPx,
      yMax: 260 * pointsPerPx,
    }
    const out = mapRoomsToFinishCodes(img, [bbox], palette)
    expect(out).toHaveLength(1)
    expect(out[0]!.finishCode).toBe('ST01')
    expect(out[0]!.reason).toBe('sampled')
    expect(out[0]!.confidence).toBeGreaterThan(50)
  })

  it("returns null + 'no-color' on a label whose patch is all white", () => {
    const img = blankWhite(400, 400)
    const palette = buildPalette(img, [], ['ST01'])
    const pointsPerPx = 72 / 220
    const bbox = {
      name: 'EMPTY',
      xMin: 100 * pointsPerPx,
      yMin: 100 * pointsPerPx,
      xMax: 120 * pointsPerPx,
      yMax: 110 * pointsPerPx,
    }
    const out = mapRoomsToFinishCodes(img, [bbox], palette)
    expect(out[0]!.finishCode).toBeNull()
    expect(out[0]!.reason).toBe('no-color')
  })
})

describe('rgbDistance', () => {
  it('is zero for identical colours', () => {
    expect(rgbDistance({ r: 100, g: 100, b: 100 }, { r: 100, g: 100, b: 100 })).toBe(0)
  })
  it('squared-euclidean against axis-aligned drifts', () => {
    expect(rgbDistance({ r: 0, g: 0, b: 0 }, { r: 10, g: 0, b: 0 })).toBe(100)
    expect(rgbDistance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 10 })).toBe(100)
  })
})
