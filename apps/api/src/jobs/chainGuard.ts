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
  reason:
    | 'skipped-already-done'
    | 'skipped-already-active'
    | 'enqueued'
    | 'enqueued-forced'
  jobId?: string
}

export type ChainSkipReason =
  | 'skipped-already-done'
  | 'skipped-already-active'
  | 'enqueued'
  | 'enqueued-forced'

export async function enqueueIfNotDone(args: ChainEnqueueArgs): Promise<ChainEnqueueResult> {
  if (!args.force) {
    // PB-3: an existing DONE job blocks re-enqueue. So does an existing
    // QUEUED or RUNNING peer — the prior implementation checked DONE
    // only, which let two CLASSIFY jobs both enqueue LEGEND when they
    // finished within ~1 s of each other (the doc=cmqbjk… double-chain).
    // Now any active or completed peer of the same (documentId, type)
    // shuts the chain handoff down.
    const peer = await args.client.job.findFirst({
      where: {
        organizationId: args.organizationId,
        projectId: args.projectId,
        type: args.type,
        status: { in: ['DONE', 'QUEUED', 'RUNNING'] },
        payload: { path: ['documentId'], equals: args.documentId },
      },
      select: { id: true, status: true },
    })
    if (peer) {
      return {
        enqueued: false,
        reason: peer.status === 'DONE' ? 'skipped-already-done' : 'skipped-already-active',
      }
    }
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
