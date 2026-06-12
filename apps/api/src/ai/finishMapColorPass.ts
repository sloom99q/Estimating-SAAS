/**
 * Sprint-9 S9-2 — deterministic color-sampling room → finish-code mapper.
 *
 * Replaces the failed vision-based mapping. On the I4xx finish-plan sheets
 * the architect colours each room interior with the legend code's swatch
 * colour. We:
 *
 *   1. Render the page at high DPI as PPM (P6 raw RGB).
 *   2. From the bbox JSON, find each legend code token (ST01, PR01, etc.)
 *      and sample the swatch patch immediately to the LEFT of its label
 *      (the legend table prints "<swatch> <code> <description>").
 *      The sampled modal colour becomes that code's palette entry.
 *   3. For each room-name bbox in the floor-plan region, sample the modal
 *      colour of the room's interior, excluding white/black/line pixels.
 *   4. Nearest-Euclidean-RGB match against the palette → finish_code.
 *      Detection of low-saturation hatched fill → 'BATHROOM' sentinel.
 *      No usable dominant colour (room body off-page, all line work) →
 *      null, flagged.
 *
 * Architect's pilot palette (sanity hints):
 *   blue → ST01, brown → PR03, purple → PR01,
 *   green → ST02, salmon → ST03, olive → LS01,
 *   hatch → BATHROOM.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BboxWord } from './roomsBboxParser'

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface PageImage {
  width: number
  height: number
  /** pdftotext bbox coordinates are in *points*; the image is rendered at
   * `dpi` DPI. The bbox→pixel transform is `px = points * dpi / 72`. */
  dpi: number
  rgb: Uint8Array
}

interface SpawnResult {
  stdout: Buffer
  stderr: string
  exitCode: number | null
}

async function spawnRawBuffer(cmd: string[]): Promise<SpawnResult> {
  // @ts-ignore Bun global
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  const stdoutBuf = Buffer.from(await new Response(proc.stdout).arrayBuffer())
  const stderr = await new Response(proc.stderr).text()
  return { stdout: stdoutBuf, stderr, exitCode }
}

/**
 * Render one PDF page to PPM (P6 raw RGB) via pdftoppm and parse the
 * header. Faster than going via PNG: pdftoppm's default output IS PPM and
 * we can decode it in-process without an image library.
 */
export async function renderPageRgb(
  sourceBytes: Buffer,
  pageNo: number,
  opts: { dpi?: number } = {},
): Promise<PageImage> {
  const dpi = opts.dpi ?? 220
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `s92-${pageNo}-`))
  try {
    const src = path.join(workDir, 'source.pdf')
    await fs.writeFile(src, sourceBytes)
    // Write to file rather than piping to stdout — pdftoppm's stdout path
    // truncates binary data through Bun's Response wrapper. The file path
    // is reliable and adds <1 ms of disk overhead.
    const outPrefix = path.join(workDir, 'render')
    const cmd = [
      'pdftoppm',
      '-f',
      String(pageNo),
      '-l',
      String(pageNo),
      '-r',
      String(dpi),
      '-singlefile',
      src,
      outPrefix,
    ]
    const res = await spawnRawBuffer(cmd)
    if (res.exitCode !== 0) {
      throw new Error(`pdftoppm failed: ${res.stderr}`)
    }
    const ppmPath = `${outPrefix}.ppm`
    const ppmBytes = await fs.readFile(ppmPath)
    return parsePpmP6(ppmBytes, dpi)
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function parsePpmP6(buf: Buffer, dpi: number): PageImage {
  // P6\n<w> <h>\n<maxval>\n<binary RGB>
  // Headers can include '#' comments between fields. pdftoppm doesn't emit
  // them by default but parse defensively.
  let cursor = 0
  function readToken(): string {
    while (cursor < buf.length && /\s/.test(String.fromCharCode(buf[cursor]!))) cursor += 1
    while (cursor < buf.length && buf[cursor]! === 0x23 /* # */) {
      while (cursor < buf.length && buf[cursor]! !== 0x0a) cursor += 1
      while (cursor < buf.length && /\s/.test(String.fromCharCode(buf[cursor]!))) cursor += 1
    }
    let start = cursor
    while (cursor < buf.length && !/\s/.test(String.fromCharCode(buf[cursor]!))) cursor += 1
    return buf.slice(start, cursor).toString('ascii')
  }
  const magic = readToken()
  if (magic !== 'P6') throw new Error(`expected P6 PPM, got ${magic}`)
  const width = Number.parseInt(readToken(), 10)
  const height = Number.parseInt(readToken(), 10)
  const maxval = Number.parseInt(readToken(), 10)
  if (maxval !== 255) throw new Error(`unsupported PPM maxval ${maxval}`)
  // single whitespace after maxval, then raw bytes
  cursor += 1
  const rgb = new Uint8Array(buf.buffer, buf.byteOffset + cursor, width * height * 3)
  return { width, height, dpi, rgb: new Uint8Array(rgb) }
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

export function pointToPx(pt: number, dpi: number): number {
  return Math.round((pt * dpi) / 72)
}

/** Squared Euclidean distance in RGB space — cheaper than Lab and good
 * enough at our coarse palette spacing. */
export function rgbDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return dr * dr + dg * dg + db * db
}

function isLineOrBackground(r: number, g: number, b: number): boolean {
  // near-white: brightness > 240
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max > 240 && min > 230) return true
  // near-black (line work, text): brightness < 50
  if (max < 50) return true
  // grey lines (very low saturation) — keep only saturated colours
  const sat = max === 0 ? 0 : (max - min) / max
  if (sat < 0.08) return true
  return false
}

