/**
 * Shared input/output shapes for the Anthropic client. The handlers don't see
 * Anthropic's `/v1/messages` payload at all — they only know about these
 * domain-shaped types. Same surface whether the live API or the stub fired.
 */

export type Discipline = 'ARCH' | 'ID' | 'STR' | 'MEP' | 'UNKNOWN'

export const SHEET_TYPES = [
  'cover',
  'register',
  'plan',
  'elevation',
  'section',
  'schedule',
  'legend',
  'detail',
  'rcp',
  'finish_plan',
  'other',
] as const
export type SheetType = (typeof SHEET_TYPES)[number]

export interface AiUsage {
  tokensIn: number
  tokensOut: number
  promptVersion: string
}

// --- CLASSIFY -------------------------------------------------------------

export interface ClassifyInput {
  documentId: string
  pageNo: number
  totalPages: number
  jpegBase64: string | null
  textSnippet: string
}

export interface ClassifyOutput extends AiUsage {
  drawing_no: string | null
  title: string | null
  discipline: Discipline
  sheet_type: SheetType
  scale: string | null
  floor: string | null
  confidence: number
}

// --- EXTRACT_SCHEDULES ----------------------------------------------------

export type ScheduleKind = 'DOOR' | 'WINDOW'

/**
 * Sprint-4: `kindHint` replaces the old required `kind`. The vision pass
 * decides for itself; we only suggest a starting bias from the title/drawing-no
 * heuristic (`decideKind` in the handler). Vision's `output.kind` wins.
 */
export interface ExtractScheduleInput {
  documentId: string
  pageNo: number
  kindHint: ScheduleKind | null
  jpegBase64: string | null
  textSnippet: string
}

export interface ExtractScheduleRow {
  tag: string
  /** Sprint-4: schedules often include a count column (e.g. "D01 6 1.00 3.00" — 6 copies). */
  count?: number | null
  width_mm: number | null
  height_mm: number | null
  type: string | null
  finish: string | null
  remarks: string | null
}

export interface ExtractScheduleOutput extends AiUsage {
  /** Sprint-4: vision-reported kind. null = "neither door nor window schedule". */
  kind: ScheduleKind | null
  rows: ExtractScheduleRow[]
}

// --- EXTRACT_FINISH_LEGEND (Sprint 6) -----------------------------------

export type LegendKind = 'FLOOR' | 'WALL' | 'CEILING' | 'EXTERNAL' | 'OTHER'

export interface ExtractFinishLegendInput {
  documentId: string
  pageNo: number
  jpegBase64: string | null
  textSnippet: string
}

export interface ExtractFinishLegendRow {
  code: string
  name: string | null
  material: string | null
  size: string | null
  finish: string | null
  usage: string | null
  kind: LegendKind | null
}

export interface ExtractFinishLegendOutput extends AiUsage {
  rows: ExtractFinishLegendRow[]
}

// --- EXTRACT_ROOMS --------------------------------------------------------

export interface ExtractRoomsInput {
  documentId: string
  pageNo: number
  jpegBase64: string | null
  textSnippet: string
  /**
   * Sprint-6 S6-2: legend codes already extracted from earlier finish-plan
   * sheets. The model uses this as a closed vocabulary when it labels each
   * room's finish_code.
   */
  legendCodes?: string[]
}

export interface ExtractRoomsRow {
  name: string
  code: string | null
  floor: string | null
  area_m2: number | null
  finish_code: string | null
  /**
   * Sprint-6 S6-2: the model's brief justification for why this finish_code
   * fits. The handler uses presence/absence (and the text-layer mention of
   * the code) to score finishConfidence: 85 corroborated, 70 vision-only.
   */
  finish_evidence?: string | null
}

export interface ExtractRoomsOutput extends AiUsage {
  rows: ExtractRoomsRow[]
}
