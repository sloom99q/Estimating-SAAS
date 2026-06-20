/**
 * Takeoff feature API surface. Wraps the Sprint-2 endpoints in typed callers.
 * The upload route uses multipart and bypasses the JSON-only `httpRequest`
 * helper; everything else goes through it.
 */
import { env } from '@/shared/config/env'
import { HttpError, httpRequest } from '@/shared/lib/http/client'
import { sessionActions, useSessionStore } from '@/shared/store/sessionStore'

export interface DocumentDto {
  id: string
  organizationId: string
  projectId: string
  filename: string
  storageKey: string
  pageCount: number | null
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  createdAt: string
  updatedAt: string
}

export interface SheetDto {
  id: string
  documentId: string
  pageNo: number
  drawingNo: string | null
  title: string | null
  discipline: string | null
  sheetType: string | null
  scaleNote: string | null
  hasTextLayer: boolean
  rawTextKey: string | null
  imageKey: string | null
  aiJson: unknown
  promptVersion: string | null
}

export interface JobDto {
  id: string
  type: string
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
  attempts: number
  error: string | null
  result: unknown
  /** Sprint-8 S8-6: 'live' / 'stub' / null (rows pre-dating the column). */
  aiMode: 'live' | 'stub' | null
  /** Sprint-8 S8-8 R1: per-job model the worker resolved (sonnet, opus, …). */
  aiModel: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface DocumentBundle {
  document: DocumentDto
  sheets: SheetDto[]
  jobs: JobDto[]
}

export interface TakeoffItemDto {
  id: string
  organizationId: string
  projectId: string
  category: string
  tag: string | null
  description: string
  unit: string
  qtyAi: string | null
  qtyFinal: string | null
  basis: string
  confidence: number
  sourceSheetId: string | null
  sourceNote: string | null
  status: 'AI' | 'EDITED' | 'APPROVED'
  meta: unknown
  promptVersion: string | null
  createdAt: string
  updatedAt: string
}

export interface ValidationFlagDto {
  id: string
  projectId: string
  takeoffItemId: string | null
  rule: string
  severity: 'ERROR' | 'WARN' | 'INFO'
  message: string
  resolved: boolean
  createdAt: string
  updatedAt: string
}

export interface TakeoffBundle {
  items: TakeoffItemDto[]
  flagsByItem: Record<string, ValidationFlagDto[]>
  projectFlags: ValidationFlagDto[]
}

function currentToken(): string | undefined {
  return useSessionStore.getState().session?.token
}

async function withAuth<T>(
  path: string,
  init?: Omit<Parameters<typeof httpRequest>[1], 'token'>,
): Promise<T> {
  const token = currentToken()
  try {
    return await httpRequest<T>(path, { ...(init ?? {}), ...(token ? { token } : {}) })
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      sessionActions.clearSession()
    }
    throw err
  }
}

export async function fetchDocumentBundle(documentId: string): Promise<DocumentBundle> {
  return withAuth<DocumentBundle>(`/api/documents/${documentId}`)
}

export async function fetchTakeoffBundle(projectId: string): Promise<TakeoffBundle> {
  return withAuth<TakeoffBundle>(`/api/projects/${projectId}/takeoff-items`)
}

/**
 * Sprint-9 S9-3: closed legend-code vocabulary the SPA dropdown offers
 * for the per-room finish override. Mirrors the API's
 * FINISH_CODE_VOCAB; keep these in sync.
 */
export const FINISH_CODE_VOCAB = [
  'ST01',
  'ST02',
  'ST03',
  'PR01',
  'PR03',
  'WD01',
  'FN01',
  'FN02',
  'FN03',
  'FN04',
  'LS01',
  'LS02',
  'BATHROOM',
] as const
export type FinishCode = (typeof FINISH_CODE_VOCAB)[number]

export interface PatchTakeoffPayload {
  qtyFinal?: number | null
  status?: 'AI' | 'EDITED' | 'APPROVED'
  /** Sprint-9 S9-3 — per-room finish override. Null clears the code. */
  finishCode?: FinishCode | null
}

