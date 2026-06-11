import { classifyHandler } from './handlers/classify'
import { extractRoomsHandler } from './handlers/extractRooms'
import { extractSchedulesHandler } from './handlers/extractSchedules'
import { ingestHandler } from './handlers/ingest'
import type { JobHandler, JobType } from './types'

/**
 * Handler registry. Sprint 1 wired NOOP + FORCE_FAIL to prove the runner
 * lifecycle. Sprint 2 wires INGEST + CLASSIFY + EXTRACT_SCHEDULES +
 * EXTRACT_ROOMS — the takeoff pipeline. QUANTIFY..EXPORT_XLSX stay as shims
 * for later sprints.
 */

function notImplemented(name: string, sprint: string): JobHandler {
  return async () => {
    throw new Error(`[handler:${name}] not implemented (${sprint})`)
  }
}

export const HANDLERS: Record<JobType, JobHandler> = {
  NOOP: async (job) => ({ ok: true, sawJobId: job.id }),
  FORCE_FAIL: async (job) => {
    throw new Error(`[handler:FORCE_FAIL] deliberate failure for job ${job.id}`)
  },
  INGEST: ingestHandler,
  CLASSIFY: classifyHandler,
  EXTRACT_SCHEDULES: extractSchedulesHandler,
  EXTRACT_ROOMS: extractRoomsHandler,
  QUANTIFY: notImplemented('QUANTIFY', 'Sprint 3'),
  VALIDATE: notImplemented('VALIDATE', 'Sprint 3'),
  PRICE: notImplemented('PRICE', 'Sprint 3'),
  EXPORT_XLSX: notImplemented('EXPORT_XLSX', 'Sprint 4'),
}
