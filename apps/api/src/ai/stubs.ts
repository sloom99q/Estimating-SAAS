/**
 * Deterministic stubs returned by the Anthropic client when
 * ANTHROPIC_API_KEY is empty.
 *
 * Purpose: prove the pipeline wiring end-to-end without spending tokens or
 * needing internet. Outputs are HAND-DESIGNED to exercise every downstream
 * code path the architect's DoD requires:
 *
 *   • CLASSIFY produces ARCH or ID disciplines only — no STR, no MEP.
 *     The CLASSIFY handler's MISSING_DISCIPLINE flag fires (DoD 2).
 *
 *   • CLASSIFY assigns at least one `schedule` sheet and at least one
 *     `plan` / `finish_plan` sheet, so both extractors get inputs.
 *
 *   • EXTRACT_SCHEDULES returns two passes (vision + text-layer-equivalent).
 *     The two passes agree on every row EXCEPT one deliberate mismatch on
 *     window tag "CW09" — the dual-pass reconciler raises ROW_MISMATCH
 *     (DoD 3). This mirrors the Plot 4357 pilot finding.
 *
 *   • EXTRACT_ROOMS returns rooms with areas that match the text-layer regex
 *     parse exactly, so DoD 4's "±2%" check is satisfied by construction.
 *
 * Keep these outputs stable: the acceptance script asserts on them.
 */
import type {
  ClassifyInput,
  ClassifyOutput,
  ExtractRoomsInput,
  ExtractRoomsOutput,
  ExtractScheduleInput,
  ExtractScheduleOutput,
  SheetType,
} from './types'
import { CLASSIFY_PROMPT_VERSION } from './prompts/classify.v1'
import { EXTRACT_DOORS_PROMPT_VERSION } from './prompts/extractDoors.v1'
import { EXTRACT_WINDOWS_PROMPT_VERSION } from './prompts/extractWindows.v1'
import { EXTRACT_ROOMS_PROMPT_VERSION } from './prompts/extractRooms.v1'

/**
 * Hard-coded classification map by pageNo. Built to cover the categories
 * EXTRACT_* expects. Pages outside the range fall back to ARCH / other.
 */
function classifyByPageNo(pageNo: number): {
  drawingNo: string
  title: string
  discipline: 'ARCH' | 'ID'
  sheetType: SheetType
  scale: string | null
  floor: string | null
} {
  if (pageNo === 1) {
    return {
      drawingNo: 'A-000',
      title: 'Cover',
      discipline: 'ARCH',
      sheetType: 'cover',
      scale: null,
      floor: null,
    }
  }
  if (pageNo === 2) {
    return {
      drawingNo: 'IDR-000',
      title: 'Drawing Register',
      discipline: 'ID',
      sheetType: 'register',
      scale: null,
      floor: null,
    }
  }
  if (pageNo >= 3 && pageNo <= 8) {
    return {
      drawingNo: `A-1${String(pageNo - 2).padStart(2, '0')}`,
      title: `Plan — Level ${pageNo - 2}`,
      discipline: 'ARCH',
      sheetType: 'plan',
      scale: '1:100',
      floor: `L${pageNo - 2}`,
    }
  }
  if (pageNo >= 9 && pageNo <= 16) {
    return {
      drawingNo: `ID-2${String(pageNo - 8).padStart(2, '0')}`,
      title: `Finish Plan — Level ${pageNo - 8}`,
      discipline: 'ID',
      sheetType: 'finish_plan',
      scale: '1:100',
      floor: `L${pageNo - 8}`,
    }
  }
  if (pageNo >= 17 && pageNo <= 22) {
    return {
      drawingNo: `A-3${String(pageNo - 16).padStart(2, '0')}`,
      title: `Elevation ${pageNo - 16}`,
      discipline: 'ARCH',
      sheetType: 'elevation',
      scale: '1:50',
      floor: null,
    }
  }
  if (pageNo >= 23 && pageNo <= 28) {
    return {
      drawingNo: `A-4${String(pageNo - 22).padStart(2, '0')}`,
      title: `Section ${pageNo - 22}`,
      discipline: 'ARCH',
      sheetType: 'section',
      scale: '1:50',
      floor: null,
    }
  }
  if (pageNo === 29) {
    return {
      drawingNo: 'ID-DSCH-01',
      title: 'Door Schedule',
      discipline: 'ID',
      sheetType: 'schedule',
      scale: null,
      floor: null,
    }
  }
  if (pageNo === 30) {
    return {
      drawingNo: 'ID-WSCH-01',
      title: 'Window Schedule',
      discipline: 'ID',
      sheetType: 'schedule',
      scale: null,
      floor: null,
    }
  }
  if (pageNo >= 31 && pageNo <= 32) {
    return {
      drawingNo: `ID-LEG-${String(pageNo - 30).padStart(2, '0')}`,
      title: `Finish Legend ${pageNo - 30}`,
      discipline: 'ID',
      sheetType: 'legend',
      scale: null,
      floor: null,
    }
  }
  // Tail — details/rcp/other. ARCH all the way; intentionally NO STR or MEP.
  const fallbacks: SheetType[] = ['detail', 'rcp', 'detail', 'other']
  const sheetType = fallbacks[(pageNo - 33) % fallbacks.length] ?? 'other'
  return {
    drawingNo: `A-5${String(pageNo).padStart(2, '0')}`,
    title: `Detail ${pageNo}`,
    discipline: 'ARCH',
    sheetType,
    scale: '1:20',
    floor: null,
  }
}

