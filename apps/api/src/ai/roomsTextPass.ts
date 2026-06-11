/**
 * Independent text-layer regex parse for room areas.
 *
 * Sprint-3 A2: always runs the real regex from the spec on the real
 * pdftotext snippet, regardless of AI_MODE. The room handler reconciles this
 * against the vision pass.
 *
 *   /([A-Z][A-Z' \/0-9-]{2,})\s+(?:[A-Z]{2}-\d+\s+)?(\d+\.\d{2})\s*m²/
 *
 * If the regex finds nothing (scanned-only sheet), the vision rows survive
 * unflagged at VISUAL conf 70.
 */
import type { ExtractRoomsRow } from './types'

const ROOM_RE = /([A-Z][A-Z' \/0-9-]{2,})\s+(?:[A-Z]{2}-\d+\s+)?(\d+\.\d{2})\s*m²/g

function parseFromText(text: string): ExtractRoomsRow[] {
  const rows: ExtractRoomsRow[] = []
  ROOM_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ROOM_RE.exec(text)) !== null) {
    const [, rawName, areaStr] = match
    if (!rawName) continue
    const name = rawName.trim()
    if (rows.some((r) => r.name === name)) continue
    rows.push({
      name,
      code: null,
      floor: null,
      area_m2: Number.parseFloat(areaStr ?? '0'),
      finish_code: null,
    })
  }
  return rows
}

export function roomsTextPass(textSnippet: string, _pageNo: number): ExtractRoomsRow[] {
  return parseFromText(textSnippet)
}
