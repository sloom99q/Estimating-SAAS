/**
 * Sprint-7 S7-4 — spatial room-area pair extractor.
 *
 * Input: bbox-layout output from `pdftotext -bbox-layout` (we ship a JSON
 * adapter that flattens the HTML into `{ words: [{text, xMin, yMin, xMax,
 * yMax}] }`).
 *
 * Output: room/area pairs.
 *
 * Algorithm (third strike; see Plot 4357 pilot — Sprint 4 and Sprint 6 both
 * failed area capture with regex-only / vision-only approaches):
 *
 *   1. Group words spatially into LINES — same y-band, within ½ text height.
 *   2. Inside each line, merge adjacent words separated by < ~textHeight
 *      into TOKENS.
 *   3. Identify AREA candidates: token matching /^\d{1,3}\.\d{2}$/ with a
 *      following 'm²' / 'm2' token within ~textHeight to its right.
 *   4. Identify NAME candidates: ALL-CAPS letter tokens (apostrophes, /,
 *      digits ok) of length ≥3, joined VERTICALLY when stacked in the same
 *      column within ~2 textHeights vertical gap.
 *   5. For each AREA, choose the nearest NAME within a search radius
 *      proportional to text height. Reject pairs where (areaCenter -
 *      nameCenter) exceeds a generous bounding box (avoids cross-room
 *      assignments on dense plans).
 *
 * This is a pure function — easy to unit test against a committed fixture.
 */