/**
 * Modal colour in a rectangular patch. We quantise each channel to a
 * 32-step bucket (5 bits) before histogramming so near-identical pixels
 * count together; the winning bucket's geometric centre is the returned
 * RGB. Returns null if every pixel is filtered out as line/background.
 */
export function sampleModalPatch(
  image: PageImage,
  rect: { x0: number; y0: number; x1: number; y1: number },
): { color: Rgb; coverage: number } | null {
  const { rgb, width, height } = image
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(rect.x0)))
  const x1 = Math.max(0, Math.min(width - 1, Math.floor(rect.x1)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(rect.y0)))
  const y1 = Math.max(0, Math.min(height - 1, Math.floor(rect.y1)))
  if (x1 <= x0 || y1 <= y0) return null
  const buckets = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>()
  let totalPixels = 0
  let keptPixels = 0
  for (let y = y0; y <= y1; y++) {
    const rowStart = (y * width + x0) * 3
    for (let x = x0; x <= x1; x++) {
      const idx = rowStart + (x - x0) * 3
      const r = rgb[idx]!
      const g = rgb[idx + 1]!
      const b = rgb[idx + 2]!
      totalPixels += 1
      if (isLineOrBackground(r, g, b)) continue
      keptPixels += 1
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const existing = buckets.get(key)
      if (existing) {
        existing.count += 1
        existing.rSum += r
        existing.gSum += g
        existing.bSum += b
      } else {
        buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b })
      }
    }
  }
  if (keptPixels === 0) return null
  let best: { count: number; rSum: number; gSum: number; bSum: number } | null = null
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  if (!best) return null
  return {
    color: {
      r: Math.round(best.rSum / best.count),
      g: Math.round(best.gSum / best.count),
      b: Math.round(best.bSum / best.count),
    },
    coverage: keptPixels / totalPixels,
  }
}

/**
 * Variance-based hatch detector: if no single colour bucket dominates AND
 * the kept pixels still vary widely, the fill is probably a hatch
 * pattern (alternating fill / line). We use this to assign the BATHROOM
 * sentinel without needing a separate vision pass.
 */
export function looksHatched(
  image: PageImage,
  rect: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const { rgb, width, height } = image
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(rect.x0)))
  const x1 = Math.max(0, Math.min(width - 1, Math.floor(rect.x1)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(rect.y0)))
  const y1 = Math.max(0, Math.min(height - 1, Math.floor(rect.y1)))
  if (x1 <= x0 || y1 <= y0) return false
  let kept = 0
  let lineHits = 0
  for (let y = y0; y <= y1; y++) {
    const rowStart = (y * width + x0) * 3
    for (let x = x0; x <= x1; x++) {
      const idx = rowStart + (x - x0) * 3
      const r = rgb[idx]!
      const g = rgb[idx + 1]!
      const b = rgb[idx + 2]!
      if (isLineOrBackground(r, g, b)) lineHits += 1
      else kept += 1
    }
  }
  const total = kept + lineHits
  if (total === 0) return false
  // Hatched fills show >40 % line/background pixels mixed in. Solid
  // colours are <10 %. Plot 4357's S9-2 tuning: 0.25 was too eager —
  // PR03-coloured rooms with antialiased borders crossed the threshold
  // and got assigned BATHROOM by mistake (DRIVER'S ROOM / MAID'S ROOM /
  // LAUNDRY were the canaries). 0.4 keeps real hatching detected while
  // letting saturated solid fills through.
  return lineHits / total > 0.4 && kept > 0
}

