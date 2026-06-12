/**
 * Sprint-7 S7-1: chain handoff no-op guard.
 *
 * Wrapper around `prisma.job.create` used by every pipeline stage that
 * enqueues its successor. If a successful (status='DONE') job of the same
 * type for the same document already exists, skip the new enqueue —
 * unless `force` is set, in which case enqueue anyway (the operator is
 * deliberately re-running).
 *
 * Prevents the Sprint-6 'LEGEND retry chains a fresh SCHEDULES that
 * doubles every door' failure mode. A re-trigger of LEGEND will still
 * land idempotently against existing DONE downstream jobs.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

export interface ChainEnqueueArgs {
  client: Pick<PrismaClient, 'job'>
  organizationId: string
  projectId: string
  type: string
  documentId: string
  /** Extra payload fields beyond { documentId, force? }. */
  extraPayload?: Record<string, unknown>
  force?: boolean
}

export interface ChainEnqueueResult {
  enqueued: boolean
  reason: 'skipped-already-done' | 'enqueued' | 'enqueued-forced'
  jobId?: string
}

export async function enqueueIfNotDone(args: ChainEnqueueArgs): Promise<ChainEnqueueResult> {
  if (!args.force) {
    const existingDone = await args.client.job.findFirst({
      where: {
        organizationId: args.organizationId,
        projectId: args.projectId,
        type: args.type,
        status: 'DONE',
        payload: { path: ['documentId'], equals: args.documentId },
      },
      select: { id: true },
    })
    if (existingDone) return { enqueued: false, reason: 'skipped-already-done' }
  }
  const payload: Prisma.JsonObject = {
    documentId: args.documentId,
    ...(args.extraPayload ?? {}),
  }
  if (args.force) payload.force = true
  const job = await args.client.job.create({
    data: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      type: args.type,
      payload,
    },
  })
  return {
    enqueued: true,
    reason: args.force ? 'enqueued-forced' : 'enqueued',
    jobId: job.id,
  }
}
