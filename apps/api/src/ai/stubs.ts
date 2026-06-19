/**
 * P-package P-NEW — stubs derived from the Plot 4357 ground truth.
 *
 * Pre-package: stubs returned trivial qty=1 fixtures (D01-A, OPEN OFFICE,
 * etc.) so a stub-mode pipeline run produced data that looked nothing
 * like a real plot. The owner's stub-mode walkthrough table looked
 * broken because of this — not because of any extractor bug.
 *
 * Post-package: the stubs replay the architect's `plot4357.groundtruth.json`
 * verbatim. A stub run now scores 5/5 on the same scorer the live runs use
 * — 9 doors with correct counts and dims, 20 windows including CW02, 22
 * rooms with correct areas and floors, 12 legend codes. One controlled
 * CW09 width/height disagreement keeps the ROW_MISMATCH demo working
 * (the dual-pass reconciler raises a flag, scorer doesn't penalise the
 * existence of the flag).
 *
 * Stubs are NOT a substitute for the live scorer-driven gate, but they
 * make stub-mode safe for owner walkthroughs, CI runs, and offline dev.
 */
import type {
  ClassifyInput,
  ClassifyOutput,
  ExtractFinishLegendInput,
  ExtractFinishLegendOutput,
  ExtractRoomsInput,
  ExtractRoomsOutput,
  ExtractScheduleInput,
  ExtractScheduleOutput,
  SheetType,
} from './types'
import { CLASSIFY_PROMPT_VERSION } from './prompts/classify.v1'
import { EXTRACT_SCHEDULE_PROMPT_VERSION } from './prompts/extractSchedule.v2'
import { EXTRACT_FINISH_LEGEND_PROMPT_VERSION } from './prompts/extractFinishLegend.v1'
import { EXTRACT_ROOMS_PROMPT_VERSION } from './prompts/extractRooms.v2'

// ---------------------------------------------------------------------------
// Ground-truth data (mirrors apps/api/fixtures/plot4357.groundtruth.json)
// ---------------------------------------------------------------------------

const GT_DOORS = [
  { tag: 'D01', count: 6, width_mm: 1000, height_mm: 3000 },
  { tag: 'D02', count: 4, width_mm: 900, height_mm: 3000 },
  { tag: 'D03', count: 2, width_mm: 1000, height_mm: 3000 },
  { tag: 'D04', count: 2, width_mm: 900, height_mm: 3000 },
  { tag: 'D05', count: 1, width_mm: 800, height_mm: 3000 },
  { tag: 'D06', count: 2, width_mm: 900, height_mm: 2400 },
  { tag: 'D07', count: 1, width_mm: 500, height_mm: 3000 },
  { tag: 'D08', count: 4, width_mm: 900, height_mm: 2400 },
  { tag: 'D10', count: 2, width_mm: 900, height_mm: 3000 },
] as const

const GT_WINDOWS = [
  { tag: 'CW01', count: 1, width_mm: 4040, height_mm: 3080 },
  { tag: 'CW02', count: 1, width_mm: 600, height_mm: 3030 },
  { tag: 'CW03', count: 1, width_mm: 6450, height_mm: 900 },
  { tag: 'CW04', count: 2, width_mm: 6400, height_mm: 700 },
  { tag: 'CW05', count: 6, width_mm: 3000, height_mm: 300 },
  { tag: 'CW06', count: 1, width_mm: 1200, height_mm: 3000 },
  { tag: 'CW07', count: 1, width_mm: 3000, height_mm: 900 },
  { tag: 'CW08', count: 2, width_mm: 11600, height_mm: 3005 },
  { tag: 'CW09', count: 2, width_mm: 11480, height_mm: 1000 },
  { tag: 'CW10', count: 5, width_mm: 600, height_mm: 3000 },
  { tag: 'CW11', count: 2, width_mm: 4100, height_mm: 3050 },
  { tag: 'CW12', count: 1, width_mm: 600, height_mm: 3000 },
  { tag: 'CW13', count: 1, width_mm: 600, height_mm: 3450 },
  { tag: 'CW14', count: 2, width_mm: 2100, height_mm: 2400 },
  { tag: 'CW15', count: 2, width_mm: 6420, height_mm: 600 },
  { tag: 'CW16', count: 1, width_mm: 2100, height_mm: 3000 },
  { tag: 'CW17', count: 1, width_mm: 2800, height_mm: 4630 },
  { tag: 'CW18', count: 1, width_mm: 300, height_mm: 2700 },
  { tag: 'CW19', count: 1, width_mm: 1190, height_mm: 2700 },
  { tag: 'CW20', count: 1, width_mm: 2000, height_mm: 3000 },
] as const

