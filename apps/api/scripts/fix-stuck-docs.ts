/**
 * MULTI-DOC #2 — backfill for the stuck-gate bug.
 *
 * Symptom: Document.status='PROCESSING' forever because the underlying
 * pipeline job crashed before the runner-level FAILED-mirror landed
 * (see apps/api/src/jobs/runner.ts → markDocumentFailedIfPipeline).
 * The multi-doc GenerateBoqCard gate releases on (READY | FAILED), so
 * stuck-at-PROCESSING permanently blocks Re-run BOQ.
 *
 * Usage:
 *   bun apps/api/scripts/fix-stuck-docs.ts          # dry-run (default)
 *   bun apps/api/scripts/fix-stuck-docs.ts --apply  # actually flip rows
 *   bun apps/api/scripts/fix-stuck-docs.ts --project <projectId>  # scope
 *
 * A doc is considered "stuck" when:
 *   - status is PROCESSING (not READY, not FAILED, not UPLOADED)
 *   - at least one of its pipeline jobs is FAILED
 *   - it has NO QUEUED or RUNNING pipeline job (nothing alive to
 *     advance it)
 *
 * UPLOADED docs with zero jobs are left alone — those are pre-INGEST
 * stubs the user may still be uploading; we don't want to race the
 * very first INGEST enqueue.
 */
import { prisma } from '../src/db'

const PIPELINE_TYPES = [
  'INGEST',
  'CLASSIFY',
  'EXTRACT_FINISH_LEGEND',
  'EXTRACT_SCHEDULES',
  'EXTRACT_ROOMS',
] as const

const apply = process.argv.includes('--apply')
const projectIdx = process.argv.indexOf('--project')
const projectId = projectIdx >= 0 ? process.argv[projectIdx + 1] : null

console.log('[fix-stuck-docs] mode:', apply ? 'APPLY' : 'dry-run')
if (projectId) console.log('[fix-stuck-docs] scoped to project:', projectId)

const where = projectId
  ? { status: 'PROCESSING' as const, projectId, deletedAt: null }
  : { status: 'PROCESSING' as const, deletedAt: null }

const docs = await prisma.document.findMany({
  where,
  select: {
    id: true,
    projectId: true,
    organizationId: true,
    filename: true,
    status: true,
    updatedAt: true,
  },
  orderBy: { updatedAt: 'asc' },
})
console.log(`[fix-stuck-docs] found ${docs.length} PROCESSING docs`)
if (docs.length === 0) {
  process.exit(0)
}

let flipped = 0
let stillAlive = 0
let noFailedJob = 0

for (const doc of docs) {
  const jobs = await prisma.job.findMany({
    where: {
      payload: { path: ['documentId'], equals: doc.id },
      type: { in: [...PIPELINE_TYPES] },
    },
    select: { type: true, status: true, error: true, finishedAt: true },
    orderBy: { createdAt: 'desc' },
  })
  const hasFailed = jobs.some((j) => j.status === 'FAILED')
  const hasAlive = jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING')
  const firstFailed = jobs.find((j) => j.status === 'FAILED')

  if (hasAlive) {
    stillAlive += 1
    console.log(
      `  alive    ${doc.id} (${doc.filename}) — has ${jobs.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length} live job(s), leaving alone`,
    )
    continue
  }
  if (!hasFailed) {
    noFailedJob += 1
    console.log(
      `  no-fail  ${doc.id} (${doc.filename}) — no FAILED job, status looks like a crash before any job ran; leaving alone (run resume-failed-pipeline if needed)`,
    )
    continue
  }

  flipped += 1
  const reason = firstFailed?.error?.slice(0, 140) ?? 'unknown'
  console.log(
    `  FLIP     ${doc.id} (${doc.filename}) — ${firstFailed?.type} FAILED: ${reason}`,
  )
  if (apply) {
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'FAILED' },
    })
  }
}

console.log('')
console.log(`[fix-stuck-docs] summary:`)
console.log(`  flipped to FAILED   : ${flipped}`)
console.log(`  left (still alive)  : ${stillAlive}`)
console.log(`  left (no failed job): ${noFailedJob}`)
if (!apply && flipped > 0) {
  console.log('')
  console.log('Re-run with --apply to commit the flips.')
}
process.exit(0)
