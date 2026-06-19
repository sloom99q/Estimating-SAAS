import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDocumentBundle,
  fetchTakeoffBundle,
  patchTakeoffItem,
  uploadProjectDocument,
  type DocumentBundle,
  type PatchTakeoffPayload,
  type TakeoffBundle,
  type TakeoffItemDto,
  type UploadDocumentResult,
} from './takeoff.api'

const TAKEOFF_KEYS = {
  project: (projectId: string) => ['takeoff', 'project', projectId] as const,
  document: (documentId: string) => ['takeoff', 'document', documentId] as const,
}

/**
 * Fetch the project's takeoff items + flags. Polls every 4s while there's a
 * processing document in flight; the document poll drives the cadence here
 * indirectly by invalidating this query on terminal status.
 */
export function useTakeoffBundle(projectId: string | undefined, opts?: { pollMs?: number }) {
  return useQuery<TakeoffBundle>({
    queryKey: TAKEOFF_KEYS.project(projectId ?? ''),
    queryFn: () => fetchTakeoffBundle(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: opts?.pollMs ?? false,
  })
}

/**
 * Document + sheets + recent pipeline jobs. SPA polls this while any job is
 * not yet terminal so the user sees stage progress in near-real-time.
 */
export function useDocumentBundle(documentId: string | null) {
  return useQuery<DocumentBundle>({
    queryKey: TAKEOFF_KEYS.document(documentId ?? ''),
    queryFn: () => fetchDocumentBundle(documentId!),
    enabled: Boolean(documentId),
    refetchInterval: (query) => {
      const data = query.state.data as DocumentBundle | undefined
      if (!data) return 2_000
      if (data.document.status === 'READY' || data.document.status === 'FAILED') return false
      return 2_000
    },
  })
}

export function useUploadProjectDocument(projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<UploadDocumentResult, Error, File>({
    mutationFn: (file) => uploadProjectDocument(projectId!, file),
    onSuccess: () => {
      if (projectId) {
        void qc.invalidateQueries({ queryKey: TAKEOFF_KEYS.project(projectId) })
      }
    },
  })
}

export interface PatchTakeoffArgs {
  id: string
  payload: PatchTakeoffPayload
}

export function usePatchTakeoffItem(projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<TakeoffItemDto, Error, PatchTakeoffArgs>({
    mutationFn: ({ id, payload }) => patchTakeoffItem(id, payload),
    onSuccess: () => {
      if (projectId) {
        void qc.invalidateQueries({ queryKey: TAKEOFF_KEYS.project(projectId) })
      }
    },
  })
}