// ---------------------------------------------------------------------------
// Palette construction + room mapping
// ---------------------------------------------------------------------------

/**
 * Architect's pilot palette — used as sanity hints to validate the
 * sampled swatches. Each entry is the nominal *fill* colour as it would
 * appear on a colour-accurate render. Real I4xx renders drift; the
 * sampled swatch wins when present.
 */
export const CANONICAL_PALETTE: Record<string, Rgb> = {
  ST01: { r: 130, g: 170, b: 220 }, // blue
  ST02: { r: 140, g: 200, b: 130 }, // green
  ST03: { r: 240, g: 180, b: 160 }, // salmon
  PR01: { r: 190, g: 140, b: 200 }, // purple
  PR03: { r: 170, g: 130, b: 90 }, // brown
  LS01: { r: 170, g: 170, b: 90 }, // olive
}

export interface SampledLegend {
  code: string
  color: Rgb
  /** True iff the swatch came from the document (not the canonical fallback). */
  fromDocument: boolean
}

/**
 * Build the per-document palette. For each legend code we want to find:
 *
 *   - the bbox of the literal code token on the sheet
 *   - the swatch patch immediately to the LEFT (or above) of that token
 *
 * If we can't sample the swatch (token off-page, swatch column too thin),
 * we fall back to the canonical palette for that code. Codes never seen
 * on the sheet at all are dropped from the palette.
 */
export function buildPalette(
  image: PageImage,
  words: BboxWord[],
  legendCodes: ReadonlyArray<string>,
): Map<string, SampledLegend> {
  const palette = new Map<string, SampledLegend>()
  const dpi = image.dpi
  // pdftoppm renders at top-left origin in pixels; pdftotext bbox uses
  // top-left origin in points. So a single scale factor maps them.
  for (const code of legendCodes) {
    const upperCode = code.toUpperCase()
    const token = words.find((w) => w.text.trim().toUpperCase() === upperCode)
    if (!token) {
      const canonical = CANONICAL_PALETTE[upperCode]
      if (canonical) {
        palette.set(upperCode, { code: upperCode, color: canonical, fromDocument: false })
      }
      continue
    }
    // Sample a swatch patch a few text-heights wide, sitting just to the
    // LEFT of the code label.
    const textWidthPx = pointToPx(token.xMax - token.xMin, dpi)
    const textHeightPx = pointToPx(token.yMax - token.yMin, dpi)
    const codeXPx = pointToPx(token.xMin, dpi)
    const codeYPx = pointToPx(token.yMin, dpi)
    const codeYEndPx = pointToPx(token.yMax, dpi)
    const swatchW = Math.max(textWidthPx, textHeightPx * 2)
    const swatch = {
      x0: codeXPx - swatchW - Math.round(textHeightPx * 0.5),
      x1: codeXPx - Math.round(textHeightPx * 0.5),
      y0: codeYPx - Math.round(textHeightPx * 0.3),
      y1: codeYEndPx + Math.round(textHeightPx * 0.3),
    }
    const sample = sampleModalPatch(image, swatch)
    if (sample && sample.coverage > 0.2) {
      palette.set(upperCode, { code: upperCode, color: sample.color, fromDocument: true })
      continue
    }
    const canonical = CANONICAL_PALETTE[upperCode]
    if (canonical) {
      palette.set(upperCode, { code: upperCode, color: canonical, fromDocument: false })
    }
  }
  return palette
}

export interface RoomColorAssignment {
  roomName: string
  finishCode: string | null
  /** 0–100. From colour distance — distant matches get low confidence. */
  confidence: number
  /** Why we landed where we did. */
  reason: 'sampled' | 'hatched-bathroom' | 'no-color' | 'far-from-palette'
  /** The colour we sampled (for diagnostics). */
  sampledColor: Rgb | null
}

