import { config } from '../config'
import { prisma } from '../db'
import { HANDLERS } from './handlers'
import type { JobRecord } from './types'

/**
 * Sprint-9 S9-4 — retry wrapper for prisma.$queryRawUnsafe against transient
 * Neon DSN drops. The S8-8 baseline run lost ~5 minutes mid-CLASSIFY to a
 * "Server has closed the connection" error that the runner could've
 * survived. 3 tries with linear backoff, only retries on the Prisma
 * "connection closed" signature.
 */
async function queryRawWithRetry<T = unknown>(
  sql: string,
  maxAttempts = 3,
): Promise<T[]> {
  let attempt = 0
  let lastErr: unknown
  while (attempt < maxAttempts) {
    attempt += 1
    try {
      return await prisma.$queryRawUnsafe<T[]>(sql)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const retriable =
        /connection|socket|closed|terminated|reset|ECONNRESET|P1001|P2024/i.test(msg)
      if (!retriable || attempt >= maxAttempts) throw err
      const delayMs = 250 * attempt
      console.warn(`[worker] queryRawUnsafe retry ${attempt}/${maxAttempts} after ${delayMs} ms — ${msg.slice(0, 120)}`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 1500)
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_SECONDS = 2

/**
 * Sprint-1 architect-review reaper. Any RUNNING job whose `startedAt` predates
 * NOW() - JOB_TIMEOUT_MS is considered stuck — the worker that claimed it most
 * likely died (crash, OOM, redeploy, Anthropic hang). We requeue it if
 * `attempts` is still under MAX, else flip it to terminal FAILED with reason
 * 'timeout'. Runs once per tick BEFORE the next claim.
 */
async function reapStuckJobs(): Promise<void> {
  const cutoffMs = config.jobTimeoutMs
  // Single UPDATE: any RUNNING row past the cutoff that still has attempts
  // gets requeued; the rest get terminal-failed. We do two scoped updates
  // (one for each branch) because Postgres doesn't have an in-place CASE
  // UPDATE that's typesafe with Prisma. Both updates are race-free vs.
  // healthy workers because healthy workers only ever touch QUEUED rows.
  const requeueable = await prisma.job.findMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: new Date(Date.now() - cutoffMs) },
      attempts: { lt: MAX_ATTEMPTS },
    },
    select: { id: true, attempts: true },
  })
  if (requeueable.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: requeueable.map((r) => r.id) }, status: 'RUNNING' },
      data: {
        status: 'QUEUED',
        error: 'reaped: previous run exceeded JOB_TIMEOUT_MS',
        scheduledFor: new Date(),
      },
    })
  }
  await prisma.job.updateMany({
    where: {
      status: 'RUNNING',
      startedAt: { lt: new Date(Date.now() - cutoffMs) },
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: {
      status: 'FAILED',
      error: 'timeout',
      finishedAt: new Date(),
    },
  })
}

/**
 * One worker tick.
 *
 *   1. Atomically claim a single QUEUED job using the round-robin fair claim
 *      (Sprint-3 ADR-013): pick the org with due work whose most-recent
 *      `startedAt` is earliest (or never started), then take that org's
 *      oldest queued job. Postgres `FOR UPDATE SKIP LOCKED` keeps multiple
 *      workers safe.
 *   2. Run the registered handler.
 *   3. On success, mark DONE.
 *   4. On error: if we still have attempts left, reschedule with exponential
 *      backoff (2 ^ attempt × BACKOFF_BASE_SECONDS). Otherwise, terminal
 *      FAILED + bump org `Usage.jobsFailed`.
 *
 * Why round-robin: the Sprint-1 claim ordered ALL due jobs globally by
 * `createdAt`. An org uploading 50 documents at 10:00:00 would freeze every
 * other org's pipeline until its queue drained. Fair-claim serves the
 * least-recently-served org first, so a 1-job org never waits behind a
 * 50-job org. SaaS-fairness fix — ADR-013.
 */
