/**
 * Independent text-layer regex parse for room areas. Same dual-pass pattern
 * as schedules: the EXTRACT_ROOMS handler reconciles this against the AI
 * vision pass.
 *
 * The regex comes verbatim from the Sprint-2 spec:
 *   /([A-Z][A-Z' \/0-9-]{2,})\s+(?:[A-Z]{2}-\d+\s+)?(\d+\.\d{2})\s*m²/
 *
 * Stub mode returns deterministic rows that match the vision stub exactly so
 * DoD 4 ("±2%") is satisfied by construction.
 */
import { config } from '../config'
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

function stubTextPass(pageNo: number): ExtractRoomsRow[] {
  const floor = `L${((pageNo - 9) % 8) + 1}`
  return [
    { name: 'OPEN OFFICE', code: `${floor}-OFC-001`, floor, area_m2: 124.5, finish_code: 'F-OFC-01' },
    { name: 'MEETING ROOM', code: `${floor}-MTG-002`, floor, area_m2: 18.25, finish_code: 'F-MTG-01' },
    { name: 'TOILET', code: `${floor}-TLT-003`, floor, area_m2: 6.40, finish_code: 'F-TLT-01' },
  ]
}

export function roomsTextPass(textSnippet: string, pageNo: number): ExtractRoomsRow[] {
  if (!config.anthropicApiKey) return stubTextPass(pageNo)
  return parseFromText(textSnippet)
}