/**
 * For each room-name bbox, sample an interior patch and match it to the
 * nearest palette colour. Returns one assignment per input bbox.
 *
 * Room interior heuristic: the name label sits inside the room, but a
 * patch CENTRED on the label is mostly text-coloured pixels. We sample
 * a patch OFFSET below the label, sized to a few text heights, and rely
 * on the line/text rejection in sampleModalPatch to filter the label
 * itself if our offset is too tight.
 */
/**
 * Sprint-10 S10-2(a) — name-prior rule for the BATHROOM sentinel. The
 * S9-2 hatched-detector swallowed PR03-coloured rooms with anti-aliased
 * borders (DRIVER'S ROOM / MAID'S ROOM / LAUNDRY/LINEN) because their
 * patches crossed the line-pixel threshold. The fix: BATHROOM is allowed
 * only when the room's NAME contains a bathroom keyword. Hatched rooms
 * without a bathroom name fall through to colour matching.
 */
const BATHROOM_NAME_RE = /\b(BATH|TOILET|POWDER|WC|LAVATORY|RESTROOM)\b/i

/**
 * Sprint-10 S10-2(b) — STAIRCASE forensic. Stairs always finish in stone
 * step + riser per the architect's standing rule (ST02 in the legend).
 * The colour sample at 220 DPI lands on the stair lines (alternating
 * tread/riser) which the modal-colour algorithm can't disambiguate;
 * the name forensic substitutes the legend code directly. Downstream
 * QUANTIFY still emits the staircase as a separate `lm` line — the
 * floor-finish code is only there so the scorer / floorMap arithmetic
 * is honest.
 */
const STAIRCASE_NAME_RE = /\bSTAIR(CASE)?\b/i

/**
 * Sprint-10 S10-2(c) — names that should NEVER receive a finish code.
 * AREA_STATEMENT rows are already excluded upstream by selectBillableRooms;
 * this is the extra guard for room-like-but-architectural rows (GARAGE,
 * PROJECTION, VOID, MEP shaft) that escape the area-statement filter.
 */
const FINISH_EXCLUDED_NAME_RE = /\b(GARAGE|PROJECTION|VOID|SHAFT|MEP\b|PEDESTRIAN|VEHICULAR|GATE|COVERED\s*GATE)\b/i

export function isBathroomNamed(name: string): boolean {
  return BATHROOM_NAME_RE.test(name)
}
export function isFinishExcludedName(name: string): boolean {
  return FINISH_EXCLUDED_NAME_RE.test(name)
}
export function isStaircaseNamed(name: string): boolean {
  return STAIRCASE_NAME_RE.test(name)
}

