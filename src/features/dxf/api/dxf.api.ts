/**
 * DXF MVP — feature-local API client.
 *
 * Three calls:
 *  - fetchLayerReport(projectId, documentId)
 *  - fetchLayerMap(projectId) — current + org default + AIA reference
 *  - saveLayerMap(projectId, payload)
 *
 * Wrapped with the same auth/401-clear pattern the takeoff feature
 * already uses so a stale session bubbles up consistently.
 */
import { HttpError, httpRequest } from '@/shared/lib/http/client'
import { sessionActions, useSessionStore } from '@/shared/store/sessionStore'

export interface LayerSummary {
  name: string
  entityCount: number
  entityTypes: Record<string, number>
  closedPolylineCount: number
  openPolylineCount: number
  lineCount: number
  textCount: number
  insertBlockNames: string[]
  matchedRoles: string[]
}

export interface LayerReport {
  ok: boolean
  error: string | null
  insUnits: number | null
  totalEntities: number
  totalLayers: number
  layers: LayerSummary[]
  suggested: {
    roomBounds: string[]
    roomLabels: string[]
    doors: string[]
    windows: string[]
    walls: string[]
  }
}

export interface LayerReportResponse {
  document: { id: string; filename: string }
  report: LayerReport
}

export interface LayerMap {
  roomBounds: string[]
  roomLabels: string[]
  doors: string[]
  windows: string[]
  walls: string[]
  tagAttribs: string[]
  minRoomAreaM2: number
  maxRoomAreaM2: number
}

export interface LayerMapResponse {
  layerMap: LayerMap | null
  orgDefault: LayerMap | null
  aiaDefault: LayerMap
}

export interface SaveLayerMapResult {
  ok: boolean
  parseDxfQueued: boolean
  parseDxfJobId: string | null
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

export async function fetchLayerReport(
  projectId: string,
  documentId: string,
): Promise<LayerReportResponse> {
  return withAuth<LayerReportResponse>(
    `/api/projects/${projectId}/dxf/${documentId}/layers`,
  )
}

export async function fetchLayerMap(projectId: string): Promise<LayerMapResponse> {
  return withAuth<LayerMapResponse>(`/api/projects/${projectId}/layer-map`)
}

export async function saveLayerMap(
  projectId: string,
  payload: {
    layerMap: LayerMap
    saveAsOrgDefault?: boolean
    enqueueDocumentId?: string
  },
): Promise<SaveLayerMapResult> {
  return withAuth<SaveLayerMapResult>(`/api/projects/${projectId}/layer-map`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
