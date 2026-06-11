/**
 * Independent text-layer parse for door / window schedules. Runs WITHOUT the
 * AI, using only regex on the per-page text snippet pdftotext produced at
 * INGEST. The schedules handler reconciles this output against the vision
 * pass — disagreement raises a ROW_MISMATCH ValidationFlag.
 *
 * Stub mode (ANTHROPIC_API_KEY empty) substitutes a hand-designed text-pass
 * that deliberately disagrees with the vision stub on ONE row (CW09 width)
 * — the Plot 4357 lesson made manifest.
 */
import { config } from '../config'
import type { ExtractScheduleRow, ScheduleKind } from './types'

const DOOR_RE = /(D\d{2}(?:-[A-Z])?)\s+(\d{3,4})\s+(\d{3,4})/g
const WINDOW_RE = /(CW\d{2}(?:-[A-Z])?|W\d{2}(?:-[A-Z])?)\s+(\d{3,4})\s+(\d{3,4})/g

function parseFromText(text: string, kind: ScheduleKind): ExtractScheduleRow[] {
  const re = kind === 'DOOR' ? DOOR_RE : WINDOW_RE
  const rows: ExtractScheduleRow[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  re.lastIndex = 0
  while ((match = re.exec(text)) !== null) {
    const [, tag, widthStr, heightStr] = match
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    rows.push({
      tag,
      width_mm: Number.parseInt(widthStr ?? '0', 10) || null,
      height_mm: Number.parseInt(heightStr ?? '0', 10) || null,
      type: null,
      finish: null,
      remarks: null,
    })
  }
  return rows
}

/**
 * Stub text-pass for DoD 3. Matches the vision stub row-for-row EXCEPT for
 * one deliberate width disagreement on `CW09` — the Plot 4357 lesson made
 * manifest. The schedules reconciler MUST raise a ROW_MISMATCH flag on this
 * row when the pipeline runs against this stub.
 */
function stubTextPass(kind: ScheduleKind): ExtractScheduleRow[] {
  if (kind === 'DOOR') {
    // Identical to the vision stub.
    return [
      { tag: 'D01-A', width_mm: 900, height_mm: 2100, type: 'Single Swing', finish: 'Veneer', remarks: null },
      { tag: 'D01-B', width_mm: 900, height_mm: 2100, type: 'Single Swing', finish: 'Paint', remarks: null },
      { tag: 'D02', width_mm: 1800, height_mm: 2100, type: 'Double Swing', finish: 'Veneer', remarks: 'Glazed' },
      { tag: 'D03', width_mm: 900, height_mm: 2100, type: 'Single Sliding', finish: 'Glass', remarks: null },
    ]
  }
  // WINDOW — note CW09 width is 2350 here vs the vision stub's 2400.
  return [
    { tag: 'CW02', width_mm: 1800, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: null },
    { tag: 'CW09', width_mm: 2350, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: 'Corner unit' },
    { tag: 'CW10', width_mm: 2100, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: null },
    { tag: 'CW11', width_mm: 1800, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: null },
  ]
}

export function scheduleTextPass(textSnippet: string, kind: ScheduleKind): ExtractScheduleRow[] {
  if (!config.anthropicApiKey) return stubTextPass(kind)
  return parseFromText(textSnippet, kind)
}
