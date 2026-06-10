import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import { JOB_TYPES, type JobType } from '../jobs/types'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

const testBody = z.object({
  type: z.enum(['NOOP', 'FORCE_FAIL']),
  payload: z.unknown().optional(),
  projectId: z.string().optional(),
})

function job(row: {
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
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    type: row.type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    result: row.result,
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }
}

function usage(row: {
  organizationId: string
  pagesProcessed: number
  jobsRun: number
  jobsFailed: number
  tokensIn: number
  tokensOut: number
  updatedAt: Date
}) {
  return {
    organizationId: row.organizationId,
    pagesProcessed: row.pagesProcessed,
    jobsRun: row.jobsRun,
    jobsFailed: row.jobsFailed,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function registerJobRoutes(router: Router): void {
  /**
   * POST /api/jobs/_test
   *
   * Test affordance only. Enqueues a NOOP or FORCE_FAIL job for the caller's
   * org so we can prove the runner lifecycle end-to-end without uploading a
   * real document. Sprint 2 introduces /api/projects/:id/documents which is
   * the real INGEST entry point.
   */
  router.post(
    '/api/jobs/_test',
    requireAuth(async (req, ctx) => {
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const parsed = testBody.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(400, 'Invalid payload', parsed.error.format())
      }
      const db = tenantDb(ctx.organizationId)
      const created = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: parsed.data.projectId ?? null,
          type: parsed.data.type as JobType,
          payload: (parsed.data.payload ?? {}) as object,
        },
      })
      return jsonResponse(job(created), 201)
    }),
  )

  router.get(
    '/api/jobs/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const row = await db.job.findFirst({ where: { id: ctx.params.id } })
      if (!row) return errorResponse(404, 'Job not found')
      return jsonResponse(job(row))
    }),
  )

  router.get(
    '/api/jobs',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const status = ctx.query.get('status') ?? undefined
      const type = ctx.query.get('type') ?? undefined
      const rows = await db.job.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      return jsonResponse(rows.map(job))
    }),
  )

  router.get(
    '/api/usage',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const existing = await db.usage.findFirst({})
      const row = existing ?? {
        organizationId: ctx.organizationId,
        pagesProcessed: 0,
        jobsRun: 0,
        jobsFailed: 0,
        tokensIn: 0,
        tokensOut: 0,
        updatedAt: new Date(),
      }
      return jsonResponse(usage(row))
    }),
  )

  // Surface the registered job types for the SPA / docs.
  router.get(
    '/api/jobs/_types',
    requireAuth(async () => {
      return jsonResponse({ types: JOB_TYPES })
    }),
  )
}
