/**
 * Job-runner job catalogue. Each handler is registered against one of these
 * type values; the worker dispatches by string match. Sprint 1 ships NOOP +
 * FORCE_FAIL (proving the lifecycle). Sprint 2+ wires the rest of the AI
 * takeoff pipeline.
 */
export const JOB_TYPES = [
  // Sprint 1 — lifecycle proof
  'NOOP',
  'FORCE_FAIL',
  // Sprint 2+ — AI takeoff pipeline (registered as notImplemented for now)
  'INGEST',
  'CLASSIFY',
  'EXTRACT_SCHEDULES',
  'EXTRACT_ROOMS',
  'QUANTIFY',
  'VALIDATE',
  'PRICE',
  'EXPORT_XLSX',
] as const
export type JobType = (typeof JOB_TYPES)[number]

export interface JobRecord {
  id: string
  organizationId: string
  projectId: string | null
  type: string
  payload: unknown
  status: string
  attempts: number
  error: string | null
  result: unknown
  scheduledFor: Date | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

export type JobHandler = (job: JobRecord) => Promise<unknown>