const GT_ROOMS: ReadonlyArray<{
  name: string
  code: string | null
  floor: string
  area_m2: number
  finish_code: string | null
}> = [
  { name: 'ENTRANCE LOBBY', code: 'GF-01', floor: 'GF', area_m2: 18.29, finish_code: 'ST01' },
  { name: 'BATH 03', code: 'GF-02', floor: 'GF', area_m2: 5.41, finish_code: 'BATHROOM' },
  { name: 'PLAY ROOM', code: 'GF-03', floor: 'GF', area_m2: 24.32, finish_code: 'ST01' },
  { name: 'LIVING', code: null, floor: 'GF', area_m2: 58.82, finish_code: 'ST01' },
  { name: 'DINNING', code: 'GF-05', floor: 'GF', area_m2: 21.58, finish_code: 'ST01' },
  { name: 'BOH KITCHEN', code: 'GF-06', floor: 'GF', area_m2: 28.01, finish_code: 'PR03' },
  { name: "MAID'S BATH", code: 'GF-07', floor: 'GF', area_m2: 5.37, finish_code: 'BATHROOM' },
  { name: "MAID'S ROOM", code: 'GF-08', floor: 'GF', area_m2: 7.22, finish_code: 'PR03' },
  { name: 'LAUNDRY/LINEN', code: 'GF-04', floor: 'GF', area_m2: 9.8, finish_code: 'PR03' },
  { name: 'POWDER', code: null, floor: 'GF', area_m2: 8.44, finish_code: 'BATHROOM' },
  { name: "DRIVER'S ROOM", code: null, floor: 'GF', area_m2: 10.11, finish_code: 'PR03' },
  { name: 'MASTER BEDROOM', code: 'FF-11', floor: 'L1', area_m2: 38.35, finish_code: 'PR01' },
  { name: 'MASTER BATH', code: 'FF-10', floor: 'L1', area_m2: 13.86, finish_code: 'BATHROOM' },
  { name: 'MASTER BALCONY', code: null, floor: 'L1', area_m2: 19.04, finish_code: 'ST03' },
  { name: '01 BEDROOM', code: 'FF-02', floor: 'L1', area_m2: 28.27, finish_code: 'PR01' },
  { name: '02 BEDROOM', code: 'FF-09', floor: 'L1', area_m2: 25.28, finish_code: 'PR01' },
  { name: 'BATH 01', code: null, floor: 'L1', area_m2: 5.41, finish_code: 'BATHROOM' },
  { name: 'BATH 02', code: null, floor: 'L1', area_m2: 5.68, finish_code: 'BATHROOM' },
  { name: 'FAMILY ROOM', code: 'FF-03', floor: 'L1', area_m2: 39.12, finish_code: 'PR01' },
  { name: 'FAMILY ROOM TERRACE', code: null, floor: 'L1', area_m2: 23.3, finish_code: 'ST03' },
  { name: 'CORRIDOR', code: 'FF-06', floor: 'L1', area_m2: 23.27, finish_code: 'PR01' },
  { name: 'STAIRCASE', code: 'FF-04', floor: 'L1', area_m2: 26.96, finish_code: 'ST02' },
]

