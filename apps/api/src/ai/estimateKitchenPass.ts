/**
 * AI-estimation engine roadmap #3 — KITCHEN base + wall cabinet lm.
 *
 * Vision-augmented suggestion. ONE call per project on a bbox-derived
 * crop of the kitchen room from A101 (the existing room bbox; no blind
 * second vision pass hunting for the kitchen).
 *
 * Hard contract (expert call 2026-06-20):
 *   - opt-in only — never auto-runs on cold upload
 *   - confidence HARD CAPPED at 60 regardless of model self-report
 *   - reasoning sub-line MUST state: layout, walls counted with lengths,
 *     explicit uncertainty (what was unclear / cut off / ambiguous).
 *     An honest "third wall cut off at edge — low confidence" beats a
 *     confident wrong number.
 *   - basis='ESTIMATED', status='AI', Override-then-Confirm in the
 *     verify UI like skirting/vanity
 *   - routes to JOINERY section 2.6 Wood: tag KB-* → KIT-BASE (1200/lm),
 *     KW-* → KIT-WALL (1100/lm)
 *
 * Token cost: ~1.5–2k per click (~$0.01). Crop is GENEROUS by design —
 * a tight crop that misses the third wall is the worst failure; an
 * oversized crop only costs fractions of a cent more.
 */

/**
 * A pdftotext-derived bbox in PDF points. yMin is at the top of the
 * page (top-left origin per pdftotext convention).
 */
