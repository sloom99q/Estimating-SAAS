import { prisma } from '../db'
import { HANDLERS } from './handlers'
import type { JobRecord } from './types'

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 1500)
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_SECONDS = 2

/**
 * One worker tick.
 *
 *   1. Atomically claim a single QUEUED job whose `scheduledFor` is in the
 *      past (or null) via `UPDATE ... FOR UPDATE SKIP LOCKED`. This is the
 *      only Postgres-specific call we make — and it's the reason SQLite is
 *      gone: SKIP LOCKED makes multiple worker processes safe with no Redis.
 *   2. Run the registered handler.
 *   3. On success, mark DONE.
 *   4. On error: if we still have attempts left, reschedule with exponential
 *      backoff (2 ^ attempt × BACKOFF_BASE_SECONDS). Otherwise, terminal
 *      FAILED + bump org `Usage.jobsFailed`.
 */
export async function tick(): Promise<JobRecord | null> {
  // Raw SQL because Prisma's typed update can't express SKIP LOCKED.
  const rows = await prisma.$queryRawUnsafe<JobRecord[]>(`
    UPDATE "jobs"
    SET status      = 'RUNNING',
        "startedAt" = NOW(),
        attempts    = attempts + 1
    WHERE id = (
      SELECT id FROM "jobs"
      WHERE status = 'QUEUED'
        AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `)
  const job = rows[0]
  if (!job) return null

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
