/**
 * Founder-only org wipe — clears all project / pipeline data for a given
 * organization so a fresh demo upload starts from zero.
 *
 *   bun apps/api/scripts/reset-org-projects.ts <orgIdOrSlug> [--dry-run] [--confirm]
 *
 * KEPT:  Organization · User · Membership · Material / Supplier / Price /
 *        PriceSnapshot · RateLibraryItem · Assembly / AssemblyComponent
 *
 * WIPED: Project · Space · Document · Sheet · TakeoffItem · ValidationFlag ·
 *        Correction · Boq / BoqSection / BoqLine · Quotation · Job
 *
 * Usage counters on the org are reset to zero so post-wipe metrics don't
 * carry forward pre-demo token spend.
 *
 * Safety:
 *   - prints a count summary of what WILL be deleted
 *   - aborts unless --confirm is passed
 *   - --dry-run prints the plan and exits without touching the DB
 *
 * This script is deliberately the only place in the codebase that issues
 * tenant-scoped DELETEs across the takeoff pipeline. Do not call from a
 * handler, route, or job — it's a CLI artefact for the founder.
 */
import { prisma } from '../src/db'

interface CountSummary {
  projects: number
  spaces: number
  documents: number
  sheets: number
  takeoffItems: number
  validationFlags: number
  corrections: number
  boqs: number
  boqSections: number
  boqLines: number
  quotations: number
  jobs: number
}

async function countForOrg(organizationId: string): Promise<CountSummary> {
  const [
    projects,
    spaces,
    documents,
    sheets,
    takeoffItems,
    validationFlags,
    corrections,
    boqs,
    boqSections,
    boqLines,
    quotations,
    jobs,
  ] = await Promise.all([
    prisma.project.count({ where: { organizationId } }),
    prisma.space.count({ where: { organizationId } }),
    prisma.document.count({ where: { organizationId } }),
    prisma.sheet.count({ where: { organizationId } }),
    prisma.takeoffItem.count({ where: { organizationId } }),
    prisma.validationFlag.count({ where: { organizationId } }),
    prisma.correction.count({ where: { organizationId } }),
    prisma.boq.count({ where: { organizationId } }),
    prisma.boqSection.count({ where: { organizationId } }),
    prisma.boqLine.count({ where: { organizationId } }),
    prisma.quotation.count({ where: { organizationId } }),
    prisma.job.count({ where: { organizationId } }),
  ])
  return {
    projects,
    spaces,
    documents,
    sheets,
    takeoffItems,
    validationFlags,
    corrections,
    boqs,
    boqSections,
    boqLines,
    quotations,
    jobs,
  }
}

async function resolveOrg(arg: string): Promise<{ id: string; name: string; slug: string }> {
  const byId = await prisma.organization.findUnique({
    where: { id: arg },
    select: { id: true, name: true, slug: true },
  })
  if (byId) return byId
  const bySlug = await prisma.organization.findUnique({
    where: { slug: arg },
    select: { id: true, name: true, slug: true },
  })
  if (bySlug) return bySlug
  throw new Error(`No organization matched id-or-slug "${arg}".`)
}

async function wipe(organizationId: string): Promise<void> {
  // Order matters: children before parents (no onDelete: Cascade in schema).
  await prisma.$transaction(
    async (tx) => {
      // Pipeline residue.
      await tx.boqLine.deleteMany({ where: { organizationId } })
      await tx.boqSection.deleteMany({ where: { organizationId } })
      await tx.quotation.deleteMany({ where: { organizationId } })
      await tx.boq.deleteMany({ where: { organizationId } })
      await tx.validationFlag.deleteMany({ where: { organizationId } })
      await tx.correction.deleteMany({ where: { organizationId } })
      await tx.takeoffItem.deleteMany({ where: { organizationId } })
      await tx.sheet.deleteMany({ where: { organizationId } })
      await tx.document.deleteMany({ where: { organizationId } })
      await tx.job.deleteMany({ where: { organizationId } })
      await tx.space.deleteMany({ where: { organizationId } })
      await tx.project.deleteMany({ where: { organizationId } })
      // Reset org-level token / job tallies (one row per org).
      await tx.usage.updateMany({
        where: { organizationId },
        data: { pagesProcessed: 0, jobsRun: 0, jobsFailed: 0, tokensIn: 0, tokensOut: 0 },
      })
    },
    { timeout: 120_000 },
  )
}

function fmtSummary(s: CountSummary): string {
  const rows: Array<[string, number]> = [
    ['Projects', s.projects],
    ['Spaces', s.spaces],
    ['Documents', s.documents],
    ['Sheets', s.sheets],
    ['Takeoff items', s.takeoffItems],
    ['Validation flags', s.validationFlags],
    ['Corrections', s.corrections],
    ['BOQs', s.boqs],
    ['BOQ sections', s.boqSections],
    ['BOQ lines', s.boqLines],
    ['Quotations', s.quotations],
    ['Jobs', s.jobs],
  ]
  const w = Math.max(...rows.map(([k]) => k.length))
  return rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v.toString().padStart(8)}`).join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const orgArg = args.find((a) => !a.startsWith('--'))
  const dryRun = args.includes('--dry-run')
  const confirm = args.includes('--confirm')
  if (!orgArg) {
    console.error('Usage: bun apps/api/scripts/reset-org-projects.ts <orgIdOrSlug> [--dry-run] [--confirm]')
    process.exit(2)
  }
  const org = await resolveOrg(orgArg)
  const before = await countForOrg(org.id)
  console.log('')
  console.log(`Org: ${org.name} (slug=${org.slug}, id=${org.id})`)
  console.log('Will delete:')
  console.log(fmtSummary(before))
  console.log('Will KEEP: users, members, materials, suppliers, prices, rate library, assemblies.')
  console.log('')

  if (dryRun) {
    console.log('Dry run — no rows touched. Re-run with --confirm to execute.')
    return
  }
  if (!confirm) {
    console.log('Add --confirm to execute, or --dry-run to preview.')
    return
  }

  const t0 = Date.now()
  await wipe(org.id)
  const ms = Date.now() - t0

  const after = await countForOrg(org.id)
  console.log(`Wipe complete in ${ms} ms. Post-wipe counts:`)
  console.log(fmtSummary(after))
  const anyLeft = Object.values(after).some((v) => v > 0)
  if (anyLeft) {
    console.error('WARNING: some rows survived the wipe. Inspect manually before re-uploading.')
    process.exit(1)
  }
  console.log('All clear — ready for a fresh demo upload.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