export interface PointBbox {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

/**
 * Pixel bbox at a given DPI. Used for the JPEG crop.
 */
export interface PixelBbox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Parse a sheet scale string into a denominator. Returns 75 for "1:75",
 * 50 for "1/50", 100 for "1:100 / 1:200" (the first scale wins).
 * Returns null when nothing parseable.
 *
 * Real-world conventions on Plot 4357: ground-floor plans are 1:75,
 * details vary. Falling back to 75 when null is reasonable.
 */
export function parseScaleDenominator(scale: string | null | undefined): number | null {
  if (!scale) return null
  const m = scale.match(/1\s*[:/]\s*(\d{2,4})/)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Compute the crop window in pixels at a given render DPI.
 *
 * Inputs:
 *   - nameBox: where pdftotext found the kitchen label (points)
 *   - scaleDenominator: sheet scale (e.g. 75 for 1:75). Optional —
 *     when missing we fall back to a generous fixed margin.
 *   - renderDpi: the DPI at which the source PDF is rendered to JPEG.
 *   - sheetPixelWidth, sheetPixelHeight: clamp the crop to the sheet
 *     bounds.
 *   - sheetPointWidth, sheetPointHeight: bounds in points (matches
 *     pdftotext's coordinate system). Used to translate bbox → pixels.
 *
 * Rules (per the design + expert override 2026-06-20):
 *   - Margin: max(1.5 m on plan in pixels, 300 px). Generous on
 *     purpose — undercount from a tight crop is worse than +$0.001 of
 *     extra tokens.
 *   - Minimum crop size: 1200 × 1200 px. Floors the crop for very
 *     small kitchen labels.
 *   - Clamp to the sheet's pixel bounds so we don't read past the
 *     rendered edge.
 */
export function computeKitchenCrop(args: {
  nameBox: PointBbox
  scaleDenominator: number | null
  renderDpi: number
  sheetPixelWidth: number
  sheetPixelHeight: number
  sheetPointWidth: number
  sheetPointHeight: number
}): PixelBbox {
  const POINTS_PER_INCH = 72
  const MM_PER_INCH = 25.4
  const MIN_CROP_PX = 1200
  const FIXED_MARGIN_PX = 300

  // Translate the nameBox from points → pixels at the render DPI.
  // pdftotext returns points anchored at top-left of the page.
  const ptToPx = (pt: number) => (pt * args.renderDpi) / POINTS_PER_INCH

  const labelXMinPx = ptToPx(args.nameBox.xMin)
  const labelYMinPx = ptToPx(args.nameBox.yMin)
  const labelXMaxPx = ptToPx(args.nameBox.xMax)
  const labelYMaxPx = ptToPx(args.nameBox.yMax)

  // Margin sized to 1.5 m of physical space, when the scale is known.
  //   1.5 m physical = 1500 mm
  //   on paper (at 1:N scale) = 1500/N mm
  //   in inches = (1500/N) / 25.4
  //   in pixels at renderDpi = (1500/N) / 25.4 * renderDpi
  const marginByScale = args.scaleDenominator
    ? (1500 / args.scaleDenominator / MM_PER_INCH) * args.renderDpi
    : 0
  const marginPx = Math.max(marginByScale, FIXED_MARGIN_PX)

  // Apply the margin to the label box.
  const expandedXMin = labelXMinPx - marginPx
  const expandedYMin = labelYMinPx - marginPx
  const expandedXMax = labelXMaxPx + marginPx
  const expandedYMax = labelYMaxPx + marginPx

  // Now floor to MIN_CROP_PX in each dimension.
  let width = Math.max(expandedXMax - expandedXMin, MIN_CROP_PX)
  let height = Math.max(expandedYMax - expandedYMin, MIN_CROP_PX)

  // Re-center on the label center when we hit the MIN_CROP_PX floor.
  const cx = (labelXMinPx + labelXMaxPx) / 2
  const cy = (labelYMinPx + labelYMaxPx) / 2
  let x = cx - width / 2
  let y = cy - height / 2

  // Clamp to sheet bounds.
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x + width > args.sheetPixelWidth) {
    width = Math.max(args.sheetPixelWidth - x, 0)
  }
  if (y + height > args.sheetPixelHeight) {
    height = Math.max(args.sheetPixelHeight - y, 0)
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

/**
 * The vision pass returns this shape via a tool-call response.
 * confidence is the model's self-report, capped downstream at 60.
 */
export interface KitchenVisionRaw {
  kitchenLayout?: 'I' | 'L' | 'U' | 'OPEN-ISLAND' | 'OTHER'
  baseLm?: number
  baseReasoning?: string
  wallLm?: number
  wallReasoning?: string
  hasIsland?: boolean
  islandLm?: number
  confidence?: number
  uncertainty?: string
}

/**
 * Cleaned + capped output the handler persists. Reasoning string is
 * formed from baseReasoning + wallReasoning + uncertainty so the verify
 * UI surfaces all three on one line.
 */
export interface KitchenEstimate {
  layout: 'I' | 'L' | 'U' | 'OPEN-ISLAND' | 'OTHER'
  baseLm: number
  wallLm: number
  hasIsland: boolean
  islandLm: number
  confidence: number
  baseReasoning: string
  wallReasoning: string
  uncertainty: string
}

/** Hard upper cap on the suggestion's confidence per the expert call. */
const CONFIDENCE_CAP = 60

export function normalizeKitchenVision(raw: KitchenVisionRaw): KitchenEstimate {
  const layout =
    raw.kitchenLayout === 'I' ||
    raw.kitchenLayout === 'L' ||
    raw.kitchenLayout === 'U' ||
    raw.kitchenLayout === 'OPEN-ISLAND'
      ? raw.kitchenLayout
      : 'OTHER'
  const baseLm = Number.isFinite(raw.baseLm) ? Math.max(0, raw.baseLm!) : 0
  const wallLm = Number.isFinite(raw.wallLm) ? Math.max(0, raw.wallLm!) : 0
  const hasIsland = raw.hasIsland === true
  const islandLm = Number.isFinite(raw.islandLm) ? Math.max(0, raw.islandLm!) : 0
  const rawConfidence = Number.isFinite(raw.confidence) ? raw.confidence! : 50
  const confidence = Math.max(0, Math.min(CONFIDENCE_CAP, Math.round(rawConfidence)))
  return {
    layout,
    baseLm,
    wallLm,
    hasIsland,
    islandLm,
    confidence,
    baseReasoning: typeof raw.baseReasoning === 'string' ? raw.baseReasoning : '',
    wallReasoning: typeof raw.wallReasoning === 'string' ? raw.wallReasoning : '',
    uncertainty: typeof raw.uncertainty === 'string' ? raw.uncertainty : '',
  }
}

/**
 * Compose the one-line reasoning shown in the verify UI. Order matters:
 * layout first (gives the expert immediate orientation), then base/wall
 * with their explicit wall counts, then the uncertainty admission. The
 * expert reads the uncertainty line FIRST in practice.
 */
export function composeKitchenReasoning(
  category: 'base' | 'wall',
  est: KitchenEstimate,
): string {
  const layoutPart = `Layout: ${est.layout}${est.hasIsland ? ' + island' : ''}`
  const reasoning =
    category === 'base'
      ? `Base: ${est.baseReasoning || '(no breakdown given)'}` +
        (est.hasIsland ? ` · island ${est.islandLm.toFixed(2)} lm` : '')
      : `Wall: ${est.wallReasoning || '(no breakdown given)'}`
  const uncertainty = est.uncertainty ? ` · UNCERTAINTY: ${est.uncertainty}` : ''
  return `${layoutPart} · ${reasoning}${uncertainty}`
}

/**
 * System prompt — biased toward admitting uncertainty over guessing,
 * per the expert call. The model is told the confidence will be capped
 * at 60 server-side so it has no incentive to inflate self-report.
 */
export const KITCHEN_SYSTEM_PROMPT = `You are an experienced QS reading a residential villa kitchen plan view to estimate cabinet linear meters.

Your output FEEDS A HUMAN EXPERT WHO WILL VERIFY EVERY NUMBER. The expert's time is best used when YOU ARE HONEST about what you can and can't see. An honest "third wall is cut off at the image edge, can't measure it" is far more valuable to them than a confident wrong number.

OUTPUT RULES (hard):
1. Identify layout: I (one wall), L (two walls), U (three walls), OPEN-ISLAND (cabinets along walls plus an island), or OTHER.
2. For BASE cabinets, count each wall along which base cabinets would run. List the wall and its approximate length in meters, e.g. "south wall 4.2 m + west wall 3.8 m = 8.0 lm". Add island perimeter to the base total if present.
3. For WALL (upper) cabinets, count only walls/sections that typically carry upper cabinets. WALL LM IS TYPICALLY LESS THAN BASE LM — upper cabinets are usually absent over windows, over the range hood, over the sink (unless explicitly shown), and over the island. Be conservative.
4. The "uncertainty" field is REQUIRED. State in ONE sentence what was unclear, cut off, ambiguous, or beyond your ability to read from the image. If everything was clear, say so explicitly.
5. Your "confidence" self-report is capped server-side at 60. Do not inflate it. A confidence of 40-50 with an honest reasoning beats 60 with a guess.

OUTPUT VIA the kitchen_estimate tool only. Do not write prose outside the tool call.`

export interface KitchenToolDef {
  name: 'kitchen_estimate'
  description: string
  input_schema: object
}

export const KITCHEN_TOOL: KitchenToolDef = {
  name: 'kitchen_estimate',
  description:
    'Return the kitchen layout assessment with base + wall cabinet linear meters and explicit uncertainty.',
  input_schema: {
    type: 'object',
    properties: {
      kitchenLayout: {
        type: 'string',
        enum: ['I', 'L', 'U', 'OPEN-ISLAND', 'OTHER'],
        description: 'Detected kitchen layout shape.',
      },
      baseLm: {
        type: 'number',
        description: 'Total base-cabinet linear meters, including island perimeter when present.',
      },
      baseReasoning: {
        type: 'string',
        description:
          'Per-wall breakdown with lengths, e.g. "south wall 4.2 m + west wall 3.8 m + island 1.0 m = 9.0 lm".',
      },
      wallLm: {
        type: 'number',
        description:
          'Total wall (upper) cabinet linear meters. Typically less than baseLm; exclude windows, range hood, sink areas, and the island.',
      },
      wallReasoning: {
        type: 'string',
        description:
          'Which walls/sections carry upper cabinets and their lengths.',
      },
      hasIsland: {
        type: 'boolean',
        description: 'Whether an island or peninsula was detected.',
      },
      islandLm: {
        type: 'number',
        description: 'Island/peninsula perimeter in meters (0 if no island).',
      },
      confidence: {
        type: 'number',
        description:
          'Self-reported confidence 0-60. Capped server-side at 60 regardless.',
      },
      uncertainty: {
        type: 'string',
        description:
          'REQUIRED. One sentence on what was unclear, cut off, or ambiguous. If everything was clear, state that explicitly.',
      },
    },
    required: [
      'kitchenLayout',
      'baseLm',
      'baseReasoning',
      'wallLm',
      'wallReasoning',
      'hasIsland',
      'islandLm',
      'confidence',
      'uncertainty',
    ],
  },
}

export const KITCHEN_PROMPT_VERSION = 'kitchen.estimate.v1'
