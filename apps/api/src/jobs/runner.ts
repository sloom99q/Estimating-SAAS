import { config } from '../config'
import { prisma } from '../db'
import { HANDLERS } from './handlers'
import type { JobRecord } from './types'

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
  const rows = await prisma.$queryRawUnsafe<JobRecord[]>(`
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

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Boot the worker loop inside the API process. Idempotent; safe to call from
 * `index.ts`. To run the worker as a separate process later, call this from
 * its own entrypoint without booting the HTTP server.
 */
export function startWorker(): void {
  if (timer) return
  timer = setInterval(() => {
    void tick().catch((err) => console.error('[worker] tick failed:', err))
  }, TICK_MS)
  console.log(`[worker] started — tick every ${TICK_MS}ms`)
}

export function stopWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