export async function tick(): Promise<JobRecord | null> {
  // Sprint-2: reap stuck RUNNING jobs before claiming a new one.
  await reapStuckJobs()
  // ADR-013 fair claim. The CTE costs a small read per tick — cheap, indexed
  // on (status, scheduledFor, createdAt) and (organizationId, createdAt) from
  // Sprint-1. Postgres's `FOR UPDATE SKIP LOCKED` makes concurrent workers
  // safe even though we resolve the org in user space.
  const rows = await queryRawWithRetry<JobRecord>(`
    WITH due_jobs AS (
      SELECT id, "organizationId", "createdAt"
      FROM "jobs"
      WHERE status = 'QUEUED'
        AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
    ),
    -- For every org with due work, find the most-recent moment it was last
    -- served (across all of its jobs of any status). 'epoch' for orgs that
    -- have never had a job started.
    org_last_served AS (
      SELECT d."organizationId",
             COALESCE(MAX(j."startedAt"), 'epoch'::timestamptz) AS last_started
      FROM (SELECT DISTINCT "organizationId" FROM due_jobs) d
      LEFT JOIN "jobs" j
        ON j."organizationId" = d."organizationId"
       AND j."startedAt" IS NOT NULL
      GROUP BY d."organizationId"
    ),
    fair_org AS (
      SELECT "organizationId"
      FROM org_last_served
      ORDER BY last_started ASC
      LIMIT 1
    )
    UPDATE "jobs"
    SET status      = 'RUNNING',
        "startedAt" = NOW(),
        attempts    = attempts + 1,
        "aiMode"    = '${config.aiMode}'
    WHERE id = (
      SELECT id FROM due_jobs
      WHERE "organizationId" = (SELECT "organizationId" FROM fair_org)
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `)
  const job = rows[0]
  if (!job) return null

  // S8-8 R1: stamp the resolved model based on the job type. CLASSIFY uses
  // the cheap tier; everything that does vision (LEGEND / SCHEDULES / ROOMS)
  // uses the vision tier. Non-AI jobs (INGEST, QUANTIFY, BOQ, PRICE, etc.)
  // get the default so the column still shows what the worker WOULD have
  // used if it had needed AI — easier for ops to grep than NULLs.
  const aiModelForJob =
    job.type === 'CLASSIFY'
      ? config.anthropicModels.classify
      : job.type === 'EXTRACT_FINISH_LEGEND' ||
          job.type === 'EXTRACT_SCHEDULES' ||
          job.type === 'EXTRACT_ROOMS'
        ? config.anthropicModels.vision
        : config.anthropicModels.default
  await prisma.job.update({
    where: { id: job.id },
    data: { aiModel: aiModelForJob },
  })

  const handler = HANDLERS[job.type as keyof typeof HANDLERS]
  if (!handler) {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        error: `Unknown job type: ${job.type}`,
        finishedAt: new Date(),
      },
    })
    return job
  }

  try {
    const result = await handler(job)
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'DONE',
        result: (result ?? null) as object,
        error: null,
        finishedAt: new Date(),
      },
    })
    await bumpUsage(job.organizationId, { jobsRun: 1 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (job.attempts >= MAX_ATTEMPTS) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      })
      await bumpUsage(job.organizationId, { jobsFailed: 1 })
      // MULTI-DOC #1 (2026-06-21) — pipeline-job FAILED → mark the
      // Document FAILED too. Previously a crash in INGEST / CLASSIFY /
      // EXTRACT_* left the Document stuck at PROCESSING forever, which
      // blocked the multi-doc GenerateBoqCard gate (the gate releases
      // on READY OR FAILED — but never gets either if the doc is
      // stuck). Now any pipeline failure surfaces clearly in
      // DocumentsListCard and the user can retry the one bad doc.
      await markDocumentFailedIfPipeline(job, message).catch(() => undefined)
    } else {
      const backoffSec = Math.pow(2, job.attempts) * BACKOFF_BASE_SECONDS
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'QUEUED',
          error: message,
          scheduledFor: new Date(Date.now() + backoffSec * 1000),
        },
      })
    }
  }
  return job
}

