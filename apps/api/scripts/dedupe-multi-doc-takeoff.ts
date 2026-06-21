/**
 * MULTI-DOC #3 — one-shot dedupe for projects that already accumulated
 * cross-doc duplicate DOOR / WINDOW / AREA_STATEMENT rows from the
 * pre-fix EXTRACT_* handlers.
 *
 * Bug shape (now fixed in the handlers):
 *   - extractSchedules.ts used to scope its natural-key lookup to a
 *     single document, so D01 in doc-A and D01 in doc-B created two
 *     rows. BOQ pricing then counted that door twice.
 *   - extractRooms.ts's cross-sheet dedup loop fetched category='ROOM'
 *     only, so AREA_STATEMENT ("Proposed Villa", "PLAN AREA — GF",
 *     roof labels) accumulated 1 row per sheet × per doc.
 *
 * Rules (per user verdict 2026-06-21):
 *   - DOOR / WINDOW: key = (project, category, tag).
 *     Survivor = newest createdAt; losers soft-deleted.
 *   - AREA_STATEMENT: key = (project, upper-cased trimmed description).
 *     "PLAN AREA — GF" vs "PLAN AREA — FF" stay distinct (description
 *     differs). Survivor = newest createdAt; losers soft-deleted.
 *   - ROOM: already deduped correctly by the cross-sheet loop;
 *     skipped here.
 *
 * Usage:
 *   bun apps/api/scripts/dedupe-multi-doc-takeoff.ts                  # dry-run all projects
 *   bun apps/api/scripts/dedupe-multi-doc-takeoff.ts --apply          # commit
 *   bun apps/api/scripts/dedupe-multi-doc-takeoff.ts --project <id>   # scope
 *
 * Dry-run is the default. Run once dry, eyeball the report, then re-run
 * with --apply.
 */
import { prisma } from '../src/db'

type Cat = 'DOOR' | 'WINDOW' | 'AREA_STATEMENT'
const CATS: Cat[] = ['DOOR', 'WINDOW', 'AREA_STATEMENT']

const apply = process.argv.includes('--apply')
const projectIdx = process.argv.indexOf('--project')
const projectFilter = projectIdx >= 0 ? process.argv[projectIdx + 1] : null

console.log('[dedupe] mode:', apply ? 'APPLY' : 'dry-run')
if (projectFilter) console.log('[dedupe] scoped to project:', projectFilter)

const projects = await prisma.project.findMany({
  where: projectFilter
    ? { id: projectFilter, deletedAt: null }
    : { deletedAt: null },
  select: { id: true, name: true },
  orderBy: { createdAt: 'asc' },
})
console.log(`[dedupe] scanning ${projects.length} project(s)`)

let totalDeleted = 0

for (const project of projects) {
  const items = await prisma.takeoffItem.findMany({
    where: {
      projectId: project.id,
      category: { in: CATS },
      deletedAt: null,
    },
    select: {
      id: true,
      category: true,
      tag: true,
      description: true,
      createdAt: true,
      sourceSheet: { select: { documentId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  if (items.length === 0) continue

  const groups = new Map<string, typeof items>()
  for (const i of items) {
    const cat = i.category as Cat
    const subkey =
      cat === 'AREA_STATEMENT'
        ? (i.description ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
        : (i.tag ?? '__NO_TAG__')
    if (!subkey) continue
    const key = `${cat}|${subkey}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(i)
  }

  const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1)
  if (dupGroups.length === 0) continue

  console.log('')
  console.log(`=== project ${project.id} (${project.name ?? '(no name)'}) ===`)
  let perProjectDeleted = 0

  for (const [key, arr] of dupGroups.sort((a, b) => a[0].localeCompare(b[0]))) {
    // Newest-wins: latest createdAt survives; older rows soft-deleted.
    const sorted = arr.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const survivor = sorted[0]!
    const losers = sorted.slice(1)
    perProjectDeleted += losers.length
    const label = key.length > 70 ? key.slice(0, 67) + '...' : key
    console.log(
      `  ${label.padEnd(70)} keep=${survivor.id.slice(-6)} (${survivor.createdAt.toISOString().slice(11, 19)})  drop=${losers.length}`,
    )
    if (apply) {
      await prisma.takeoffItem.updateMany({
        where: { id: { in: losers.map((l) => l.id) } },
        data: { deletedAt: new Date() },
      })
    }
  }

  console.log(`  --- project subtotal: ${perProjectDeleted} row(s) ${apply ? 'soft-deleted' : 'would be soft-deleted'} ---`)
  totalDeleted += perProjectDeleted
}

console.log('')
console.log(`[dedupe] grand total: ${totalDeleted} row(s) ${apply ? 'soft-deleted' : 'would be soft-deleted'}`)
if (!apply && totalDeleted > 0) {
  console.log('Re-run with --apply to commit.')
}
process.exit(0)