export function stubClassify(input: ClassifyInput): ClassifyOutput {
  const c = classifyByPageNo(input.pageNo)
  return {
    drawing_no: c.drawingNo,
    title: c.title,
    discipline: c.discipline,
    sheet_type: c.sheetType,
    scale: c.scale,
    floor: c.floor,
    confidence: 92,
    tokensIn: 320,
    tokensOut: 80,
    promptVersion: CLASSIFY_PROMPT_VERSION,
  }
}

/**
 * Two passes returned in sequence: the vision pass matches the text-layer
 * pass on every row EXCEPT one deliberate disagreement so the dual-pass
 * reconciler raises ROW_MISMATCH (DoD 3). Pilot lesson: CW09↔CW10 swap.
 */
export function stubExtractSchedule(input: ExtractScheduleInput): ExtractScheduleOutput {
  if (input.kind === 'DOOR') {
    return {
      kind: 'DOOR',
      rows: [
        { tag: 'D01-A', width_mm: 900, height_mm: 2100, type: 'Single Swing', finish: 'Veneer', remarks: null },
        // Plot 4357 lesson: same tag, different finish ⇒ separate rows.
        { tag: 'D01-B', width_mm: 900, height_mm: 2100, type: 'Single Swing', finish: 'Paint', remarks: null },
        { tag: 'D02', width_mm: 1800, height_mm: 2100, type: 'Double Swing', finish: 'Veneer', remarks: 'Glazed' },
        { tag: 'D03', width_mm: 900, height_mm: 2100, type: 'Single Sliding', finish: 'Glass', remarks: null },
      ],
      tokensIn: 1100,
      tokensOut: 350,
      promptVersion: EXTRACT_DOORS_PROMPT_VERSION,
    }
  }
  // Window/curtain-wall schedule. Note CW09 width: vision reads 2400, text
  // layer reads 2350 — the dual-pass reconciler flags this as ROW_MISMATCH.
  return {
    kind: 'WINDOW',
    rows: [
      { tag: 'CW02', width_mm: 1800, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: null },
      { tag: 'CW09', width_mm: 2400, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: 'Corner unit' },
      { tag: 'CW10', width_mm: 2100, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: null },
      { tag: 'CW11', width_mm: 1800, height_mm: 2700, type: 'Curtain Wall', finish: 'Aluminium', remarks: null },
    ],
    tokensIn: 1150,
    tokensOut: 360,
    promptVersion: EXTRACT_WINDOWS_PROMPT_VERSION,
  }
}

/**
 * Vision-pass rooms for a single finish_plan / plan sheet. Designed so the
 * areas EXACTLY match the values the room handler's regex finds in the
 * synthetic text snippet (see EXTRACT_ROOMS handler) — DoD 4 satisfied by
 * construction.
 */
export function stubExtractRooms(input: ExtractRoomsInput): ExtractRoomsOutput {
  // We seed three rooms per sheet so the takeoff table has visible content
  // without overwhelming it.
  const floor = `L${((input.pageNo - 9) % 8) + 1}`
  return {
    rows: [
      { name: 'OPEN OFFICE', code: `${floor}-OFC-001`, floor, area_m2: 124.5, finish_code: 'F-OFC-01' },
      { name: 'MEETING ROOM', code: `${floor}-MTG-002`, floor, area_m2: 18.25, finish_code: 'F-MTG-01' },
      { name: 'TOILET', code: `${floor}-TLT-003`, floor, area_m2: 6.40, finish_code: 'F-TLT-01' },
    ],
    tokensIn: 980,
    tokensOut: 280,
    promptVersion: EXTRACT_ROOMS_PROMPT_VERSION,
  }
}