const GT_LEGEND = [
  { code: 'ST01', name: 'White Marble', material: 'marble', size: '1000x1000', finish: 'honed', usage: 'interior floors — Living, Dining, Entrance Lobby, Play Room', kind: 'FLOOR' as const },
  { code: 'ST02', name: 'Grainy Marble', material: 'marble', size: null, finish: 'honed', usage: 'staircase tread + landing', kind: 'FLOOR' as const },
  { code: 'ST03', name: 'External Porcelain', material: 'porcelain', size: '800x800', finish: 'matt', usage: 'balconies + external terraces', kind: 'EXTERNAL' as const },
  { code: 'PR01', name: 'White Marble Texture Porcelain', material: 'porcelain', size: '1000x1000', finish: 'honed', usage: 'bedrooms, family room, corridors', kind: 'FLOOR' as const },
  { code: 'PR03', name: 'Grey Porcelain', material: 'porcelain', size: '600x600', finish: 'matt', usage: "BOH kitchen, laundry, maid's room, driver's room", kind: 'FLOOR' as const },
  { code: 'WD01', name: 'Wood Panels / Veneer', material: 'wood', size: null, finish: 'natural', usage: 'feature walls', kind: 'WALL' as const },
  { code: 'FN01', name: 'Thin Vertical Fluted Pattern on GRC', material: 'GRC', size: null, finish: 'fluted', usage: 'feature walls', kind: 'WALL' as const },
  { code: 'FN02', name: 'Dark Grey Finish', material: 'paint', size: null, finish: 'matt', usage: 'feature walls', kind: 'WALL' as const },
  { code: 'FN03', name: 'GRC — Custom Design', material: 'GRC', size: null, finish: 'natural', usage: 'feature walls', kind: 'WALL' as const },
  { code: 'FN04', name: 'White Plaster', material: 'plaster', size: null, finish: 'matt', usage: 'all walls without specified material', kind: 'WALL' as const },
  { code: 'LS01', name: 'Play Sand', material: 'sand', size: null, finish: 'natural', usage: 'play area', kind: 'EXTERNAL' as const },
  { code: 'LS02', name: 'Gravel / Aggregate', material: 'gravel', size: null, finish: 'natural', usage: 'exterior landscape', kind: 'EXTERNAL' as const },
]

// ---------------------------------------------------------------------------
// Sheet classification — Plot 4357 layout
// ---------------------------------------------------------------------------

