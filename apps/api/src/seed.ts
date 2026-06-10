import { prisma } from './db'
import { hashPassword } from './utils/auth'

/**
 * Idempotent seed for Phase 8A. Run via `bun src/seed.ts` or `bun run seed`.
 *
 * Creates:
 *   - Organization  "Aurora Fit-Out Co."  (slug aurora-fit-out)
 *   - Admin user    admin@estimator.app / password "estimator"
 *   - Owner membership joining the two
 *   - Demo materials matching the previous in-browser seed
 *   - One reference project, "Marina Heights Penthouse"
 *
 * Safe to re-run: every entity is upserted by stable natural keys.
 */
async function main(): Promise<void> {
  const orgSlug = 'aurora-fit-out'
  const adminEmail = 'admin@estimator.app'
  const adminPassword = 'estimator'

  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    create: {
      name: 'Aurora Fit-Out Co.',
      slug: orgSlug,
      defaultCurrency: 'AED',
    },
    update: {},
  })

  const passwordHash = await hashPassword(adminPassword)
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      fullName: 'Layla Haddad',
      passwordHash,
      isSuperAdmin: false,
    },
    update: {
      // Re-hash on every seed run so changing the seed password in dev works.
      passwordHash,
      fullName: 'Layla Haddad',
    },
  })

  await prisma.membership.upsert({
    where: {
      organizationId_userId: { organizationId: org.id, userId: admin.id },
    },
    create: {
      organizationId: org.id,
      userId: admin.id,
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    },
    update: {
      role: 'owner',
      status: 'active',
    },
  })

  // -- Materials: stable natural key is (organizationId, name). We don't have
  // a composite unique on that, so we look up + insert ourselves to stay
  // idempotent without polluting the schema.
  const desiredMaterials: Array<{
    name: string
    category: string
    unit: string
    unitPrice: number
    coverage: number
    wastePct: number
    supplier: string | null
    notes: string | null
    imageUrl: string | null
    active: boolean
  }> = [
    {
      name: 'Ceramic floor tile — 60×60',
      category: 'tiles',
      unit: 'm2',
      unitPrice: 95,
      coverage: 1,
      wastePct: 10,
      supplier: 'Aurora Stone & Tile',
      notes: null,
      imageUrl:
        'https://images.unsplash.com/photo-1581235720704-06d3acfcb36f?w=640&auto=format&fit=crop&q=80',
      active: true,
    },
    {
      name: 'Carrara marble — polished',
      category: 'marble',
      unit: 'm2',
      unitPrice: 620,
      coverage: 1,
      wastePct: 12,
      supplier: 'Aurora Stone & Tile',
      notes: 'Sealing recommended; check lead time.',
      imageUrl:
        'https://images.unsplash.com/photo-1614142933114-5acd5cd05e15?w=640&auto=format&fit=crop&q=80',
      active: true,
    },
    {
      name: 'Premium wall paint — matt',
      category: 'paint',
      unit: 'bag',
      unitPrice: 240,
      coverage: 28,
      wastePct: 8,
      supplier: 'Jotun Middle East',
      notes: '1 bucket covers ~ 28 m² in two coats.',
      imageUrl:
        'https://images.unsplash.com/photo-1562184552-997c461abbe6?w=640&auto=format&fit=crop&q=80',
      active: true,
    },
    {
      name: 'Ceiling gypsum board — 12 mm',
      category: 'gypsum',
      unit: 'piece',
      unitPrice: 42,
      coverage: 2.88,
      wastePct: 5,
      supplier: 'Gulf Boards Co.',
      notes: null,
      imageUrl:
        'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=640&auto=format&fit=crop&q=80',
      active: true,
    },
    {
      name: 'Tile adhesive',
      category: 'glue',
      unit: 'bag',
      unitPrice: 28,
      coverage: 4.5,
      wastePct: 5,
      supplier: 'Mapei Arabia',
      notes: null,
      imageUrl: null,
      active: true,
    },
    {
      name: 'Tile grout — neutral',
      category: 'grout',
      unit: 'kg',
      unitPrice: 14,
      coverage: 6,
      wastePct: 5,
      supplier: 'Mapei Arabia',
      notes: null,
      imageUrl: null,
      active: true,
    },
    {
      name: 'Walnut wood cladding',
      category: 'cladding',
      unit: 'm2',
      unitPrice: 380,
      coverage: 1,
      wastePct: 8,
      supplier: 'Levant Timber Works',
      notes: null,
      imageUrl:
        'https://images.unsplash.com/photo-1503602642458-232111445657?w=640&auto=format&fit=crop&q=80',
      active: true,
    },
  ]

  for (const m of desiredMaterials) {
    const existing = await prisma.material.findFirst({
      where: { organizationId: org.id, name: m.name },
    })
    if (existing) continue
    await prisma.material.create({
      data: {
        organizationId: org.id,
        name: m.name,
        category: m.category,
        unit: m.unit,
        unitPrice: m.unitPrice,
        coverage: m.coverage,
        wastePct: m.wastePct,
        currency: 'AED',
        supplier: m.supplier,
        notes: m.notes,
        imageUrl: m.imageUrl,
        active: m.active,
      },
    })
  }

  const existingProject = await prisma.project.findFirst({
    where: { organizationId: org.id, name: 'Marina Heights Penthouse' },
  })
  if (!existingProject) {
    await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'Marina Heights Penthouse',
        clientName: 'Hadid Family Office',
        location: 'Dubai Marina, UAE',
        type: 'luxury',
        status: 'active',
      },
    })
  }

  // -- Phase 8B: suppliers, prices, and price-history snapshots ---------------
  // Promote the existing inline material.supplier strings to real Supplier
  // rows. Each material then gets 2-3 supplier prices and ~6 months of
  // snapshot history so the timeline chart paints a real trend on first run.

  const suppliersToSeed: Array<{
    name: string
    country: string | null
    contactName: string | null
    email: string | null
    phone: string | null
    paymentTerms: string | null
    leadTimeDays: number | null
    rating: number | null
    preferred: boolean
    notes: string | null
  }> = [
    {
      name: 'Aurora Stone & Tile',
      country: 'United Arab Emirates',
      contactName: 'Rami Saleh',
      email: 'sales@aurorastone.ae',
      phone: '+971 4 555 0102',
      paymentTerms: 'Net 30',
      leadTimeDays: 10,
      rating: 4.7,
      preferred: true,
      notes: 'Long-standing preferred supplier; flexible on bulk pricing.',
    },
    {
      name: 'Mapei Arabia',
      country: 'United Arab Emirates',
      contactName: 'Hadeel Karam',
      email: 'orders@mapei-arabia.com',
      phone: '+971 4 555 0188',
      paymentTerms: 'Net 45',
      leadTimeDays: 7,
      rating: 4.5,
      preferred: true,
      notes: null,
    },
    {
      name: 'Jotun Middle East',
      country: 'United Arab Emirates',
      contactName: 'Tareq Al-Najjar',
      email: 'projects@jotun.me',
      phone: '+971 6 555 0199',
      paymentTerms: 'Net 30',
      leadTimeDays: 5,
      rating: 4.4,
      preferred: false,
      notes: null,
    },
    {
      name: 'Gulf Boards Co.',
      country: 'Saudi Arabia',
      contactName: 'Mariam Idris',
      email: 'contact@gulfboards.sa',
      phone: '+966 11 555 0107',
      paymentTerms: 'Net 30',
      leadTimeDays: 14,
      rating: 4.1,
      preferred: false,
      notes: null,
    },
    {
      name: 'Levant Timber Works',
      country: 'Lebanon',
      contactName: 'Joseph Nasr',
      email: 'export@levanttimber.com',
      phone: '+961 1 555 0150',
      paymentTerms: 'Net 60',
      leadTimeDays: 21,
      rating: 4.2,
      preferred: false,
      notes: 'Custom millwork available on request.',
    },
    {
      name: 'GenericTrade Co.',
      country: 'United Arab Emirates',
      contactName: null,
      email: 'sales@generictrade.ae',
      phone: null,
      paymentTerms: 'Prepay',
      leadTimeDays: 4,
      rating: 3.6,
      preferred: false,
      notes: 'Cheap, faster, but quality is inconsistent. Use as last resort.',
    },
  ]

  const supplierByName = new Map<string, { id: string }>()
  for (const s of suppliersToSeed) {
    const existing = await prisma.supplier.findFirst({
      where: { organizationId: org.id, name: s.name },
    })
    const row = existing
      ? existing
      : await prisma.supplier.create({
          data: {
            organizationId: org.id,
            name: s.name,
            country: s.country,
            contactName: s.contactName,
            email: s.email,
            phone: s.phone,
            paymentTerms: s.paymentTerms,
            leadTimeDays: s.leadTimeDays,
            rating: s.rating,
            preferred: s.preferred,
            notes: s.notes,
          },
        })
    supplierByName.set(s.name, row)
  }

  // -- Material-supplier price links + 6 months of history --------------------

  /**
   * One row per (material name, supplier name) we want to seed.
   *
   *   - `unitPrice` is the CURRENT (most-recent-snapshot) price
   *   - `monthlyDelta` is added per month going BACKWARDS to fabricate history
   *     (positive = price has been rising; negative = falling)
   *   - The preferred supplier is whichever maps to `material.supplier` in the
   *     existing material rows; it always carries `isPreferred: true`.
   */
  interface PriceSeed {
    materialName: string
    supplierName: string
    unitPrice: number
    minimumOrderQuantity: number | null
    leadTimeDays: number | null
    monthlyDelta: number
    notes: string | null
  }
  const priceSeeds: PriceSeed[] = [
    // Ceramic floor tile — preferred Aurora at AED 95
    {
      materialName: 'Ceramic floor tile — 60×60',
      supplierName: 'Aurora Stone & Tile',
      unitPrice: 95,
      minimumOrderQuantity: 50,
      leadTimeDays: 10,
      monthlyDelta: 1.5,
      notes: null,
    },
    {
      materialName: 'Ceramic floor tile — 60×60',
      supplierName: 'GenericTrade Co.',
      unitPrice: 72,
      minimumOrderQuantity: 100,
      leadTimeDays: 4,
      monthlyDelta: -0.5,
      notes: 'Cheaper but inconsistent batch matching.',
    },
    // Carrara marble — preferred Aurora at AED 620
    {
      materialName: 'Carrara marble — polished',
      supplierName: 'Aurora Stone & Tile',
      unitPrice: 620,
      minimumOrderQuantity: 10,
      leadTimeDays: 14,
      monthlyDelta: 8,
      notes: null,
    },
    {
      materialName: 'Carrara marble — polished',
      supplierName: 'Levant Timber Works',
      unitPrice: 588,
      minimumOrderQuantity: 15,
      leadTimeDays: 28,
      monthlyDelta: 4,
      notes: 'Quarry partner; longer lead time.',
    },
    // Premium wall paint
    {
      materialName: 'Premium wall paint — matt',
      supplierName: 'Jotun Middle East',
      unitPrice: 240,
      minimumOrderQuantity: 10,
      leadTimeDays: 5,
      monthlyDelta: 2,
      notes: null,
    },
    {
      materialName: 'Premium wall paint — matt',
      supplierName: 'GenericTrade Co.',
      unitPrice: 198,
      minimumOrderQuantity: 24,
      leadTimeDays: 4,
      monthlyDelta: -1,
      notes: null,
    },
    // Ceiling gypsum
    {
      materialName: 'Ceiling gypsum board — 12 mm',
      supplierName: 'Gulf Boards Co.',
      unitPrice: 42,
      minimumOrderQuantity: 50,
      leadTimeDays: 14,
      monthlyDelta: 0.4,
      notes: null,
    },
    {
      materialName: 'Ceiling gypsum board — 12 mm',
      supplierName: 'GenericTrade Co.',
      unitPrice: 38,
      minimumOrderQuantity: 100,
      leadTimeDays: 5,
      monthlyDelta: 0.6,
      notes: null,
    },
    // Tile adhesive
    {
      materialName: 'Tile adhesive',
      supplierName: 'Mapei Arabia',
      unitPrice: 28,
      minimumOrderQuantity: 25,
      leadTimeDays: 7,
      monthlyDelta: 0.3,
      notes: null,
    },
    {
      materialName: 'Tile adhesive',
      supplierName: 'Aurora Stone & Tile',
      unitPrice: 31,
      minimumOrderQuantity: 25,
      leadTimeDays: 10,
      monthlyDelta: 0,
      notes: null,
    },
    // Tile grout
    {
      materialName: 'Tile grout — neutral',
      supplierName: 'Mapei Arabia',
      unitPrice: 14,
      minimumOrderQuantity: 20,
      leadTimeDays: 7,
      monthlyDelta: 0.1,
      notes: null,
    },
    // Walnut cladding
    {
      materialName: 'Walnut wood cladding',
      supplierName: 'Levant Timber Works',
      unitPrice: 380,
      minimumOrderQuantity: 20,
      leadTimeDays: 21,
      monthlyDelta: 6,
      notes: null,
    },
  ]

  // Map material.name → id + currency.
  const materials = await prisma.material.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true, supplier: true, currency: true },
  })
  const materialByName = new Map(materials.map((m) => [m.name, m]))

  for (const seed of priceSeeds) {
    const material = materialByName.get(seed.materialName)
    const supplier = supplierByName.get(seed.supplierName)
    if (!material || !supplier) continue

    // Skip if this (material, supplier) pair already has a live link — the
    // seed is idempotent.
    const existingLink = await prisma.materialSupplierPrice.findFirst({
      where: {
        organizationId: org.id,
        materialId: material.id,
        supplierId: supplier.id,
      },
    })
    if (existingLink) continue

    const isPreferred = material.supplier === seed.supplierName
    // Fabricate 7 monthly snapshots ending at "today minus 0 months" so the
    // most recent point is current. Step backwards subtracting `monthlyDelta`
    // each step (so the OLDER prices reflect history without `monthlyDelta`).
    const nowMs = new Date('2026-06-09T09:00:00.000Z').getTime()
    const monthMs = 30 * 24 * 60 * 60 * 1000
    const snapshots: { effectiveDate: Date; price: number }[] = []
    for (let stepsBack = 6; stepsBack >= 0; stepsBack -= 1) {
      const date = new Date(nowMs - stepsBack * monthMs)
      // current price - (stepsBack * monthlyDelta) — older prices show the
      // trend before the most recent value.
      const price = Math.max(0.01, seed.unitPrice - stepsBack * seed.monthlyDelta)
      snapshots.push({ effectiveDate: date, price: Math.round(price * 100) / 100 })
    }
    const newest = snapshots[snapshots.length - 1]!

    await prisma.$transaction([
      prisma.materialSupplierPrice.create({
        data: {
          organizationId: org.id,
          materialId: material.id,
          supplierId: supplier.id,
          unitPrice: newest.price,
          currency: material.currency,
          minimumOrderQuantity: seed.minimumOrderQuantity,
          leadTimeDays: seed.leadTimeDays,
          effectiveDate: newest.effectiveDate,
          isPreferred,
          notes: seed.notes,
        },
      }),
      prisma.priceSnapshot.createMany({
        data: snapshots.map((s) => ({
          organizationId: org.id,
          materialId: material.id,
          supplierId: supplier.id,
          price: s.price,
          currency: material.currency,
          effectiveDate: s.effectiveDate,
        })),
      }),
    ])
  }

  console.log('[seed] ok')
  console.log(`        org       = ${org.slug}`)
  console.log(`        login as  = ${adminEmail}`)
  console.log(`        password  = ${adminPassword}`)
  console.log(`        suppliers = ${suppliersToSeed.length}`)
  console.log(`        prices    = ${priceSeeds.length}`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('[seed] failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
