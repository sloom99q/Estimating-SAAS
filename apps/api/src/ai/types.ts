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

export interface ExtractScheduleInput {
  documentId: string
  pageNo: number
  kind: ScheduleKind
  jpegBase64: string | null
  textSnippet: string
}

export interface ExtractScheduleRow {
  tag: string
  width_mm: number | null
  height_mm: number | null
  type: string | null
  finish: string | null
  remarks: string | null
}

export interface ExtractScheduleOutput extends AiUsage {
  kind: ScheduleKind
  rows: ExtractScheduleRow[]
}

// --- EXTRACT_ROOMS --------------------------------------------------------

export interface ExtractRoomsInput {
  documentId: string
  pageNo: number
  jpegBase64: string | null
  textSnippet: string
}

export interface ExtractRoomsRow {
  name: string
  code: string | null
  floor: string | null
  area_m2: number | null
  finish_code: string | null
}

export interface ExtractRoomsOutput extends AiUsage {
  rows: ExtractRoomsRow[]
}
