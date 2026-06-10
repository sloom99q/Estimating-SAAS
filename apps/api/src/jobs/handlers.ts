import type { JobHandler, JobType } from './types'

/**
 * Handler registry. NOOP + FORCE_FAIL exist to prove the runner lifecycle
 * (Sprint 1). Sprint 2+ replaces the `notImplemented` shims with the AI
 * takeoff pipeline (INGEST/CLASSIFY/...).
 */

function notImplemented(name: string): JobHandler {
  return async () => {
    throw new Error(`[handler:${name}] not implemented (Sprint 1)`)
  }
}

export const HANDLERS: Record<JobType, JobHandler> = {
  NOOP: async (job) => ({ ok: true, sawJobId: job.id }),
  FORCE_FAIL: async (job) => {
    throw new Error(`[handler:FORCE_FAIL] deliberate failure for job ${job.id}`)
  },
  INGEST: notImplemented('INGEST'),
  CLASSIFY: notImplemented('CLASSIFY'),
  EXTRACT_SCHEDULES: notImplemented('EXTRACT_SCHEDULES'),
  EXTRACT_ROOMS: notImplemented('EXTRACT_ROOMS'),
  QUANTIFY: notImplemented('QUANTIFY'),
  VALIDATE: notImplemented('VALIDATE'),
  PRICE: notImplemented('PRICE'),
  EXPORT_XLSX: notImplemented('EXPORT_XLSX'),
}
