/**
 * Independent text-layer regex parse for room areas — Sprint 4 rebuild.
 *
 * Plot 4357 lesson: rooms on plan sheets print their name and area on
 * VERTICALLY SEPARATE lines (the area is positioned below the name in the
 * drawing, which `pdftotext -layout` emits as different text-layer rows).
 * The Sprint-2 single-line regex therefore caught almost nothing live.
 *
 * Sprint 4 sliding-window heuristic:
 *   1. Walk the text line by line.
 *   2. When an AREA line matches /^\s*(\d+\.\d{2})\s*m²\s*$/, look back up
 *      to N (default 3) NON-EMPTY lines for a NAME line — an uppercase
 *      token sequence (≥3 chars), optionally preceded by a CODE line (e.g.
 *      "L1-OFC-01" or "07").
 *   3. Emit { name, code?, area_m2 }.
 *
 * Caveats:
 *   - Plan-view drawings whose labels are SPATIALLY DISTANT from areas (the
 *     pdftotext blob will have many unrelated lines between them) will be
 *     missed by this parser. Those rooms come from the vision pass, which
 *     in Sprint 4 also re-renders at 220 DPI + tiles the page (S4-3).
 *   - Finish-schedule / RCP layouts that print NAME/AREA pairs in tight
 *     vertical proximity (the spec's reference layout) ARE caught reliably.
 */
import type { ExtractRoomsRow } from './types'

const AREA_RE = /^\s*(\d+\.\d{2})\s*m²\s*$/
const NAME_RE = /^\s*([A-Z][A-Z 0-9'\-/&]{2,})\s*$/
const CODE_RE = /^\s*([A-Z0-9][A-Z0-9 \-]{1,16})\s*$/
const LOOKBACK_LINES = 3

function isAreaLine(line: string): { area: number } | null {
  const m = AREA_RE.exec(line)
  if (!m) return null
  const v = Number.parseFloat(m[1] ?? '0')
  return Number.isFinite(v) && v > 0 ? { area: v } : null
}

/**
 * Reject things that pass NAME_RE but are clearly NOT room names:
 *   - door / window / curtain-wall tags: D01, D01-A, CW09, W14
 *   - elevation marker boxes: A301, A302, A501
 *   - generic non-room words seen on schedules
 */
const NOT_A_ROOM_RE =
  /^(D\d{2}(?:-[A-Z])?|(?:CW|W)\d{2}(?:-[A-Z])?|A\d{3}|S\d{3}|M\d{3}|E\d{3}|TYPE [A-Z0-9]+|DOOR(?:S)?|WINDOW(?:S)?|TYP\.?|TBC|REF\.?|GROUND FLOOR|FIRST FLOOR|ROOF|MEZZANINE|BASEMENT)$/

function isNameLine(line: string): { name: string } | null {
  const m = NAME_RE.exec(line)
  if (!m) return null
  const name = (m[1] ?? '').trim()
  if (/^[0-9 ]+$/.test(name)) return null
  if (name.length < 3) return null
  if (NOT_A_ROOM_RE.test(name)) return null
  return { name }
}

function isCodeLine(line: string): { code: string } | null {
  const m = CODE_RE.exec(line)
  if (!m) return null
  const code = (m[1] ?? '').trim()
  // Distinguish from a name: codes are mostly alphanumeric with hyphens, < 12 chars.
  if (code.length > 12) return null
  if (!/-|\d/.test(code)) return null
  return { code }
}

export function roomsTextPass(textSnippet: string, _pageNo: number): ExtractRoomsRow[] {
  const lines = textSnippet.split('\n')
  const seen = new Set<string>()
  const rows: ExtractRoomsRow[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i] ?? ''
    const area = isAreaLine(lineText)
    if (!area) continue

    // Walk backwards across LOOKBACK_LINES non-empty lines. Collect first
    // matching NAME and first matching CODE — order can be either
    // (CODE→NAME→AREA or NAME→CODE→AREA), and we want both when present.
    let name: string | null = null
    let code: string | null = null
    let nonEmptySeen = 0
    for (let j = i - 1; j >= 0 && nonEmptySeen < LOOKBACK_LINES; j -= 1) {
      const t = lines[j] ?? ''
      if (t.trim().length === 0) continue
      nonEmptySeen += 1
      const nameHit = isNameLine(t)
      if (nameHit && !name) name = nameHit.name
      const codeHit = isCodeLine(t)
      if (codeHit && !code) code = codeHit.code
      if (name && code) break
    }
    if (!name) continue

    const key = `${name}|${(code ?? '').toUpperCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      name,
      code,
      floor: null,
      area_m2: area.area,
      finish_code: null,
    })
  }
  return rows
}
