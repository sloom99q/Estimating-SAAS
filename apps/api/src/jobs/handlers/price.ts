/**
 * PRICE — Sprint 3.
 *
 *   payload = { boqId }
 *
 * Walks every BoqLine in the target BOQ and applies the §4.7 / ADR-009 rate
 * waterfall, recording `rateSource` on EVERY line:
 *
 *   1. org Assembly match (by `appliesTo` ↔ line category) → use computed
 *      unitCost. Source: 'assembly:<id>'.
 *   2. MaterialSupplierPrice WHERE isPreferred=true → use unitPrice. Source:
 *      'supplier-preferred:<id>'. (Requires a Material linkage on the line;
 *      Sprint 3 has no such linkage from takeoff yet — wired as no-op.)
 *   3. Cheapest current MaterialSupplierPrice.unitPrice → 'supplier-cheap:<id>'.
 *      Same caveat as 2.
 *   4. org RateLibraryItem (organizationId = ctx.org) → 'rate-library:org:<code>'.
 *   5. global RateLibraryItem (organizationId IS NULL) → 'rate-library:global:<code>'.
 *   6. Mark P/S (isProvisional=true, psAmount=0). Source: 'provisional-sum'.
 *
 * Recomputes amount = qty × rate (P/S lines get amount=0, psAmount=0; the
 * commercial team enters the carry manually).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../db'
import { computeAssemblyUnitCost } from '../../pricing/assemblyEngine'
import type { JobHandler, JobRecord } from '../types'

interface PricePayload {
  boqId: string
}

/**
 * Category → rate-library code mapping. Best-effort heuristic until Sprint 4
 * adds a finer per-takeoff-item linkage. When the mapping returns null, the
 * waterfall falls through to P/S.
 */
function rateCodeFor(line: { description: string; unit: string }, category: string): string | null {
  const desc = line.description.toLowerCase()
  switch (category) {
    case 'FLOOR_FINISH':
      if (desc.includes('porcelain')) return 'porcelain-anti-slip'
      if (desc.includes('marble')) return 'marble-polished'
      return 'ceramic-tile-600'
    case 'WALL_FINISH':
    case 'PAINT':
      return 'paint-emulsion-2coat'
    case 'CEILING':
      return 'gypsum-ceiling-frame'
    case 'SCREED':
      // Note: QUANTIFY parks skirting in SCREED category until the enum has
      // its own SKIRTING value. Map by unit hint.
      if (line.unit === 'm') return 'skirting-mdf-100'
      return 'screed-cement-25'
    case 'PLASTER':
      return 'plaster-internal'
    case 'WATERPROOFING':
      return 'waterproofing-membrane'
    case 'BLOCKWORK':
      return null
    case 'DOOR':
      return desc.includes('double') ? 'door-double-supply-install' : 'door-single-supply-install'
    case 'WINDOW':
      return 'curtain-wall-aluminium-m2'
    case 'METAL':
      return 'mild-steel-handrail'
    case 'GRC':
      return null
    case 'JOINERY':
      return 'veneer-joinery-m2'
    case 'SANITARY':
      return null
    case 'EXTERNAL':
      return 'interlock-paving-60'
    case 'STRUCTURE_PROV':
      return 'structure-allowance-m2'
    case 'MEP_PROV':
      return 'mep-allowance-m2'
    case 'ROOM':
    case 'OTHER':
    default:
      return null
  }
}

function appliesToForCategory(category: string): 'WALL' | 'FLOOR' | 'CEILING' | 'GENERIC' | null {
  if (category === 'WALL_FINISH' || category === 'PAINT' || category === 'PLASTER') return 'WALL'
  if (category === 'FLOOR_FINISH' || category === 'SCREED') return 'FLOOR'
  if (category === 'CEILING') return 'CEILING'
  return null
}

// Sprint-4 S4-6: the previous per-line `findMatchingAssembly` and `findRate`
// helpers were replaced by batched in-memory map lookups inside the handler
// (assembliesByApplies + rateByCode). The Sprint-3 PRICE run died after 80s
// of sequential round-trips against Neon's pooler — this rewrite collapses
// those to four upfront reads + one write per chunk.

