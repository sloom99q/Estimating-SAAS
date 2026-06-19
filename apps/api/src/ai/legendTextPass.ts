/**
 * Sprint-8 S8-1 — text-layer-first legend extraction.
 *
 * Per ADR-016: vector PDFs with hasTextLayer carry the codes already; we no
 * longer pay vision tokens to read them. The pdftotext -layout output of
 * I4xx finish-plan sheets prints each code (ST01, PR03, WD01, FN04, LS02
 * etc.) as a standalone token, with the human-readable name on the line
 * just above, the printed description on the same line a few columns to
 * the right of the code, and optional finish/size details on the line just
 * below. The BATHROOM sentinel appears as "BATHROOM FINISHES (As per
 * Bathroom Drawings)".
 *
 * This pass returns the set of codes the text layer guarantees plus
 * proximity-based name/description heuristics. Vision still runs as an
 * enricher (description copy, missing fields) but the *code set* itself is
 * deterministic and $0.
 */

/** Whole-token legend code: two uppercase letters + two digits, e.g. ST01. */
export const LEGEND_CODE_TOKEN_RE = /\b([A-Z]{2}\d{2})\b/g
/** Same shape, used for whole-token validation. */
export const LEGEND_CODE_STRICT_RE = /^[A-Z]{2}\d{2}$/
/** BATHROOM sentinel — finish plans reference the bathroom drawings via this. */
export const BATHROOM_SENTINEL_RE = /\bBATHROOM\s+FINISHES\b/i

const NOISE_TOKENS = new Set([
  'I401',
  'I402',
  'I403',
  'I404',
  'A101',
  'A102',
  'A103',
  'A301',
  'A302',
  'A401',
  'A741',
])

export interface LegendTextRow {
  code: string
  name: string | null
  description: string | null
  detail: string | null
  /** Line numbers (1-based) inside the source text for debugging. */
  lineNo: number
  provenance: 'text-layer'
}

export interface LegendTextPassResult {
  rows: LegendTextRow[]
  bathroomSentinelSeen: boolean
}

interface Line {
  no: number
  text: string
}

function previousNonBlank(lines: Line[], from: number, max = 3): Line | null {
  for (let i = from - 1; i >= Math.max(0, from - max - 1); i--) {
    const candidate = lines[i]
    if (candidate && candidate.text.trim().length > 0) return candidate
  }
  return null
}

function nextNonBlank(lines: Line[], from: number, max = 3): Line | null {
  for (let i = from + 1; i < Math.min(lines.length, from + max + 2); i++) {
    const candidate = lines[i]
    if (candidate && candidate.text.trim().length > 0) return candidate
  }
  return null
}

/**
 * In `pdftotext -layout` output a line often glues together text from two
 * different page columns separated by giant runs of spaces. The legend
 * row's name / description are the segment that contains the code; the
 * other segments are noise from elsewhere on the page. Pick the segment
 * that includes the code and trim it.
 */
function segmentForCode(lineText: string, code: string): string {
  const segments = lineText.split(/\s{6,}/).map((s) => s.trim()).filter(Boolean)
  for (const seg of segments) {
    if (seg.includes(code)) return seg
  }
  return lineText.trim()
}

/**
 * Segments that look like room-area annotations bleeding in from an
 * adjacent column on a finish-plan sheet. The cold-upload dump showed
 * "LS01 — 19.04 m² PLAY SAND" because `descriptionFromLine` greedily
 * absorbed the m² value sitting two columns to the right of the LS01
 * token. These never belong in a legend description.
 *
 * Also reject pure-number segments and floor labels (GROUND FLOOR,
 * FIRST FLOOR, etc.) and pdf-frame keywords (DRAWING, SCALE).
 */
const LEGEND_DESC_NOISE_PATTERNS: RegExp[] = [
  // Room area annotations: "19.04 m²", "19.04 m2", "19.04 m", "19.04"
  // bleeding in from an adjacent column. `\b` after `²` doesn't match
  // because `²` is not a word char — use `\s*$` so the segment must be
  // *only* the area annotation.
  /^\s*-?\d+(\.\d+)?\s*m[²2]?\s*$/i,
  // Floor labels printed as standalone column entries.
  /^\s*(ground|first|second|third|roof|basement|mezzanine)\s*(floor)?\s*$/i,
  // PDF title-block / drawing-frame keywords used as column headers.
  /^\s*(drawing|scale|sheet|revision|project)\b/i,
]

