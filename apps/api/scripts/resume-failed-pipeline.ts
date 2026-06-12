/**
 * Sprint-10 PA-3 — resume a pipeline whose CLASSIFY (or any stage) died
 * mid-run. Re-enqueues only the FAILED stage; downstream stages chain
 * automatically per the standing idempotency rule (handlers UPSERT by
 * natural key, chainGuard skips already-DONE stages with force=false).
 *
 *   bun apps/api/scripts/resume-failed-pipeline.ts <documentId>
 *
 * Prints the booted key last-4 first so the operator can confirm the
 * worker will use the new key before token spend kicks off.
 */
import { config } from '../src/config'
import { prisma } from '../src/db'

const PIPELINE_TYPES = [
  'INGEST',
  'CLASSIFY',
  'EXTRACT_FINISH_LEGEND',
  'EXTRACT_SCHEDULES',
  'EXTRACT_ROOMS',
] as const

const docId = process.argv[2]
if (!docId) {
  console.error('usage: bun apps/api/scripts/resume-failed-pipeline.ts <documentId>')
  process.exit(2)
}

console.log('[resume] booted key last4:', config.anthropicApiKey.slice(-4))
console.log('[resume] booted AI_MODE:', config.aiMode)
console.log('[resume] document:', docId)

const doc = await prisma.document.findUnique({
  where: { id: docId },
  select: { id: true, projectId: true, organizationId: true, status: true },
})
if (!doc) {
  console.error('[resume] document not found')
  process.exit(2)
}

const jobs = await prisma.job.findMany({
  where: { payload: { path: ['documentId'], equals: docId } },
  orderBy: { createdAt: 'asc' },
  select: { id: true, type: true, status: true, attempts: true },
})
console.log('[resume] existing jobs:')
for (const j of jobs) console.log(' ', j.type.padEnd(24), j.status.padEnd(10), 'a='+j.attempts)

const firstFailedIdx = PIPELINE_TYPES.findIndex((t) => {
  const last = [...jobs].reverse().find((j) => j.type === t)
  return last?.status === 'FAILED'
})
if (firstFailedIdx < 0) {
  console.log('[resume] no FAILED stage in the canonical chain — nothing to do')
  process.exit(0)
}
const resumeType = PIPELINE_TYPES[firstFailedIdx]!
console.log('[resume] re-enqueueing', resumeType)
const fresh = await prisma.job.create({
  data: {
    organizationId: doc.organizationId,
    projectId: doc.projectId,
    type: resumeType,
    payload: { documentId: docId } as object,
  },
})
console.log('[resume] new job id:', fresh.id)
console.log('[resume] worker will pick it up on next tick. Watch with:')
console.log('  bun -e "import {prisma} from \\".//src/db\\";const j = await prisma.job.findUnique({where:{id:\\"' + fresh.id + '\\"}});console.log(j?.status,j?.error?.slice(0,200))"')
process.exit(0)
