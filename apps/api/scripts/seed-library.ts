/**
 * LIB-2 — seed the Material Library with real starter systems.
 *
 * Per-org idempotent seed. Creates:
 *   - Brand "Jotun" (paint)
 *   - Assembly "Standard interior wall paint" (Jotun) with the
 *     6 components from MATERIAL_LIBRARY.md §1 exactly:
 *       1. Primer       drum   65 AED / 100 m²
 *       2. Stucco       bag    55 AED /  40 m² × 2 coats
 *       3. Paint        tin   270 AED /  50 m² × 2 coats
 *       4. Labor        labr    6 AED /   1 m²
 *       5. Roller       set    10 AED / 100 m²
 *       6. Masking tape roll    5 AED /  50 m²
 *     Yields system unit cost 20.40 AED/m². Routes to TakeoffCategory
 *     PAINT (added once QUANTIFY emits PAINT rows in LIB-4).
 *   - Brand "Knauf" (gypsum) — STUB pricing the estimator will confirm
 *   - Assembly "Standard gypsum ceiling" (Knauf, CL01/CL02 defaults)
 *   - "Generic" Brand for non-branded labour/system rows
 *   - Assembly "Standard sand-cement screed"
 *   - Assembly "Standard ceramic tile + adhesive"
 *   - Assembly "Lighting allowance" (P/S system — emits a P/S BoqLine
 *     instead of a priced line, lets the user carry a lump per project)
 *
 * The roller + tape entries use kind=MATERIAL (math identical to
 * coverage-based TOOL — see assemblyEngine.ts comment). The 'kind'
 * field is purely a UI grouping signal.
 *
 * Usage:
 *   bun apps/api/scripts/seed-library.ts                        # dry-run
 *   bun apps/api/scripts/seed-library.ts --apply                # commit
 *   bun apps/api/scripts/seed-library.ts --apply --org <orgId>  # one org
 *
 * Idempotency: re-running this script will NOT duplicate Brands or
 * Assemblies — it looks them up by (org, name) and updates components
 * to match. Edits the estimator makes via the Library UI persist —
 * the seed only writes if the names don't already exist.
 */
import { prisma } from '../src/db'

const apply = process.argv.includes('--apply')
const reseed = process.argv.includes('--reseed')
const orgIdx = process.argv.indexOf('--org')
const orgFilter = orgIdx >= 0 ? process.argv[orgIdx + 1] : null

console.log('[seed-library] mode:', apply ? 'APPLY' : 'dry-run')
if (reseed) console.log('[seed-library] --reseed: existing seeded systems will be REPLACED')
if (orgFilter) console.log('[seed-library] scoped to org:', orgFilter)

const orgs = await prisma.organization.findMany({
  where: orgFilter ? { id: orgFilter } : { deletedAt: null },
  select: { id: true, name: true },
})
console.log(`[seed-library] targeting ${orgs.length} org(s)`)

interface ComponentSpec {
  kind: 'MATERIAL' | 'LABOR' | 'TOOL_FIXED'
  label: string
  unitPrice?: number | null
  coverage?: number | null
  coats?: number
  wastagePct?: number
  fixedCost?: number | null
}

interface SystemSpec {
  brandName: string
  brandCategory: string
  brandWebsite?: string
  systemName: string
  appliesTo: string
  outputUnit: string
  takeoffCategory:
    | 'PAINT'
    | 'CEILING'
    | 'SCREED'
    | 'FLOOR_FINISH'
    | 'WALL_FINISH'
    | 'OTHER'
  defaultForFinishCodes?: string[]
  sortOrder?: number
  notes?: string
  components: ComponentSpec[]
}