function isLegendDescriptionSegment(s: string): boolean {
  const trimmed = s.trim()
  if (trimmed.length === 0) return false
  for (const re of LEGEND_DESC_NOISE_PATTERNS) {
    if (re.test(trimmed)) return false
  }
  return true
}

/**
 * Collect every text segment on the line that sits to the RIGHT of the code,
 * in column order. The legend layout typically prints the code in a left
 * column and the description in a far-right column, separated by ~20 spaces
 * — `segmentForCode` returns just the code, missing the description that
 * sits in a sibling segment. This helper recovers it.
 *
 * P5/P6 — area-annotation segments (e.g. "19.04 m²") are dropped before
 * the right-of-code segments are joined, so they don't leak into the
 * legend description. Without this, the color-mapper's palette token
 * lookup still works (it keys on the literal "ST01"/"LS01" word), but
 * the SPA-visible legend row + downstream BOQ descriptions ended up
 * carrying junk like "LS01 — 19.04 m² PLAY SAND".
 */
function descriptionFromLine(lineText: string, code: string): string | null {
  const segments = lineText.split(/\s{6,}/).map((s) => s.trim()).filter(Boolean)
  const codeIdx = segments.findIndex((s) => s.includes(code))
  if (codeIdx < 0) return null
  const codeSeg = segments[codeIdx]!
  const rawInline = codeSeg.slice(codeSeg.indexOf(code) + code.length).trim()
  const inline = isLegendDescriptionSegment(rawInline) ? rawInline : ''
  const rest = segments
    .slice(codeIdx + 1)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !LEGEND_CODE_STRICT_RE.test(s))
    .filter(isLegendDescriptionSegment)
    .join(' ')
  const joined = [inline, rest].filter(Boolean).join(' ').trim()
  return joined.length > 0 ? joined : null
}

/** A line is a "name" line for a code if it's mostly uppercase letters. */
function looksLikeNameLine(s: string): boolean {
  const trimmed = s.replace(/[^A-Za-z]/g, '')
  if (trimmed.length < 3) return false
  const upper = trimmed.replace(/[^A-Z]/g, '')
  return upper.length / trimmed.length >= 0.7
}

/** A line is a "detail" line if it has mixed case or contains size/finish keywords. */
function looksLikeDetailLine(s: string): boolean {
  if (/\d+\s*x\s*\d+/.test(s)) return true
  if (/honed|polish|matt|natural|finish|size|colour|color|gloss/i.test(s)) return true
  return false
}

export function parseLegendTextLayer(text: string): LegendTextPassResult {
  const lines: Line[] = text.split(/\r?\n/).map((t, i) => ({ no: i + 1, text: t }))
  const seenCodes = new Set<string>()
  const rows: LegendTextRow[] = []
  let bathroomSentinelSeen = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.text.trim()) continue

    if (BATHROOM_SENTINEL_RE.test(line.text)) {
      bathroomSentinelSeen = true
      if (!seenCodes.has('BATHROOM')) {
        seenCodes.add('BATHROOM')
        rows.push({
          code: 'BATHROOM',
          name: 'BATHROOM FINISHES',
          description: 'As per Bathroom Drawings',
          detail: null,
          lineNo: line.no,
          provenance: 'text-layer',
        })
      }
    }

    LEGEND_CODE_TOKEN_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LEGEND_CODE_TOKEN_RE.exec(line.text)) !== null) {
      const code = match[1]!
      if (!LEGEND_CODE_STRICT_RE.test(code)) continue
      if (NOISE_TOKENS.has(code)) continue
      if (seenCodes.has(code)) continue
      seenCodes.add(code)

      const description = descriptionFromLine(line.text, code)

      const above = previousNonBlank(lines, i)
      const below = nextNonBlank(lines, i)

      const aboveSeg = above ? segmentForCode(above.text, code).trim() : null
      const belowSeg = below ? segmentForCode(below.text, code).trim() : null

      const name =
        aboveSeg && looksLikeNameLine(aboveSeg) && isLegendDescriptionSegment(aboveSeg)
          ? aboveSeg
          : null
      const detail = belowSeg && looksLikeDetailLine(belowSeg) ? belowSeg : null

      rows.push({
        code,
        name,
        description,
        detail,
        lineNo: line.no,
        provenance: 'text-layer',
      })
    }
  }

  return { rows, bathroomSentinelSeen }
}
