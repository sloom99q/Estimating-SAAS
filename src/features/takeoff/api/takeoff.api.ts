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