const SYSTEMS: SystemSpec[] = [
  // ──────────────────────────────────────────────────────────────
  // Jotun — Standard interior wall paint (the proof system).
  // Numbers verbatim from MATERIAL_LIBRARY.md §1.
  // ──────────────────────────────────────────────────────────────
  {
    brandName: 'Jotun',
    brandCategory: 'paint',
    brandWebsite: 'https://www.jotun.com',
    systemName: 'Standard interior wall paint',
    appliesTo: 'WALL',
    outputUnit: 'm²',
    takeoffCategory: 'PAINT',
    defaultForFinishCodes: [], // applies to ANY paint code
    sortOrder: 100,
    notes:
      'Two-coat stucco + two-coat finish system. ' +
      'Per-m² cost ≈ 13.63 AED on bare wall area. ' +
      'Reading B per estimator verdict: bag/tin coverage already ' +
      'accounts for both coats (40 m² of stucco includes the ' +
      '2-coat build-up, 50 m² of paint same). coats=1 in the ' +
      'engine — multiplying by 2 would double-count. ' +
      'Tools (roller, masking tape) modeled as MATERIAL kind ' +
      'with coverage — same math as TOOL_FIXED amortised, ' +
      'cleaner for per-area billing.',
    components: [
      {
        kind: 'MATERIAL',
        label: 'Primer (drum)',
        unitPrice: 65,
        coverage: 100,
        coats: 1,
        wastagePct: 0,
      },
      {
        kind: 'MATERIAL',
        label: 'Stucco (bag) — 2-coat coverage',
        unitPrice: 55,
        coverage: 40,
        coats: 1,
        wastagePct: 0,
      },
      {
        kind: 'MATERIAL',
        label: 'Top-coat paint (tin) — 2-coat coverage',
        unitPrice: 270,
        coverage: 50,
        coats: 1,
        wastagePct: 0,
      },
      {
        kind: 'LABOR',
        label: 'Painter labour',
        unitPrice: 6,
      },
      {
        kind: 'MATERIAL',
        label: 'Roller set (coverage-modeled tool)',
        unitPrice: 10,
        coverage: 100,
        coats: 1,
        wastagePct: 0,
      },
      {
        kind: 'MATERIAL',
        label: 'Masking tape (coverage-modeled tool)',
        unitPrice: 5,
        coverage: 50,
        coats: 1,
        wastagePct: 0,
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // CEILING / SCREED / FLOOR_FINISH systems INTENTIONALLY ABSENT.
  //
  // BUG-1 (2026-06-25) — earlier this file seeded Knauf CEILING,
  // Generic SCREED, and Generic ceramic tile FLOOR_FINISH "stub"
  // systems. With defaultForFinishCodes=[] (= org "house default"
  // for any code), LIB-5's tier-1 routing picked them up FOR EVERY
  // line in their category — silently overriding the rate-library's
  // real per-code rates (ST01=200, PR01=210, PR03=150, BATHROOM=195,
  // SCREED-FLR=90) with a single stubbed rate (100.56 for floor
  // finishes, 59.19 for screed). User caught it in the XLSX.
  //
  // Real per-code Library systems need to come from the estimator
  // (or the AI market-search feature) with real prices per material
  // and per finish code. Stubbing them in the seed was the wrong
  // call. Until those land, the rate-library handles ST01/PR01/etc
  // correctly — Jotun PAINT remains the only seeded Library system.
]

// ──────────────────────────────────────────────────────────────
// Apply
// ──────────────────────────────────────────────────────────────

let brandsCreated = 0
let brandsSkipped = 0
let systemsCreated = 0
let systemsSkipped = 0
let componentsCreated = 0

for (const org of orgs) {
  console.log('')
  console.log(`── org ${org.id.slice(-6)} — ${org.name}`)
  for (const spec of SYSTEMS) {
    // Brand: upsert by (org, name, category).
    let brand = await prisma.brand.findFirst({
      where: {
        organizationId: org.id,
        name: spec.brandName,
        category: spec.brandCategory,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!brand) {
      console.log(`  + Brand ${spec.brandName} (${spec.brandCategory})`)
      if (apply) {
        brand = await prisma.brand.create({
          data: {
            organizationId: org.id,
            name: spec.brandName,
            category: spec.brandCategory,
            website: spec.brandWebsite ?? null,
            notes: null,
            active: true,
          },
          select: { id: true },
        })
      } else {
        brand = { id: '(dry-run)' }
      }
      brandsCreated += 1
    } else {
      brandsSkipped += 1
    }

    // Assembly: only seed if (org, name) doesn't exist. We never
    // overwrite an estimator's edits — UNLESS --reseed is set, in
    // which case the named seed systems are hard-replaced (used to
    // converge to a new spec without manual delete).
    const existing = await prisma.assembly.findFirst({
      where: { organizationId: org.id, name: spec.systemName, deletedAt: null },
      select: { id: true },
    })
    if (existing) {
      if (!reseed) {
        systemsSkipped += 1
        console.log(`  · System ${spec.systemName} already exists — skipping (pass --reseed to replace)`)
        continue
      }
      console.log(`  ↻ System ${spec.systemName} exists — REPLACING (--reseed)`)
      if (apply) {
        await prisma.$transaction(async (tx) => {
          await tx.assemblyComponent.deleteMany({ where: { assemblyId: existing.id } })
          await tx.assembly.delete({ where: { id: existing.id } })
        })
      }
    }

    console.log(`  + System ${spec.systemName}  [${spec.takeoffCategory}]  ${spec.components.length} components`)
    systemsCreated += 1
    if (!apply) continue

    await prisma.$transaction(async (tx) => {
      const assembly = await tx.assembly.create({
        data: {
          organizationId: org.id,
          name: spec.systemName,
          appliesTo: spec.appliesTo,
          outputUnit: spec.outputUnit,
          brandId: brand!.id === '(dry-run)' ? null : brand!.id,
          takeoffCategory: spec.takeoffCategory,
          defaultForFinishCodes: spec.defaultForFinishCodes ?? [],
          sortOrder: spec.sortOrder ?? 100,
          notes: spec.notes ?? null,
        },
        select: { id: true },
      })
      for (let i = 0; i < spec.components.length; i += 1) {
        const c = spec.components[i]!
        await tx.assemblyComponent.create({
          data: {
            organizationId: org.id,
            assemblyId: assembly.id,
            kind: c.kind,
            label: c.label,
            unitPrice: c.unitPrice ?? null,
            coverage: c.coverage ?? null,
            coats: c.coats ?? 1,
            wastagePct: c.wastagePct ?? 0,
            fixedCost: c.fixedCost ?? null,
            materialId: null,
            sortOrder: i,
          },
        })
        componentsCreated += 1
      }
    })
  }
}

console.log('')
console.log(`[seed-library] summary:`)
console.log(`  brands  : created=${brandsCreated}  skipped=${brandsSkipped}`)
console.log(`  systems : created=${systemsCreated}  skipped=${systemsSkipped}`)
console.log(`  components written: ${componentsCreated}`)
if (!apply && (brandsCreated > 0 || systemsCreated > 0)) {
  console.log('Re-run with --apply to commit.')
}
process.exit(0)