export async function patchTakeoffItem(
  id: string,
  payload: PatchTakeoffPayload,
): Promise<TakeoffItemDto> {
  return withAuth<TakeoffItemDto>(`/api/takeoff-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/**
 * PIVOT — closed vocab for ROOM floor-finish selection. FN/WD/LS codes
 * (wall + landscape) deliberately excluded so a reviewer can't mis-assign
 * a wall code as a room's floor. ST02 also out — it routes to the
 * stair-landing rate (550 AED/m²) in the price waterfall; staircase rooms
 * get ST02 via QUANTIFY's separate STAIR-TREAD emission, not through
 * this dropdown. Cold-run priced a KITCHEN floor at 550 × 70.4 m² =
 * 38,692 AED on this rate before ST02 was pulled.
 *
 * Same set used by the bulk accept-suggestions endpoint's
 * onlyFloorFinishCodes guard. Keep aligned with server
 * apps/api/src/jobs/handlers/_roomSelector.ts FLOOR_LEGEND_ALLOWED.
 */
export const FLOOR_FINISH_VOCAB = [
  'ST01',
  'ST03',
  'PR01',
  'PR03',
  'BATHROOM',
] as const
export type FloorFinishCode = (typeof FLOOR_FINISH_VOCAB)[number]

/**
 * PIVOT — the rate each floor code resolves to in the pricing waterfall.
 * Display-only mirror of the server's rateCodeFor() FLOOR_FINISH branch.
 * Source of truth is RateLibraryItem on the server; this lets the review
 * table show the impact of a confirmation in-row without an extra fetch.
 * Keep in sync with apps/api/src/jobs/handlers/price.ts.
 */
export const FLOOR_FINISH_RATE_AED_PER_M2: Record<FloorFinishCode, number | 'P/S'> = {
  ST01: 200,
  ST03: 250, // external porcelain pavement
  PR01: 210,
  PR03: 150,
  BATHROOM: 195,
}

export interface AcceptSuggestionsResult {
  ok: boolean
  roomsScanned: number
  accepted: number
  skipped: number
  acceptedDetails: Array<{ id: string; code: string }>
  skippedDetails: Array<{ id: string; reason: string }>
}

export async function acceptFinishSuggestions(
  projectId: string,
  body: { roomIds?: string[]; onlyFloorFinishCodes?: boolean } = {},
): Promise<AcceptSuggestionsResult> {
  return withAuth<AcceptSuggestionsResult>(
    `/api/projects/${projectId}/finishes/accept-suggestions`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
}

/**
 * Roadmap #5 — estimator-side provisional-sum carry. Posts to the
 * existing PB-1 add-line endpoint with isProvisional=true + psAmount.
 * The new BOQ now always carries Section 4.0 Provisional Sums (empty
 * by default) so this endpoint always has a section to write into.
 */
export interface BoqSectionSummary {
  id: string
  code: string
  title: string
}

export interface AddProvisionalLinePayload {
  description: string
  unit: string
  qty: number
  psAmount: number
  brand?: string
}

export async function fetchBoqSections(boqId: string): Promise<BoqSectionSummary[]> {
  const boq = await withAuth<{
    sections: Array<{ id: string; code: string; title: string }>
  }>(`/api/boqs/${boqId}`, { method: 'GET' })
  return boq.sections.map((s) => ({ id: s.id, code: s.code, title: s.title }))
}

export async function addProvisionalBoqLine(
  boqId: string,
  sectionId: string,
  payload: AddProvisionalLinePayload,
): Promise<void> {
  await withAuth(`/api/boqs/${boqId}/sections/${sectionId}/lines`, {
    method: 'POST',
    body: JSON.stringify({
      description: payload.description,
      brand: payload.brand,
      unit: payload.unit,
      qty: payload.qty,
      isProvisional: true,
      psAmount: payload.psAmount,
    }),
  })
}

/**
 * #128 — Edit an existing provisional BOQ line. Pass only the fields
 * you want to change. The server adjusts BOQ subtotals by the delta
 * and writes a Correction row.
 */
export interface PatchBoqLinePayload {
  description?: string
  qty?: number
  rate?: number | null
  psAmount?: number | null
}

export async function patchBoqLine(
  boqId: string,
  lineId: string,
  payload: PatchBoqLinePayload,
): Promise<void> {
  await withAuth(`/api/boqs/${boqId}/lines/${lineId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/**
 * #128 — Delete a BOQ line (hard delete; the BoqLine model has no
 * deletedAt). Server subtracts the line's amount + psAmount from the
 * BOQ totals and writes a Correction row.
 */
export async function deleteBoqLine(boqId: string, lineId: string): Promise<void> {
  await withAuth(`/api/boqs/${boqId}/lines/${lineId}`, { method: 'DELETE' })
}

/**
 * #128 — Lightweight DTO of the existing P/S lines in section 4.0 (and
 * any other section). The AddProvisionalLineCard renders a list of
 * these so the estimator can edit + delete what they previously added.
 */
export interface ExistingProvisionalLine {
  id: string
  itemRef: string
  description: string
  unit: string
  qty: number
  psAmount: number
  sectionId: string
  sectionCode: string
}

interface BoqDetail {
  sections: Array<{
    id: string
    code: string
    lines: Array<{
      id: string
      itemRef: string
      description: string
      unit: string
      qty: string | null
      psAmount: string | null
      isProvisional: boolean
    }>
  }>
}

export async function fetchProvisionalLines(boqId: string): Promise<ExistingProvisionalLine[]> {
  const boq = await withAuth<BoqDetail>(`/api/boqs/${boqId}`, { method: 'GET' })
  const out: ExistingProvisionalLine[] = []
  for (const s of boq.sections) {
    for (const l of s.lines) {
      if (!l.isProvisional) continue
      out.push({
        id: l.id,
        itemRef: l.itemRef,
        description: l.description,
        unit: l.unit,
        qty: l.qty ? Number.parseFloat(l.qty) : 0,
        psAmount: l.psAmount ? Number.parseFloat(l.psAmount) : 0,
        sectionId: s.id,
        sectionCode: s.code,
      })
    }
  }
  return out
}

/**
 * Sprint-8 S8-7 — owner-runnable BOQ flow from the SPA.
 *
 *   1. quantify  — derives FLOOR/WALL/CEILING totals from rooms+legend
 *   2. boq       — assembles BOQ from quantified takeoff items
 *   3. price     — runs the pricing waterfall against the BOQ
 *   4. XLSX URL  — link the user can click to download the rendered file
 */
export interface QuantifyResult {
  jobId: string
}
export async function startQuantify(projectId: string): Promise<QuantifyResult> {
  return withAuth<QuantifyResult>(`/api/projects/${projectId}/quantify`, { method: 'POST' })
}

/**
 * AI-est roadmap #3 — opt-in kitchen estimate. Costs ~$0.01 per click.
 * Returns the jobId; caller polls fetchJob until DONE, then invalidates
 * the takeoff bundle to surface the new ESTIMATED rows in JOINERY.
 */
export async function startEstimateKitchen(projectId: string): Promise<QuantifyResult> {
  return withAuth<QuantifyResult>(`/api/projects/${projectId}/estimate-kitchen`, { method: 'POST' })
}

/**
 * AI-est roadmap #4a — opt-in wardrobes per bedroom. Cost scales with
 * bedroom count: ~$0.05 per bedroom on Opus. Same suggestion-only
 * contract as kitchen — rows land in JOINERY for the expert to Confirm.
 */
export async function startEstimateWardrobes(projectId: string): Promise<QuantifyResult> {
  return withAuth<QuantifyResult>(`/api/projects/${projectId}/estimate-wardrobes`, { method: 'POST' })
}

export interface BoqCreateResult {
  id: string
  version: number
  status: string
  subtotal: string | null
  totalProvisional: string | null
}
export async function generateBoq(projectId: string): Promise<BoqCreateResult> {
  return withAuth<BoqCreateResult>(`/api/projects/${projectId}/boq`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/**
 * PE-3 — fetch the project's latest BOQ (descending version). Returns
 * null when the project has no BOQ yet so the SPA can fall into the
 * generate flow instead of throwing.
 */
export async function fetchLatestBoq(projectId: string): Promise<BoqCreateResult | null> {
  try {
    return await withAuth<BoqCreateResult>(`/api/projects/${projectId}/boq`)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null
    throw err
  }
}

export interface PriceResult {
  jobId: string
}
export async function priceBoq(boqId: string): Promise<PriceResult> {
  return withAuth<PriceResult>(`/api/boqs/${boqId}/price`, { method: 'POST' })
}

/**
 * Sprint-10 S10-3 — Add a MANUAL BoqLine into a chosen section.
 * EITHER {rate} or {isProvisional, psAmount} per the API contract.
 */
export interface AddBoqLinePayload {
  description: string
  brand?: string
  unit: string
  qty: number
  rate?: number
  isProvisional?: boolean
  psAmount?: number
}
export interface AddBoqLineResult {
  id: string
  itemRef: string
}
export async function addManualBoqLine(
  boqId: string,
  sectionId: string,
  payload: AddBoqLinePayload,
): Promise<AddBoqLineResult> {
  return withAuth<AddBoqLineResult>(`/api/boqs/${boqId}/sections/${sectionId}/lines`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function xlsxDownloadUrl(boqId: string, includeInternal = false): string {
  if (!env.apiUrl) return ''
  const params = includeInternal ? '?includeInternal=1' : ''
  return `${env.apiUrl}/api/boqs/${boqId}/export.xlsx${params}`
}

/**
 * PE-2 follow-up — the XLSX endpoint requires a Bearer token. A bare
 * `<a href>` opens the URL in a new tab without auth and the API
 * answers "Missing access token" as JSON. This helper does the
 * authenticated fetch, reads the response as a Blob, and triggers a
 * proper file-save in the browser. The filename comes from the API's
 * Content-Disposition header (e.g. "boq-S8_8_Baseline-v6.xlsx"); we
 * fall back to a synthesised name if the header is missing.
 */
function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null
  const utf8 = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8) return decodeURIComponent(utf8[1]!.trim().replace(/^"|"$/g, ''))
  const plain = value.match(/filename\s*=\s*"?([^";]+)"?/i)
  return plain ? plain[1]!.trim() : null
}

export async function downloadBoqXlsx(boqId: string, includeInternal = false): Promise<void> {
  if (!env.apiUrl) throw new Error('VITE_API_URL is not set')
  const token = currentToken()
  if (!token) {
    sessionActions.clearSession()
    throw new Error('Not signed in')
  }
  const url = xlsxDownloadUrl(boqId, includeInternal)
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    sessionActions.clearSession()
    throw new HttpError(401, 'Session expired — please sign in again', null)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new HttpError(res.status, body || res.statusText, null)
  }
  const blob = await res.blob()
  const filename =
    parseContentDispositionFilename(res.headers.get('Content-Disposition')) ??
    `boq-${boqId}${includeInternal ? '-internal' : ''}.xlsx`
  const blobUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Defer revocation slightly so the browser actually starts the
    // download before the URL becomes invalid.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000)
  }
}

export interface JobLite {
  id: string
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
  result: unknown
  error: string | null
}
export async function fetchJob(jobId: string): Promise<JobLite> {
  return withAuth<JobLite>(`/api/jobs/${jobId}`)
}

/**
 * Sprint-10 PA-2 — Retry a FAILED pipeline stage. Re-enqueues a fresh
 * job of the same type. Idempotent — see handlers' natural-key UPSERT
 * (Sprint-7 S7-1).
 */
export async function retryJob(jobId: string): Promise<{ id: string; type: string }> {
  return withAuth<{ id: string; type: string }>(`/api/jobs/${jobId}/retry`, { method: 'POST' })
}

/**
 * Sprint-10 PA-4 — Documents list (with FAILED visibility) per project.
 * Returns the document row + cheap job-state aggregates so the SPA can
 * surface failures at the list level without round-tripping each
 * document.
 */
export interface DocumentListEntry extends DocumentDto {
  jobs: { failed: number; running: number; queued: number; total: number }
  firstFailedJob: { id: string; type: string; error: string } | null
}
export async function fetchProjectDocuments(projectId: string): Promise<DocumentListEntry[]> {
  const body = await withAuth<{ documents: DocumentListEntry[] }>(
    `/api/projects/${projectId}/documents`,
  )
  return body.documents
}

/**
 * Multipart upload. Bypasses `httpRequest` because that helper always sets
 * Content-Type: application/json and serialises the body. We let the browser
 * compute the multipart boundary instead.
 */
export interface UploadDocumentResult {
  document: DocumentDto
  ingestJobId: string
}

export async function uploadProjectDocument(
  projectId: string,
  file: File,
): Promise<UploadDocumentResult> {
  if (!env.apiUrl) throw new Error('VITE_API_URL is not set')
  const token = currentToken()
  const form = new FormData()
  form.append('file', file, file.name)
  const init: RequestInit = { method: 'POST', body: form }
  if (token) init.headers = { Authorization: `Bearer ${token}` }
  const res = await fetch(`${env.apiUrl}/api/projects/${projectId}/documents`, init)
  if (res.status === 401) {
    sessionActions.clearSession()
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText) || `HTTP ${res.status}`
    throw new HttpError(res.status, message, body)
  }
  return body as UploadDocumentResult
}
