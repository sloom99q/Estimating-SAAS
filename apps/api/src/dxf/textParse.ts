/**
 * DXF MVP — MTEXT text helpers (pure, testable).
 *
 * AutoCAD MTEXT is plain text wrapped in formatting codes. A label
 * that visually reads "GF-04 58.82 m²" is stored as something like:
 *
 *   {\fArial|b0|i0|c0|p34;\pxqc,t0.83333,1.66667,2.5,…;GF-04 58.82 m²}
 *
 * cleanMText strips the formatting codes. parseRoomLabel + parseTagLabel
 * then regex the cleaned text into structured fields.
 *
 * The codes seen in LAMI Architects LM1929 files:
 *   - `\pxqc,t...;`          paragraph + tab-stop list
 *   - `\f<font>;`            font selector
 *   - `\P`                    paragraph break (renders as newline)
 *   - `\C<n>;` `\W<n>;`       color / width — ignore
 *   - `{` `}`                 group delimiters
 *
 * The cleaner errs on the side of removing too much; if real text gets
 * caught it's better to drop a noisy label than to ingest a malformed
 * one. Edge cases that need attention will surface in PARSE_DXF's
 * "unpaired label" emitted rows + the project flag for high
 * pair-distance variance.
 */

/** Strip MTEXT formatting codes. Returns the human-readable text. */
export function cleanMText(raw: string): string {
  if (!raw) return ''
  return raw
    // \pxqc,...;  paragraph stops
    .replace(/\\pxqc[^;]*;/g, '')
    // \f...;      font definitions
    .replace(/\\f[^;]*;/g, '')
    // \C12;  \W0.75;  \H1.5x;  \A1;  — generic single-arg formatting
    .replace(/\\[A-Za-z][0-9.x-]*;/g, '')
    // \P  paragraph break -> space
    .replace(/\\P/g, ' ')
    // Group delimiters
    .replace(/[{}]/g, '')
    // Stray leading comma-list residue from over-eager strips
    .replace(/^[\s,;]+/, '')
    // Collapse repeated whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

/** A "code + area" label: e.g. "GF-04 58.82 m²" → { code:'GF-04', areaM2:58.82 }. */
export interface CodeAreaLabel {
  kind: 'code-area'
  code: string
  areaM2: number
}

/** A "name" label: e.g. "LIVING" → { name:'LIVING' }. */
export interface NameLabel {
  kind: 'name'
  name: string
}

/** A "tag" label for doors / windows: e.g. "D01" → { tag:'D01' }. */
export interface TagLabel {
  kind: 'tag'
  tag: string
}

/** Anything else — keep the raw clean text so the operator can review. */
export interface UnknownLabel {
  kind: 'unknown'
  text: string
}

export type ParsedRoomLabel = CodeAreaLabel | NameLabel | UnknownLabel

/**
 * Room label classifier. Tries the strict `CODE areaM2` pattern first;
 * falls back to "this is a name". Numbers without a code prefix
 * (e.g. a bare "5.41 m²" with no FF-NN) are treated as unknown — the
 * design relies on the paired label format the architect uses.
 */
export function parseRoomLabel(cleanText: string): ParsedRoomLabel {
  const t = cleanText.trim()
  if (!t) return { kind: 'unknown', text: t }
  // CODE area pattern. Accepts m², m2, m^2, sqm and bare m.
  // Code must start with letters then dash then digits — guards against
  // door tags (D01 — no dash, would have been emitted as tag elsewhere).
  const m = t.match(/^([A-Z]{1,4}-\d{1,3})\s+([\d.,]+)\s*(?:m²|m2|sqm|m\^2|m)\b/i)
  if (m) {
    const code = m[1]!.toUpperCase()
    const areaM2 = Number.parseFloat(m[2]!.replace(',', '.'))
    if (!Number.isFinite(areaM2)) return { kind: 'unknown', text: t }
    return { kind: 'code-area', code, areaM2 }
  }
  // Bare names — everything that's letters/whitespace/punctuation, no
  // standalone number. Length-cap to dodge garbage.
  if (t.length <= 60 && /[A-Za-z]/.test(t)) {
    return { kind: 'name', name: t }
  }
  return { kind: 'unknown', text: t }
}

/**
 * Tag label classifier (doors / windows). Architects place the
 * schedule tag (D01 / D02 / W01 / CW-04) right next to each INSERT.
 * Matches single-token tags only; multi-word phrases fall through as
 * unknown (would be a name on the door layer, rare).
 */
export function parseTagLabel(cleanText: string): TagLabel | UnknownLabel {
  const t = cleanText.trim()
  // Examples we want to match: D01, D-02, W3, CW04, CW-10
  const m = t.match(/^([A-Z]{1,4})-?(\d{1,3})$/i)
  if (m) {
    return { kind: 'tag', tag: `${m[1]!.toUpperCase()}${m[2]}` }
  }
  return { kind: 'unknown', text: t }
}

/**
 * Nearest-neighbour pairing helper. Given two arrays of positioned
 * items, returns one (a, b, distance) per item in `as`, paired with
 * the closest item in `bs` (allowing reuse of the same `b` for
 * multiple `a`s — the caller decides whether that's OK).
 *
 * O(N×M); fine for the entity counts in real DXFs (≤ few hundred).
 */
export function pairNearest<A extends { x: number; y: number }, B extends { x: number; y: number }>(
  as: A[],
  bs: B[],
): Array<{ a: A; b: B | null; distance: number }> {
  const out: Array<{ a: A; b: B | null; distance: number }> = []
  for (const a of as) {
    let best: B | null = null
    let bestD = Infinity
    for (const b of bs) {
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    out.push({ a, b: best, distance: bestD })
  }
  return out
}
