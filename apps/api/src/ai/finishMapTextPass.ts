/**
 * Sprint-8 S8-3 — text-spatial room↔legend-code pairing.
 *
 * On the I4xx finish-plan sheets the architect's text-layer is laid out as:
 *
 *     ...NAME of the room (e.g. "LIVING")
 *     GF-04
 *     58.82 m²
 *     ...callout text incl. legend code (e.g. "ST01" or hash to a sample)
 *
 * For S7-3 we stored a 600-char text slice per ROOM and the remap function
 * scanned it for legend code substrings. That worked when the slice happened
 * to span a code, but it depended on the per-room slicing heuristic. The
 * cleaner solution: do the room↔code pairing at the *sheet* level, where we
 * can see every room/label and every code on the sheet, then write the
 * resulting Map back as enriched per-room meta. Vision is no longer the
 * source of truth for finish code on vector documents.
 *
 * This module is text-only and $0. The pairing rule is line-distance to the
 * nearest in-vocabulary code. Within a small N-line window above and below
 * the room-name line we look for a single bare token matching the legend
 * regex (or the BATHROOM sentinel). If one is found and unambiguous, the
 * room is mapped. Ambiguous rooms remain null and the existing FINISH_UNMAPPED
 * flow surfaces them for review.
 */

import { LEGEND_CODE_STRICT_RE } from './legendTextPass'

const DEFAULT_RADIUS_LINES = 6

export interface FinishMapResult {
  /** Room name (UPPER-cased, whitespace-collapsed) → legend code. */
  byRoom: Map<string, string>
  /** Rooms the parser saw but couldn't unambiguously map. */
  ambiguous: string[]
  /** Total room-name hits the parser found in the input text. */
  roomHits: number
}

function normalize(s: string): string {
  return s
    .toUpperCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findCodeInLine(line: string, vocab: Set<string>): string | null {
  const tokens = line.split(/\s+/).filter(Boolean)
  const hits = new Set<string>()
  for (const raw of tokens) {
    const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (vocab.has(t)) hits.add(t)
  }
  if (hits.size === 1) return [...hits][0]!
  return null
}

export function mapFinishCodesByText(
  finishPlanText: string,
  roomNames: string[],
  legendCodes: string[],
  opts: { radiusLines?: number } = {},
): FinishMapResult {
  const radius = opts.radiusLines ?? DEFAULT_RADIUS_LINES
  const vocab = new Set<string>(legendCodes.map((c) => c.toUpperCase()).filter((c) => LEGEND_CODE_STRICT_RE.test(c) || c === 'BATHROOM'))
  const normalizedRoomNames = roomNames.map((n) => normalize(n)).filter((s) => s.length >= 3)
  const namesSet = new Set(normalizedRoomNames)

  const lines = finishPlanText.split(/\r?\n/)
  const lineNormalized = lines.map((l) => normalize(l))

  const byRoom = new Map<string, string>()
  const ambiguous = new Set<string>()
  let roomHits = 0

  for (let i = 0; i < lines.length; i++) {
    const normLine = lineNormalized[i]!
    // For each room name that appears anywhere on this line, pair it with
    // the nearest code within ±radius lines.
    for (const name of namesSet) {
      // Use a word-boundary-ish containment check; pdftotext output gives us
      // single uppercase strings so substring is enough once both are
      // normalised.
      if (!normLine.includes(name)) continue
      roomHits += 1
      let best: { code: string; distance: number } | null = null
      const lo = Math.max(0, i - radius)
      const hi = Math.min(lines.length - 1, i + radius)
      for (let j = lo; j <= hi; j++) {
        if (j === i) continue
        const code = findCodeInLine(lines[j]!, vocab)
        if (!code) continue
        const distance = Math.abs(j - i)
        if (!best || distance < best.distance) {
          best = { code, distance }
        }
      }
      if (!best) continue
      const existing = byRoom.get(name)
      if (existing && existing !== best.code) {
        ambiguous.add(name)
        byRoom.delete(name)
      } else if (!ambiguous.has(name)) {
        byRoom.set(name, best.code)
      }
    }
  }

  return { byRoom, ambiguous: [...ambiguous], roomHits }
}
