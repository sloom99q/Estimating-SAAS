/**
 * Independent text-layer parse for door / window schedules — Sprint 4 rebuild.
 *
 * Tuned against the REAL pdftotext output of Plot 4357 pages 27 (DOOR
 * SCHEDULE, drawing A651) and 24 (GLAZING TYPES, A502). The Sprint-2/3
 * implementation assumed inline-format rows like "D01 900 2100"; real
 * schedules are tabbed/columnar with embedded counts and floor labels.
 *
 * Door layout observed on the real PDF:
 *     TAG  COUNT  Width-m  Height-m  Panel-Height-m  Description...
 *     D01   6     1.00     3.00      3.00            D01 1000 X 3000
 *     D02   4     0.90     3.00      2.70            D02 900 X 3000 ...
 *
 * Window/curtain-wall layout observed:
 *     TAG   X-dim   Y-dim   Count   Type-and-description   [Floor]
 *     CW01  3.03    4.04    1       Sliding Windows        GROUND FLOOR
 *     CW05  3.00    1.80    6       Standard Fixed
 *
 * Numbers between 0.01 and 50.0 are treated as METRES and converted to mm;
 * larger values are assumed already in mm. Tags are anchored at line start
 * (with leading whitespace allowed) to avoid catching D02 inside a description.
 */
import type { ExtractScheduleRow, ScheduleKind } from './types'

const DOOR_TAG_RE = /^\s+(D\d{2}(?:-[A-Z])?)\s/
const WINDOW_TAG_RE = /^\s+((?:CW|W)\d{2}(?:-[A-Z])?)\s/
const NUMBER_RE = /-?\d+(?:\.\d+)?/g
const FLOOR_TRAILING_RE = /\s+(GROUND FLOOR|FIRST FLOOR|ROOF|BASEMENT|MEZZANINE)\s*$/i

function metersToMm(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  // <50: assume metres, convert. >=50: assume already mm (or some other unit;
  // we still emit the number so the reconciler can see it).
  return value < 50 ? Math.round(value * 1000) : Math.round(value)
}

function looksLikeIntegerCount(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < 200
}

function parseDoorLine(line: string, tag: string): ExtractScheduleRow {
  const rest = line.slice(line.indexOf(tag) + tag.length)
  const nums = (rest.match(NUMBER_RE) ?? []).map(Number).filter((n) => !Number.isNaN(n))
  // Expected order: count, widthM, heightM, panelHeightM, [trailing description numbers]
  let count: number | null = null
  let width_mm: number | null = null
  let height_mm: number | null = null
  if (nums.length >= 1 && looksLikeIntegerCount(nums[0]!)) {
    count = nums[0]!
    width_mm = nums[1] !== undefined ? metersToMm(nums[1]) : null
    height_mm = nums[2] !== undefined ? metersToMm(nums[2]) : null
  } else if (nums.length >= 2) {
    // Schedule without a count column: fall back to first-two-as-dimensions.
    width_mm = metersToMm(nums[0]!)
    height_mm = metersToMm(nums[1]!)
  }
  return {
    tag,
    count,
    width_mm,
    height_mm,
    type: null,
    finish: null,
    remarks: null,
  }
}

function parseWindowLine(line: string, tag: string): ExtractScheduleRow {
  let working = line
  const floorMatch = FLOOR_TRAILING_RE.exec(working)
  let floor: string | null = null
  if (floorMatch) {
    floor = floorMatch[1] ?? null
    working = working.slice(0, floorMatch.index)
  }
  const rest = working.slice(working.indexOf(tag) + tag.length)
  const nums = (rest.match(NUMBER_RE) ?? []).map(Number).filter((n) => !Number.isNaN(n))
  // Expected order: widthM, heightM, count, [extras]
  let width_mm: number | null = nums[0] !== undefined ? metersToMm(nums[0]) : null
  let height_mm: number | null = nums[1] !== undefined ? metersToMm(nums[1]) : null
  let count: number | null = nums[2] !== undefined && looksLikeIntegerCount(nums[2]) ? nums[2] : null
  // Text-layer description (after the numbers).
  const descMatch = rest.match(/[a-zA-Z][a-zA-Z ]+/)
  const type = descMatch ? descMatch[0].trim() : null
  return {
    tag,
    count,
    width_mm,
    height_mm,
    type,
    finish: null,
    remarks: floor,
  }
}

function parseFromText(text: string, kind: ScheduleKind): ExtractScheduleRow[] {
  const rows: ExtractScheduleRow[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    if (kind === 'DOOR') {
      const m = DOOR_TAG_RE.exec(line)
      if (!m) continue
      const tag = m[1]!
      if (seen.has(tag)) continue
      seen.add(tag)
      rows.push(parseDoorLine(line, tag))
    } else {
      const m = WINDOW_TAG_RE.exec(line)
      if (!m) continue
      const tag = m[1]!
      if (seen.has(tag)) continue
      seen.add(tag)
      rows.push(parseWindowLine(line, tag))
    }
  }
  return rows
}

export function scheduleTextPass(textSnippet: string, kind: ScheduleKind): ExtractScheduleRow[] {
  return parseFromText(textSnippet, kind)
}