/**
 * MULTI-DOC #1 — pipeline-job FAILED handlers should flip the related
 * Document to FAILED so the SPA gate releases. We grep the payload for
 * a documentId and flip iff the job type is one of the pipeline stages
 * that owns the document's lifecycle. Other job types (QUANTIFY, PRICE,
 * ESTIMATE_*, EXPORT_*) don't touch Document.status.
 */
const DOCUMENT_LIFECYCLE_TYPES = new Set<string>([
  'INGEST',
  'CLASSIFY',
  'EXTRACT_FINISH_LEGEND',
  'EXTRACT_SCHEDULES',
  'EXTRACT_ROOMS',
])

async function markDocumentFailedIfPipeline(
  job: { type: string; payload: unknown; organizationId: string },
  reason: string,
): Promise<void> {
  if (!DOCUMENT_LIFECYCLE_TYPES.has(job.type)) return
  const payload = (job.payload ?? {}) as { documentId?: unknown }
  const documentId = typeof payload.documentId === 'string' ? payload.documentId : null
  if (!documentId) return
  const doc = await prisma.document.findFirst({
    where: { id: documentId, organizationId: job.organizationId },
    select: { id: true, status: true },
  })
  // Don't downgrade a READY doc — a stale failing job on an already-
  // processed document shouldn't undo the good state.
  if (!doc || doc.status === 'READY' || doc.status === 'FAILED') return
  await prisma.document.update({
    where: { id: doc.id },
    data: { status: 'FAILED' },
  })
  console.log(`[runner] doc ${documentId} → FAILED after ${job.type} crash: ${reason.slice(0, 120)}`)
}

async function bumpUsage(
  organizationId: string,
  delta: { jobsRun?: number; jobsFailed?: number; pagesProcessed?: number },
): Promise<void> {
  await prisma.usage.upsert({
    where: { organizationId },
    create: {
      organizationId,
      jobsRun: delta.jobsRun ?? 0,
      jobsFailed: delta.jobsFailed ?? 0,
      pagesProcessed: delta.pagesProcessed ?? 0,
    },
    update: {
      ...(delta.jobsRun ? { jobsRun: { increment: delta.jobsRun } } : {}),
      ...(delta.jobsFailed ? { jobsFailed: { increment: delta.jobsFailed } } : {}),
      ...(delta.pagesProcessed
        ? { pagesProcessed: { increment: delta.pagesProcessed } }
        : {}),
    },
  })
}

let running = false
let stopRequested = false

/**
 * Boot the worker loop inside the API process. Idempotent; safe to call from
 * `index.ts`. To run the worker as a separate process later, call this from
 * its own entrypoint without booting the HTTP server.
 *
 * 2026-06-24 — replaced `setInterval(tick, TICK_MS)` with a sequential
 * loop that awaits each tick before sleeping. The old pattern fired
 * the next tick regardless of whether the previous one had finished,
 * so two jobs could run concurrently within the same worker. That
 * triggered a findFirst→create race in PARSE_DXF where two
 * documents' jobs both checked for a tag, both missed, both created
 * (the D02 dup during the LM1929 thread). The fix here is the right
 * place: serialize at the tick level. PARSE_DXF's post-write dedup
 * stays as belt-and-braces.
 */
export function startWorker(): void {
  if (running) return
  running = true
  stopRequested = false
  console.log(`[worker] started — tick every ${TICK_MS}ms (sequential)`)
  void (async () => {
    while (!stopRequested) {
      try {
        await tick()
      } catch (err) {
        console.error('[worker] tick failed:', err)
      }
      await new Promise((r) => setTimeout(r, TICK_MS))
    }
    running = false
  })()
}

export function stopWorker(): void {
  stopRequested = true
}
