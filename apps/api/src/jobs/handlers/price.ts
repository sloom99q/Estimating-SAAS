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
import { Prisma, type PrismaClient } from '@prisma/client'
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

async function findMatchingAssembly(
  client: PrismaClient,
  organizationId: string,
  category: string,
): Promise<{ id: string; components: Parameters<typeof computeAssemblyUnitCost>[0] } | null> {
  const applies = appliesToForCategory(category)
  if (!applies) return null
  const candidates = await client.assembly.findMany({
    where: {
      organizationId,
      deletedAt: null,
      appliesTo: { in: [applies, 'GENERIC'] },
    },
    include: { components: { orderBy: { sortOrder: 'asc' } } },
  })
  // If exactly one match wins. Multiple matches are ambiguous; we don't auto-
  // pick (leaves the line for the next waterfall tier — preserves the
  // architect's "never silent-pick on ambiguity" rule).
  if (candidates.length !== 1) return null
  const a = candidates[0]!
  return {
    id: a.id,
    components: a.components.map((c) => ({
      kind: c.kind as 'MATERIAL' | 'LABOR' | 'TOOL_FIXED',
      label: c.label,
      unitPrice: c.unitPrice,
      coverage: c.coverage,
      coats: c.coats,
      wastagePct: c.wastagePct,
      fixedCost: c.fixedCost,
    })),
  }
}

async function findRate(
  client: PrismaClient,
  organizationId: string,
  code: string,
): Promise<{
  rate: Prisma.Decimal
  source: 'rate-library:org' | 'rate-library:global'
  code: string
} | null> {
  // Org-private rate first; falls through to global. ADR-012 enforces the
  // explicit union (RateLibraryItem is NOT in TENANT_MODELS).
  const rows = await client.rateLibraryItem.findMany({
    where: {
      AND: [
        { OR: [{ organizationId }, { organizationId: null }] },
        { code, deletedAt: null, region: 'SHJ' },
      ],
    },
  })
  if (rows.length === 0) return null
  // Per-org row wins on collision; otherwise the global row.
  const sorted = rows.sort((a, b) =>
    (a.organizationId === null ? 1 : 0) - (b.organizationId === null ? 1 : 0),
  )
  const winner = sorted[0]!
  return {
    rate: winner.rate,
    source: winner.organizationId ? 'rate-library:org' : 'rate-library:global',
    code: winner.code,
  }
}

export const priceHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as PricePayload
  if (!payload.boqId) throw new Error('PRICE: payload.boqId required')

  const boq = await prisma.boq.findFirst({
    where: { id: payload.boqId, organizationId: job.organizationId, deletedAt: null },
    include: {
      sections: { include: { lines: true } },
    },
  })
  if (!boq) throw new Error(`PRICE: boq ${payload.boqId} not found`)

  let pricedLines = 0
  let provisionalLines = 0
  let totalSubtotal = new Prisma.Decimal(0)
  let totalProvisional = new Prisma.Decimal(0)

  for (const section of boq.sections) {
    let sectionSubtotal = new Prisma.Decimal(0)
    for (const line of section.lines) {
      const category = await prisma.takeoffItem
        .findUnique({
          where: line.takeoffItemId ? { id: line.takeoffItemId } : { id: '__none__' },
          select: { category: true },
        })
        .then((t) => t?.category ?? 'OTHER')

      let rate: Prisma.Decimal | null = null
      let rateSource: string | null = null
      let isProvisional = false

      // Tier 1: Assembly.
      const assembly = await findMatchingAssembly(prisma, job.organizationId, category)
      if (assembly) {
        const cost = computeAssemblyUnitCost(assembly.components)
        rate = cost.unitCost
        rateSource = `assembly:${assembly.id}`
      }

      // Tiers 2-3: supplier prices. Stub in Sprint 3 — takeoff items don't
      // yet link to Material rows. Wiring intact for Sprint 4.

      // Tiers 4-5: rate library (org → global).
      if (rate === null) {
        const code = rateCodeFor(line, category)
        if (code) {
          const found = await findRate(prisma, job.organizationId, code)
          if (found) {
            rate = found.rate
            rateSource = `${found.source}:${found.code}`
          }
        }
      }

      // Tier 6: provisional sum.
      if (rate === null) {
        isProvisional = true
        rateSource = 'provisional-sum'
      }

      const qty = line.qty ?? new Prisma.Decimal(0)
      const amount = rate === null ? new Prisma.Decimal(0) : qty.times(rate)
      if (rate !== null) pricedLines += 1
      if (isProvisional) provisionalLines += 1

      await prisma.boqLine.update({
        where: { id: line.id },
        data: {
          rate,
          rateSource,
          amount,
          isProvisional,
          psAmount: isProvisional ? new Prisma.Decimal(0) : null,
        },
      })

      sectionSubtotal = sectionSubtotal.plus(amount)
      if (isProvisional) {
        totalProvisional = totalProvisional.plus(line.psAmount ?? 0)
      }
    }
    totalSubtotal = totalSubtotal.plus(sectionSubtotal)
    await prisma.boqSection.update({
      where: { id: section.id },
      data: { subtotal: sectionSubtotal },
    })
  }

  await prisma.boq.update({
    where: { id: boq.id },
    data: { subtotal: totalSubtotal, totalProvisional },
  })

  return {
    ok: true,
    boqId: boq.id,
    pricedLines,
    provisionalLines,
    subtotal: totalSubtotal.toString(),
    totalProvisional: totalProvisional.toString(),
  }
}
