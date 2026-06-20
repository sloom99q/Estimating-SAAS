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
  // Sprint 6 — runs between CLASSIFY and EXTRACT_SCHEDULES so EXTRACT_ROOMS
  // has a legend vocabulary to label each room against.
  'EXTRACT_FINISH_LEGEND',
  'EXTRACT_SCHEDULES',
  'EXTRACT_ROOMS',
  'QUANTIFY',
  /** AI-est roadmap #3 — opt-in vision pass for kitchen base/wall/counter lm. */
  'ESTIMATE_KITCHEN',
  /** AI-est roadmap #4a — opt-in vision pass for wardrobe lm per bedroom. */
  'ESTIMATE_WARDROBES',
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