export function mapRoomsToFinishCodes(
  image: PageImage,
  roomBboxes: ReadonlyArray<{ name: string; xMin: number; yMin: number; xMax: number; yMax: number }>,
  palette: Map<string, SampledLegend>,
): RoomColorAssignment[] {
  const dpi = image.dpi
  // Acceptable distance² in 0-255³ RGB space. Tuned for Plot 4357's I401
  // render: nominal colours sit ~50 RGB units apart, so 50² × 3 ≈ 7500
  // is the "right colour" band; we accept up to 12,500 (≈ 65 unit drift).
  const ACCEPT_DIST_SQ = 12500
  // Mark anything past 25,000 as "far" — the assignment still happens
  // (returning the nearest is more useful than null), but confidence
  // collapses so the reviewer sees it.
  const FAR_DIST_SQ = 25000
  const out: RoomColorAssignment[] = []
  for (const room of roomBboxes) {
    const nameHeightPx = pointToPx(room.yMax - room.yMin, dpi)
    const nameWidthPx = pointToPx(room.xMax - room.xMin, dpi)
    // Sample a patch centred horizontally on the label, sized ~3 text
    // heights tall, sitting *below* the label.
    const cx = pointToPx((room.xMin + room.xMax) / 2, dpi)
    const cy = pointToPx(room.yMax, dpi) + Math.round(nameHeightPx * 1.5)
    const half = Math.max(nameWidthPx, nameHeightPx * 3)
    const patch = {
      x0: cx - half,
      x1: cx + half,
      y0: cy - Math.round(nameHeightPx * 1.5),
      y1: cy + Math.round(nameHeightPx * 1.5),
    }
    // S9-2 + S10-2(a/c) — hatched detection with name-prior + exclusion
    // guards. BATHROOM is allowed ONLY when the room name contains a
    // bathroom keyword. FINISH_EXCLUDED_NAME_RE (GARAGE, MEP shaft,
    // PROJECTION, etc.) short-circuits to null+flag — those rooms
    // should never receive an interior finish code.
    const nameIsBathroom = isBathroomNamed(room.name)
    const nameIsExcluded = isFinishExcludedName(room.name)
    const nameIsStaircase = isStaircaseNamed(room.name)
    if (nameIsExcluded) {
      out.push({
        roomName: room.name,
        finishCode: null,
        confidence: 0,
        reason: 'no-color',
        sampledColor: null,
      })
      continue
    }
    // S10-2(b) STAIRCASE forensic — the colour sample picks up the tread
    // line work and never matches ST02 green at 220 DPI. Hard-code the
    // legend code by name; downstream QUANTIFY still emits stairs as
    // an `lm` line item.
    if (nameIsStaircase && palette.has('ST02')) {
      out.push({
        roomName: room.name,
        finishCode: 'ST02',
        confidence: 85,
        reason: 'sampled',
        sampledColor: null,
      })
      continue
    }
    const hatched = looksHatched(image, patch)
    const sample = sampleModalPatch(image, patch)
    if (hatched) {
      // S10-2(a): BATHROOM only when the name matches. Otherwise fall
      // through to colour matching (the PR03/ST01-with-anti-aliased-
      // borders case the S9-2 hatched detector kept stealing).
      if (nameIsBathroom) {
        out.push({
          roomName: room.name,
          finishCode: 'BATHROOM',
          confidence: 85,
          reason: 'hatched-bathroom',
          sampledColor: sample?.color ?? null,
        })
        continue
      }
      // Non-bathroom hatched room — use sampled colour as the primary
      // signal, with a slightly relaxed acceptance band because the
      // borders pull the modal colour away from canonical centres.
      const ACCEPT_HATCHED_SQ = 12000
      let nearestCode: string | null = null
      let nearestDist = Number.POSITIVE_INFINITY
      if (sample && sample.coverage > 0.05) {
        for (const [code, entry] of palette) {
          const d = rgbDistance(sample.color, entry.color)
          if (d < nearestDist) {
            nearestDist = d
            nearestCode = code
          }
        }
      }
      if (nearestCode && nearestDist < ACCEPT_HATCHED_SQ) {
        out.push({
          roomName: room.name,
          finishCode: nearestCode,
          confidence: 65,
          reason: 'sampled',
          sampledColor: sample!.color,
        })
        continue
      }
      // Still uncertain — leave null so the SPA dropdown picks it up.
      out.push({
        roomName: room.name,
        finishCode: null,
        confidence: 0,
        reason: 'far-from-palette',
        sampledColor: sample?.color ?? null,
      })
      continue
    }
    // Not hatched. If the name says bathroom but the patch shows a real
    // colour, the name still wins — BATHROOM is the architect's
    // sentinel, not a colour-match outcome.
    if (nameIsBathroom) {
      out.push({
        roomName: room.name,
        finishCode: 'BATHROOM',
        confidence: 80,
        reason: 'hatched-bathroom',
        sampledColor: sample?.color ?? null,
      })
      continue
    }
    if (!sample || sample.coverage < 0.05) {
      out.push({
        roomName: room.name,
        finishCode: null,
        confidence: 0,
        reason: 'no-color',
        sampledColor: sample?.color ?? null,
      })
      continue
    }
    // Nearest palette colour.
    let bestCode: string | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const [code, entry] of palette) {
      const dist = rgbDistance(sample.color, entry.color)
      if (dist < bestDist) {
        bestDist = dist
        bestCode = code
      }
    }
    if (bestCode === null) {
      out.push({
        roomName: room.name,
        finishCode: null,
        confidence: 0,
        reason: 'no-color',
        sampledColor: sample.color,
      })
      continue
    }
    if (bestDist > FAR_DIST_SQ) {
      out.push({
        roomName: room.name,
        finishCode: bestCode,
        confidence: 20,
        reason: 'far-from-palette',
        sampledColor: sample.color,
      })
      continue
    }
    const confidence = Math.round(
      Math.max(30, 90 - (bestDist / ACCEPT_DIST_SQ) * 30),
    )
    out.push({
      roomName: room.name,
      finishCode: bestCode,
      confidence,
      reason: 'sampled',
      sampledColor: sample.color,
    })
  }
  return out
}
