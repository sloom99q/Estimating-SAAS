/**
 * Sprint-10 S10-1 — Founder org-report.
 *
 *   bun apps/api/scripts/org-report.ts
 *
 * Prints the org → projects → data tree so the founder can sanity-check
 * tenancy from the terminal at any time. Counts only — no PII, no
 * business data (per ADR-018). Good for "is the new org slug actually
 * isolated from the demo org's documents?" -style checks.
 */
import { prisma } from '../src/db'

interface OrgRow {
  id: string
  name: string
  slug: string
  members: number
  projects: number
  documents: number
  takeoffItems: number
  boqs: number
}

async function gather(): Promise<OrgRow[]> {
  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: {
          memberships: true,
          projects: true,
          documents: true,
          takeoffItems: true,
          boqs: true,
        },
      },
    },
  })
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    members: o._count.memberships,
    projects: o._count.projects,
    documents: o._count.documents,
    takeoffItems: o._count.takeoffItems,
    boqs: o._count.boqs,
  }))
}

async function main(): Promise<void> {
  const rows = await gather()
  const padPair = (label: string, value: string | number, width = 16): string =>
    `${label}: ${String(value).padEnd(width)}`
  console.log()
  console.log('Platform organizations (slug · counts only — ADR-018 read+provision)')
  console.log('=================================================================')
  if (rows.length === 0) {
    console.log('  (none)')
    process.exit(0)
  }
  for (const o of rows) {
    console.log()
    console.log(`▸ ${o.name} (${o.slug})  id=${o.id}`)
    console.log(
      `   ${padPair('members', o.members, 4)} ${padPair('projects', o.projects, 4)} ${padPair('documents', o.documents, 4)} ${padPair('takeoffItems', o.takeoffItems, 4)} ${padPair('boqs', o.boqs, 4)}`,
    )
    if (o.projects === 0) continue
    const projects = await prisma.project.findMany({
      where: { organizationId: o.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        _count: {
          select: { documents: true, takeoffItems: true, boqs: true, spaces: true },
        },
      },
    })
    for (const p of projects) {
      console.log(
        `     • ${p.name.padEnd(40)}  type=${p.type.padEnd(12)} status=${p.status.padEnd(10)} docs=${p._count.documents}, spaces=${p._count.spaces}, takeoff=${p._count.takeoffItems}, boqs=${p._count.boqs}`,
      )
    }
  }
  console.log()
  process.exit(0)
}

void main()