export const priceHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as PricePayload
  if (!payload.boqId) throw new Error('PRICE: payload.boqId required')

  // Sprint-4 S4-6: single batched read of EVERYTHING the handler will need,
  // then in-memory pricing, then chunked writes in `$transaction` blocks of
  // CHUNK_SIZE. The Sprint-3 P1017 connection drop happened because the
  // per-line round-trip held the pooled connection for 80+ seconds.
  const CHUNK_SIZE = 50

  const [boq, takeoffItems, assemblies, rateLibrary] = await Promise.all([
    prisma.boq.findFirst({
      where: { id: payload.boqId, organizationId: job.organizationId, deletedAt: null },
      include: {
        sections: { include: { lines: { orderBy: { sortOrder: 'asc' } } } },
      },
    }),
    prisma.takeoffItem.findMany({
      where: { organizationId: job.organizationId, deletedAt: null },
      select: { id: true, category: true },
    }),
    prisma.assembly.findMany({
      where: { organizationId: job.organizationId, deletedAt: null },
      include: { components: { orderBy: { sortOrder: 'asc' } } },
    }),
    prisma.rateLibraryItem.findMany({
      where: {
        AND: [
          { OR: [{ organizationId: job.organizationId }, { organizationId: null }] },
          { deletedAt: null, region: 'SHJ' },
        ],
      },
    }),
  ])
  if (!boq) throw new Error(`PRICE: boq ${payload.boqId} not found`)

  // Index the cached reference data for O(1) lookups.
  const categoryByTakeoffId = new Map(takeoffItems.map((t) => [t.id, t.category]))
  // ADR-014: rate lookup now keys on (code, unit). Two rates with the same
  // code but different units (e.g. ceramic-tile-m2 vs ceramic-tile-nr) live
  // alongside each other. The line's `unit` must match.
  const rateByCode = new Map<
    string,
    { rate: Prisma.Decimal; unit: string; isGlobal: boolean }
  >()
  for (const r of rateLibrary) {
    const existing = rateByCode.get(r.code)
    if (!existing || (existing.isGlobal && r.organizationId !== null)) {
      rateByCode.set(r.code, { rate: r.rate, unit: r.unit, isGlobal: r.organizationId === null })
    }
  }
  const assembliesByApplies = new Map<string, typeof assemblies>()
  for (const a of assemblies) {
    const k = a.appliesTo
    const bucket = assembliesByApplies.get(k)
    if (bucket) bucket.push(a)
    else assembliesByApplies.set(k, [a])
  }
  const unitsMatch = (a: string | null | undefined, b: string | null | undefined) => {
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
    return norm(a) === norm(b)
  }

  interface PendingUpdate {
    id: string
    sectionId: string
    rate: Prisma.Decimal | null
    rateSource: string | null
    amount: Prisma.Decimal
    isProvisional: boolean
  }
  const pending: PendingUpdate[] = []
  let pricedLines = 0
  let provisionalLines = 0
  let totalSubtotal = new Prisma.Decimal(0)
  let totalProvisional = new Prisma.Decimal(0)
  const sectionSubtotals = new Map<string, Prisma.Decimal>()

  for (const section of boq.sections) {
    let sectionSubtotal = new Prisma.Decimal(0)
    for (const line of section.lines) {
      const category = line.takeoffItemId
        ? categoryByTakeoffId.get(line.takeoffItemId) ?? 'OTHER'
        : 'OTHER'

      let rate: Prisma.Decimal | null = null
      let rateSource: string | null = null

      // Tier 1 — Assembly match (in-memory). ADR-014: assembly.outputUnit
      // must equal line.unit. A WALL assembly with outputUnit='m²' cannot
      // price a window line with unit='nr'.
      const appliesTo = appliesToForCategory(category)
      if (appliesTo) {
        const candidates = (assembliesByApplies.get(appliesTo) ?? [])
          .concat(assembliesByApplies.get('GENERIC') ?? [])
          .filter((a) => unitsMatch(a.outputUnit, line.unit))
        if (candidates.length === 1) {
          const a = candidates[0]!
          const cost = computeAssemblyUnitCost(
            a.components.map((c) => ({
              kind: c.kind as 'MATERIAL' | 'LABOR' | 'TOOL_FIXED',
              label: c.label,
              unitPrice: c.unitPrice,
              coverage: c.coverage,
              coats: c.coats,
              wastagePct: c.wastagePct,
              fixedCost: c.fixedCost,
            })),
          )
          rate = cost.unitCost
          rateSource = `assembly:${a.id}`
        }
      }

      // Tiers 2-3: supplier prices — Sprint 4 no-op (no takeoff→Material
      // link). When wired (Sprint 6+) ADR-014 applies: the supplier price's
      // material.unit must equal line.unit.

      // Tiers 4-5: rate library. ADR-014: found.unit must equal line.unit.
      if (rate === null) {
        const code = rateCodeFor(line, category)
        if (code) {
          const found = rateByCode.get(code)
          if (found && unitsMatch(found.unit, line.unit)) {
            rate = found.rate
            rateSource = `rate-library:${found.isGlobal ? 'global' : 'org'}:${code}`
          }
        }
      }

      const isProvisional = rate === null
      if (isProvisional) rateSource = 'provisional-sum'
      const qty = line.qty ?? new Prisma.Decimal(0)
      const amount = isProvisional ? new Prisma.Decimal(0) : qty.times(rate!)
      if (rate !== null) pricedLines += 1
      if (isProvisional) provisionalLines += 1

      pending.push({
        id: line.id,
        sectionId: section.id,
        rate,
        rateSource,
        amount,
        isProvisional,
      })

      sectionSubtotal = sectionSubtotal.plus(amount)
      if (isProvisional) {
        totalProvisional = totalProvisional.plus(line.psAmount ?? 0)
      }
    }
    sectionSubtotals.set(section.id, sectionSubtotal)
    totalSubtotal = totalSubtotal.plus(sectionSubtotal)
  }

  // S4-6: chunked transactional writes. Each chunk completes within Neon's
  // pooler idle window even at 200+ lines.
  // ADR-014: P/S lines get psAmount = null (not zero). Null renders as '—'
  // in the XLSX and tells the commercial team "enter the carry value here."
  // Zero looks deceptively tidy and was masking missing inputs.
  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    const chunk = pending.slice(i, i + CHUNK_SIZE)
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.boqLine.update({
          where: { id: u.id },
          data: {
            rate: u.rate,
            rateSource: u.rateSource,
            amount: u.amount,
            isProvisional: u.isProvisional,
            psAmount: null,
          },
        }),
      ),
    )
  }

  await prisma.$transaction([
    ...Array.from(sectionSubtotals.entries()).map(([sectionId, subtotal]) =>
      prisma.boqSection.update({ where: { id: sectionId }, data: { subtotal } }),
    ),
    prisma.boq.update({
      where: { id: boq.id },
      data: { subtotal: totalSubtotal, totalProvisional },
    }),
  ])

  return {
    ok: true,
    boqId: boq.id,
    pricedLines,
    provisionalLines,
    subtotal: totalSubtotal.toString(),
    totalProvisional: totalProvisional.toString(),
  }
}
