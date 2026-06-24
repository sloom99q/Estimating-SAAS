/**
 * DXF-BLOCK-1 — backfill for cancelled / unmapped DXF uploads.
 *
 * Symptom: user dragged 50 DXFs in, the LayerMapModal opened for
 * each (or for the first few), they cancelled the ones that weren't
 * floor plans, and now those docs sit at Document.status='UPLOADED'
 * forever with no PARSE_DXF job ever enqueued. The multi-doc gate
 * waits on (READY | FAILED) and never releases — BOQ generation
 * blocked.
 *
 * Fix here: anything that's a DXF (storageKey ends `.dxf`), in
 * UPLOADED status, with no QUEUED / RUNNING / DONE / FAILED
 * PARSE_DXF job, gets flipped to a new pseudo-status `SKIPPED`.
 * The SPA gate ignores SKIPPED the same way it ignores FAILED.
 *
 * Document.status is a String column, no enum migration needed —
 * 'SKIPPED' is just a new well-known value.
 *
 * Usage:
 *   bun apps/api/scripts/fix-stuck-dxf-docs.ts                   # dry-run all projects
 *   bun apps/api/scripts/fix-stuck-dxf-docs.ts --apply           # commit
 *   bun apps/api/scripts/fix-stuck-dxf-docs.ts --project <id>    # scope
 */
import { prisma } from '../src/db'

const apply = process.argv.includes('--apply')
const projectIdx = process.argv.indexOf('--project')
const projectFilter = projectIdx >= 0 ? process.argv[projectIdx + 1] : null

console.log('[fix-stuck-dxf] mode:', apply ? 'APPLY' : 'dry-run')
if (projectFilter) console.log('[fix-stuck-dxf] scoped to project:', projectFilter)

const where: { status: string; deletedAt: null; projectId?: string } = {
  status: 'UPLOADED',
  deletedAt: null,
}
if (projectFilter) where.projectId = projectFilter

const candidates = await prisma.document.findMany({
  where: {
    ...where,
    // Magic-byte sniff would be more accurate, but storageKey suffix
    // is what we already use as a convention and is index-friendly.
    OR: [
      { storageKey: { endsWith: '.dxf' } },
      { filename: { endsWith: '.dxf', mode: 'insensitive' } },
    ],
  },
  select: { id: true, projectId: true, filename: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
console.log(`[fix-stuck-dxf] found ${candidates.length} DXF docs in UPLOADED status`)

let flipped = 0
let haveLiveJob = 0

for (const doc of candidates) {
  const job = await prisma.job.findFirst({
    where: {
      type: 'PARSE_DXF',
      payload: { path: ['documentId'], equals: doc.id },
    },
    select: { id: true, status: true },
  })
  if (job) {
    haveLiveJob += 1
    console.log(
      `  alive   ${doc.id.slice(-8)} (${doc.filename}) — has PARSE_DXF (${job.status}), leaving alone`,
    )
    continue
  }
  flipped += 1
  console.log(`  SKIP    ${doc.id.slice(-8)} (${doc.filename}) — never had PARSE_DXF → SKIPPED`)
  if (apply) {
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'SKIPPED' },
    })
  }
}

console.log('')
console.log(`[fix-stuck-dxf] summary:`)
console.log(`  would flip to SKIPPED  : ${flipped}`)
console.log(`  left (have a job)      : ${haveLiveJob}`)
if (!apply && flipped > 0) {
  console.log('Re-run with --apply to commit.')
}
process.exit(0)