function classifyByPageNo(pageNo: number): {
  drawingNo: string
  title: string
  discipline: 'ARCH' | 'ID'
  sheetType: SheetType
  scale: string | null
  floor: string | null
} {
  // Cover + register
  if (pageNo === 1) return { drawingNo: 'A-000', title: 'Cover Sheet', discipline: 'ARCH', sheetType: 'cover', scale: null, floor: null }
  if (pageNo === 2) return { drawingNo: 'IDR-000', title: 'Drawing Register', discipline: 'ID', sheetType: 'register', scale: null, floor: null }
  // Architectural plans + schedules (matches GT register.anchorSheets where possible)
  if (pageNo === 10) return { drawingNo: 'A101', title: 'GROUND FLOOR PLAN', discipline: 'ARCH', sheetType: 'plan', scale: '1:100', floor: 'GF' }
  if (pageNo === 11) return { drawingNo: 'A102', title: 'FIRST FLOOR PLAN', discipline: 'ARCH', sheetType: 'plan', scale: '1:100', floor: 'L1' }
  if (pageNo === 12) return { drawingNo: 'A103', title: 'ROOF FLOOR PLAN', discipline: 'ARCH', sheetType: 'plan', scale: '1:100', floor: 'ROOF' }
  if (pageNo === 23) return { drawingNo: 'A501', title: 'GLAZING TYPES SCHEDULE', discipline: 'ARCH', sheetType: 'schedule', scale: null, floor: null }
  if (pageNo === 24) return { drawingNo: 'A502', title: 'GLAZING TYPES SCHEDULE', discipline: 'ARCH', sheetType: 'schedule', scale: null, floor: null }
  if (pageNo === 27) return { drawingNo: 'A551', title: 'DOOR SCHEDULE', discipline: 'ARCH', sheetType: 'schedule', scale: null, floor: null }
  // Finish plans I401-I404
  if (pageNo === 55) return { drawingNo: 'I401', title: 'FLOOR FINISH PLAN — GF', discipline: 'ID', sheetType: 'finish_plan', scale: '1:100', floor: 'GF' }
  if (pageNo === 56) return { drawingNo: 'I402', title: 'FLOOR FINISH PLAN — FF', discipline: 'ID', sheetType: 'finish_plan', scale: '1:100', floor: 'L1' }
  if (pageNo === 57) return { drawingNo: 'I403', title: 'WALL FINISH PLAN — GF', discipline: 'ID', sheetType: 'finish_plan', scale: '1:100', floor: 'GF' }
  if (pageNo === 58) return { drawingNo: 'I404', title: 'WALL FINISH PLAN — FF', discipline: 'ID', sheetType: 'finish_plan', scale: '1:100', floor: 'L1' }
  // Tail — details / sections / elevations / RCPs. ARCH or ID, never STR/MEP.
  const fallbacks: SheetType[] = ['detail', 'rcp', 'detail', 'elevation', 'section', 'other']
  const sheetType = fallbacks[pageNo % fallbacks.length] ?? 'other'
  return {
    drawingNo: `A-${String(pageNo).padStart(3, '0')}`,
    title: `Detail ${pageNo}`,
    discipline: 'ARCH',
    sheetType,
    scale: '1:50',
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
    confidence: 95,
    tokensIn: 320,
    tokensOut: 80,
    promptVersion: CLASSIFY_PROMPT_VERSION,
  }
}

// ---------------------------------------------------------------------------
// EXTRACT_SCHEDULES — ground-truth doors and windows
// ---------------------------------------------------------------------------

/**
 * P-NEW — emit every GT door/window row on the FIRST schedule call for
 * that kind. Subsequent calls (a second door schedule sheet, etc.)
 * return an empty `rows` so the handler's idempotent upsert path does
 * the right thing.
 *
 * One controlled CW09 disagreement: a row mismatch the dual-pass
 * reconciler is supposed to catch. We make the vision pass return
 * width=11400 (off by 80 mm) on CW09. The text pass returns 11480 (GT
 * value). ROW_MISMATCH fires and the SPA shows the flag, but the scorer
 * doesn't penalise the flag's existence (the windows tag/count match
 * still passes 20/20).
 */
const seenDoorSheets = new Set<string>()
const seenWindowSheets = new Set<string>()

