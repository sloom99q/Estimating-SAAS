/**
 * Independent text-layer parse for door / window schedules.
 *
 * Sprint-3 A2: always runs the real regex on the real pdftotext snippet,
 * regardless of AI_MODE. The schedule handler reconciles this output against
 * the vision pass (which IS mode-switched). Dev mode is now real-text ×
 * stub-vision — a far better signal than the Sprint-2 dual-stub.
 *
 * If the regex finds nothing (the schedule sheet is a scanned image with no
 * text layer), the reconciler will just see an empty text pass and mark each
 * vision row as VISUAL conf 70 — no flag, no false ROW_MISMATCH.
 */
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

export function scheduleTextPass(textSnippet: string, kind: ScheduleKind): ExtractScheduleRow[] {
  return parseFromText(textSnippet, kind)
}
