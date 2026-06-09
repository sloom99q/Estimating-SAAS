/**
 * FUTURE SEAM — AI services. NOT implemented in Phase 1.
 *
 * This file is types-only. It documents the contract that future AI capabilities
 * (datasheet extraction, automated quantity takeoff, supplier intelligence) must
 * satisfy so they can drop in as a new `features/ai` vertical slice without
 * refactoring the host app.
 *
 * Key decision: AI work is long-running, so the contract is a JOB
 * (submit → poll status → read result), never a synchronous request/response.
 * Consumers poll with a TanStack Query `refetchInterval` that stops on a
 * terminal status. See features/ai/README.md.
 */
import type { ID } from '@/shared/types'

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface AiJob<TResult> {
  id: ID
  status: AiJobStatus
  /** Set when status === 'succeeded'. */
  result: TResult | null
  /** Set when status === 'failed' (i18n key or message). */
  error: string | null
  /** Optional progress in [0, 1]. */
  progress: number | null
}

export interface AiJobService<TInput, TResult> {
  submit(input: TInput): Promise<{ jobId: ID }>
  getStatus(jobId: ID): Promise<AiJob<TResult>>
}

/* ---- Concrete future capabilities (shapes only) ---- */

export interface DatasheetExtractionInput {
  documentId: ID
}

export interface DatasheetExtractionResult {
  fields: Record<string, string | number | null>
  /** Per-field model confidence in [0, 1] — drives human review/override. */
  confidence: Record<string, number>
}

export type DatasheetExtractionService = AiJobService<
  DatasheetExtractionInput,
  DatasheetExtractionResult
>