export interface BboxWord {
  text: string
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

export interface BboxRoomPair {
  name: string
  area_m2: number
  nameBox: { xMin: number; yMin: number; xMax: number; yMax: number }
  areaBox: { xMin: number; yMin: number; xMax: number; yMax: number }
  distance: number
}

const AREA_RE = /^\d{1,3}\.\d{2}$/
const M2_RE = /^m(²|2)$/
const COMBINED_AREA_RE = /^(\d{1,3}\.\d{2})\s+m(²|2)$/
const NAME_TOKEN_RE = /^[A-Z][A-Z'\-/0-9 ]+$/

function yCenter(w: { yMin: number; yMax: number }): number {
  return (w.yMin + w.yMax) / 2
}
function xCenter(w: { xMin: number; xMax: number }): number {
  return (w.xMin + w.xMax) / 2
}
function textHeight(w: { yMin: number; yMax: number }): number {
  return Math.max(1, w.yMax - w.yMin)
}

interface LineCluster {
  yCenter: number
  height: number
  words: BboxWord[]
}

function clusterIntoLines(words: BboxWord[]): LineCluster[] {
  const lines: LineCluster[] = []
  const sorted = words.slice().sort((a, b) => yCenter(a) - yCenter(b))
  for (const w of sorted) {
    const h = textHeight(w)
    const yC = yCenter(w)
    const match = lines.find((l) => Math.abs(l.yCenter - yC) < 0.5 * Math.min(l.height, h))
    if (match) {
      match.words.push(w)
      // Maintain running mean.
      match.yCenter = (match.yCenter * (match.words.length - 1) + yC) / match.words.length
      match.height = Math.max(match.height, h)
    } else {
      lines.push({ yCenter: yC, height: h, words: [w] })
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.xMin - b.xMin)
  return lines
}

interface Token {
  text: string
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  height: number
}

function mergeAdjacent(line: LineCluster): Token[] {
  const tokens: Token[] = []
  for (const w of line.words) {
    if (tokens.length === 0) {
      tokens.push({ ...w, height: textHeight(w) })
      continue
    }
    const prev = tokens[tokens.length - 1]!
    const gap = w.xMin - prev.xMax
    if (gap <= prev.height) {
      prev.text = `${prev.text} ${w.text}`.trim()
      prev.xMax = w.xMax
      prev.yMin = Math.min(prev.yMin, w.yMin)
      prev.yMax = Math.max(prev.yMax, w.yMax)
      prev.height = Math.max(prev.height, textHeight(w))
    } else {
      tokens.push({ ...w, height: textHeight(w) })
    }
  }
  return tokens
}

interface NameBlock {
  text: string
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  height: number
}

function isNameToken(tok: Token): boolean {
  const t = tok.text.trim()
  if (t.length < 3) return false
  if (!NAME_TOKEN_RE.test(t)) return false
  // Reject schedule tags like 'D05', 'CW09', 'W14', 'A301'.
  if (/^(D|CW|W|A|S|M|E|P|I|ID)\d{2,3}/.test(t.replace(/\s/g, ''))) return false
  // Reject room CODES: GF-NN, FF-NN, L1-NN, etc. They look like names but
  // they're identifiers for the rooms whose REAL name is on a nearby line.
  if (/^(GF|FF|L\d|B\d|RF|M)-\d{1,3}/.test(t)) return false
  // Reject title-block / drawing-frame boilerplate.
  if (
    /^(SCALE|DRAWING|TITLE|PROJECT|DRAWN|CHECKED|APPROVED|REVISION|FFL|SHJ|LM|PROPOSED|VILLA|BOUNDARY|PLOT|MUNICIPALITY|CONSECUTIVE|ORIGINAL|SHEET|SIZE|DATE|ZONE|LEAD|ARCHITECT|OWNER|CONTRACTOR|TYPICAL|DETAILS?|SECTION|ELEVATION|GROUND|FIRST|LOWER|UPPER|LEFT|RIGHT|FRONT|REAR|LEVEL|NORTH|SOUTH|EAST|WEST)\b/.test(t)
  ) {
    return false
  }
  return true
}

/**
 * Vertically merge stacked NAME tokens that sit in the same column. The
 * second-line word inherits the first-line's xMin within ~half a textHeight
 * tolerance, and falls below within ~2 textHeights vertical gap.
 */
function joinStackedNames(tokens: Token[]): NameBlock[] {
  const blocks: NameBlock[] = tokens.filter(isNameToken).map((t) => ({
    text: t.text,
    xMin: t.xMin,
    yMin: t.yMin,
    xMax: t.xMax,
    yMax: t.yMax,
    height: t.height,
  }))
  blocks.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)
  for (let i = 0; i < blocks.length; i += 1) {
    const a = blocks[i]!
    for (let j = i + 1; j < blocks.length; j += 1) {
      const b = blocks[j]!
      const verticalGap = b.yMin - a.yMax
      const xOverlap = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin)
      // Plot 4357 frequently prints stacked words with their bbox bottoms
      // touching or slightly overlapping (gap ~= -0.2 px). Allow up to half
      // a text height of negative gap before we refuse the join.
      const allowNegative = -0.6 * a.height
      if (verticalGap >= allowNegative && verticalGap < 2.5 * a.height && xOverlap > -a.height) {
        // Merge b into a.
        a.text = `${a.text} ${b.text}`.trim()
        a.xMin = Math.min(a.xMin, b.xMin)
        a.xMax = Math.max(a.xMax, b.xMax)
        a.yMin = Math.min(a.yMin, b.yMin)
        a.yMax = Math.max(a.yMax, b.yMax)
        a.height = Math.max(a.height, b.height)
        blocks.splice(j, 1)
        j -= 1
      }
    }
  }
  return blocks
}

interface AreaBlock {
  area_m2: number
  xMin: number
  yMin: number
  xMax: number
  yMax: number
  height: number
}

function findAreaBlocks(tokens: Token[]): AreaBlock[] {
  const out: AreaBlock[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    // Case 1: token-merge collapsed "X.XX" and "m²" into one token.
    const combined = COMBINED_AREA_RE.exec(tok.text)
    if (combined) {
      const value = Number.parseFloat(combined[1]!)
      if (Number.isFinite(value) && value > 0 && value < 500) {
        out.push({
          area_m2: value,
          xMin: tok.xMin,
          yMin: tok.yMin,
          xMax: tok.xMax,
          yMax: tok.yMax,
          height: tok.height,
        })
      }
      continue
    }
    // Case 2: separate "X.XX" then "m²" tokens.
    if (!AREA_RE.test(tok.text)) continue
    const value = Number.parseFloat(tok.text)
    if (!Number.isFinite(value) || value <= 0 || value >= 500) continue
    const nxt = tokens[i + 1]
    if (!nxt) continue
    const nextIsM2 = M2_RE.test(nxt.text.trim())
    if (!nextIsM2) continue
    out.push({
      area_m2: value,
      xMin: tok.xMin,
      yMin: tok.yMin,
      xMax: nxt.xMax,
      yMax: Math.max(tok.yMax, nxt.yMax),
      height: tok.height,
    })
  }
  return out
}

function distance(name: NameBlock, area: AreaBlock): number {
  const dx = xCenter(area) - xCenter(name)
  const dy = yCenter(area) - yCenter(name)
  return Math.sqrt(dx * dx + dy * dy)
}

export function parseBboxRoomAreaPairs(bbox: { words: BboxWord[] }): BboxRoomPair[] {
  const lines = clusterIntoLines(bbox.words)
  const tokens = lines.flatMap(mergeAdjacent)
  const nameBlocks = joinStackedNames(tokens)
  const areaBlocks = findAreaBlocks(tokens)

  const pairs: BboxRoomPair[] = []
  const usedNames = new Set<NameBlock>()
  for (const area of areaBlocks) {
    let best: { name: NameBlock; dist: number } | null = null
    for (const name of nameBlocks) {
      if (usedNames.has(name)) continue
      const dist = distance(name, area)
      // Reasonable search radius. Page heights are ~1900 pts; 5× a typical
      // 10-pt text gives ~50 pts — plenty for an in-room label.
      const radius = Math.max(60, 12 * area.height)
      if (dist > radius) continue
      if (!best || dist < best.dist) best = { name, dist }
    }
    if (best) {
      usedNames.add(best.name)
      pairs.push({
        name: best.name.text.trim(),
        area_m2: area.area_m2,
        nameBox: {
          xMin: best.name.xMin,
          yMin: best.name.yMin,
          xMax: best.name.xMax,
          yMax: best.name.yMax,
        },
        areaBox: {
          xMin: area.xMin,
          yMin: area.yMin,
          xMax: area.xMax,
          yMax: area.yMax,
        },
        distance: best.dist,
      })
    }
  }
  return pairs
}