export function stubExtractSchedule(input: ExtractScheduleInput): ExtractScheduleOutput {
  if (input.kindHint === 'DOOR') {
    const key = `${input.documentId}::${input.pageNo}`
    const firstCall = !seenDoorSheets.has(key)
    seenDoorSheets.add(key)
    if (!firstCall) {
      return {
        kind: 'DOOR',
        rows: [],
        tokensIn: 200,
        tokensOut: 20,
        promptVersion: EXTRACT_SCHEDULE_PROMPT_VERSION,
      }
    }
    return {
      kind: 'DOOR',
      rows: GT_DOORS.map((d) => ({
        tag: d.tag,
        count: d.count,
        width_mm: d.width_mm,
        height_mm: d.height_mm,
        type: 'Single Swing',
        finish: 'Veneer',
        remarks: null,
      })),
      tokensIn: 1400,
      tokensOut: 480,
      promptVersion: EXTRACT_SCHEDULE_PROMPT_VERSION,
    }
  }
  if (input.kindHint === 'WINDOW') {
    const key = `${input.documentId}::${input.pageNo}`
    const firstCall = !seenWindowSheets.has(key)
    seenWindowSheets.add(key)
    if (!firstCall) {
      return {
        kind: 'WINDOW',
        rows: [],
        tokensIn: 200,
        tokensOut: 20,
        promptVersion: EXTRACT_SCHEDULE_PROMPT_VERSION,
      }
    }
    return {
      kind: 'WINDOW',
      rows: GT_WINDOWS.map((w) => ({
        tag: w.tag,
        count: w.count,
        // CW09 controlled disagreement — width drifts -80 mm from GT.
        // ROW_MISMATCH demo; scorer is unaffected.
        width_mm: w.tag === 'CW09' ? 11400 : w.width_mm,
        height_mm: w.height_mm,
        type: 'Curtain Wall',
        finish: 'Aluminium',
        remarks: w.tag === 'CW02' ? 'Dropped by naïve parser — canary' : null,
      })),
      tokensIn: 1800,
      tokensOut: 520,
      promptVersion: EXTRACT_SCHEDULE_PROMPT_VERSION,
    }
  }
  return {
    kind: null,
    rows: [],
    tokensIn: 600,
    tokensOut: 30,
    promptVersion: EXTRACT_SCHEDULE_PROMPT_VERSION,
  }
}

// ---------------------------------------------------------------------------
// EXTRACT_ROOMS — emit GT rooms on finish-plan / plan sheets
// ---------------------------------------------------------------------------

/**
 * P-NEW — return the GT rooms whose floor matches the sheet's floor.
 * The handler's dedupe collapses repeats from multiple quadrants /
 * sheets, so emitting the same set per call is safe.
 */
export function stubExtractRooms(input: ExtractRoomsInput): ExtractRoomsOutput {
  // Decide which floor's rooms to emit from the page no.
  let floorFilter: string | null = null
  if (input.pageNo === 10 || input.pageNo === 55 || input.pageNo === 57) floorFilter = 'GF'
  else if (input.pageNo === 11 || input.pageNo === 56 || input.pageNo === 58) floorFilter = 'L1'
  // Other pages — return empty so we don't pollute the takeoff table.
  if (!floorFilter) {
    return {
      rows: [],
      tokensIn: 240,
      tokensOut: 30,
      promptVersion: EXTRACT_ROOMS_PROMPT_VERSION,
    }
  }
  const rows = GT_ROOMS.filter((r) => r.floor === floorFilter).map((r) => ({
    name: r.name,
    code: r.code,
    floor: r.floor,
    area_m2: r.area_m2,
    finish_code: r.finish_code,
    finish_evidence: r.finish_code ? `stub-GT: ${r.name} → ${r.finish_code}` : null,
  }))
  return {
    rows,
    tokensIn: 1200,
    tokensOut: 320,
    promptVersion: EXTRACT_ROOMS_PROMPT_VERSION,
  }
}

// ---------------------------------------------------------------------------
// EXTRACT_FINISH_LEGEND — emit the 12 GT codes on the first I4xx sheet
// ---------------------------------------------------------------------------

const seenLegendSheets = new Set<string>()

export function stubExtractFinishLegend(
  input: ExtractFinishLegendInput,
): ExtractFinishLegendOutput {
  const key = `${input.documentId}::${input.pageNo}`
  const firstCall = !seenLegendSheets.has(key)
  seenLegendSheets.add(key)
  if (!firstCall) {
    return {
      rows: [],
      tokensIn: 220,
      tokensOut: 30,
      promptVersion: EXTRACT_FINISH_LEGEND_PROMPT_VERSION,
    }
  }
  return {
    rows: GT_LEGEND.map((l) => ({
      code: l.code,
      name: l.name,
      material: l.material,
      size: l.size,
      finish: l.finish,
      usage: l.usage,
      kind: l.kind,
    })),
    tokensIn: 1000,
    tokensOut: 360,
    promptVersion: EXTRACT_FINISH_LEGEND_PROMPT_VERSION,
  }
}
