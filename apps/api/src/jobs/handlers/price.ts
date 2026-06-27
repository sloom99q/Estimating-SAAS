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
import { recomputeBoqTotals } from '../../pricing/recomputeBoqTotals'
import type { JobHandler, JobRecord } from '../types'

interface PricePayload {
  boqId: string
}

/**
 * Sprint-6 S6-4: category → §8 rate-code mapping. The lookup primarily uses
 * the line's `tag` (which QUANTIFY v2 sets to the §8-family prefix, e.g.
 * `FF-ST01`, `CL-CL02`, `WF-PAINT`) plus the `line.unit` for unit-match.
 * Description is the last-ditch heuristic for tag-less lines.
 *
 * Returns `null` → waterfall falls through to the next tier and ultimately
 * P/S. P/S is now the honest signal, not a failure mode (ADR-014).
 */
function rateCodeFor(line: { description: string; unit: string; tag?: string | null }, category: string): string | null {
  const desc = line.description.toLowerCase()
  const tag = (line.tag ?? '').toUpperCase()
  switch (category) {
    case 'FLOOR_FINISH': {
      // Tag-driven: FF-<finish_code> → FLR-<finish_code>
      if (tag.startsWith('FF-')) {
        const code = tag.slice(3)
        if (code === 'ST01') return 'FLR-ST01'
        if (code === 'PR01') return 'FLR-PR01'
        if (code === 'PR03') return 'FLR-PR03'
        if (code === 'BATHROOM') return 'FLR-BATH'
        if (code === 'ST03') return 'EXT-ST03'   // external porcelain pavement
        if (code === 'ST02') return 'STAIR-LAND' // staircase floor → landing rate
        return null // unassigned / other codes → P/S
      }
      return null
    }
    case 'WALL_FINISH': {
      if (tag === 'WF-PAINT') return 'PAINT-INT'
      if (tag === 'WF-WD01') return 'WALL-WOODPORC'
      if (tag === 'WF-WD02') return 'WALL-MARBPORC'
      // Other wall feature finishes (WD03+, FN0x, etc.) → P/S until rates land.
      return null
    }
    case 'PAINT':
      return 'PAINT-INT'
    case 'CEILING': {
      if (tag === 'CL-CL02') return 'CEIL-CL02'
      if (tag === 'CL-CL03') return 'CEIL-CL03'
      if (tag === 'CL-CL01-EXT') return 'CEIL-CL01-EXT'
      return null
    }
    case 'SCREED':
      return 'SCREED-FLR'
    case 'SKIRTING':
      // AI-est roadmap #1 — single skirting rate (SKIRT-PR01 120 AED/lm).
      // Future: branch per floorFinishCode if separate skirting rates
      // get seeded (skirting matches the floor finish in practice).
      return 'SKIRT-PR01'
    case 'JOINERY': {
      // AI-est roadmap #2 — VANITY count routes to the VANITY rate
      // (3400 AED/No, stone-top vanity).
      if (tag.startsWith('VAN-')) return 'VANITY'
      // AI-est roadmap #3 — KITCHEN base / wall units.
      //   KB-<roomId> → KIT-BASE  (1200 AED/lm, HPL base unit)
      //   KW-<roomId> → KIT-WALL  (1100 AED/lm, HPL wall unit)
      if (tag.startsWith('KB-')) return 'KIT-BASE'
      if (tag.startsWith('KW-')) return 'KIT-WALL'
      // AI-est roadmap #4 — countertop + wardrobes. Per expert call
      // (2026-06-20): NO GUESSED JOINERY PRICES. Both return null so
      // PRICE marks the line isProvisional=true; the line enters the
      // BOQ as P/S with the measured lm count, and the expert types
      // the per-lm rate at quote time.
      if (tag.startsWith('KC-')) return null // countertop — expert prices
      if (tag.startsWith('WD-')) return null // built-in wardrobes — expert prices
      return null
    }
    case 'DOOR': {
      // §8 has three door rates; pick by visible dimensions in the description.
      if (desc.includes('1000') && desc.includes('3000')) return 'DOOR-1000x3000-FN01'
      if (desc.includes('900') && desc.includes('2400')) return 'DOOR-900x2400'
      return 'DOOR-STD-LACQ'
    }
    case 'WINDOW':
      // ADR-014: no per-No glazing rate exists in §8. All windows go P/S.
      return null
    case 'EXTERNAL': {
      if (line.unit === 'm²') return 'EXT-ST03'
      return null
    }
    case 'OTHER': {
      // QUANTIFY parks the staircase tread+riser line in OTHER (unit=lm).
      if (tag === 'STAIR-TREAD') return 'STAIR-TREAD'
      if (tag === 'THRESH') return 'THRESH'
      if (tag === 'HANDRAIL-MDF') return 'HANDRAIL-MDF'
      return null
    }
    case 'ROOM':
      return null
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
      select: { id: true, category: true, tag: true, meta: true },
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
  const tagByTakeoffId = new Map(takeoffItems.map((t) => [t.id, t.tag]))
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
  // LIB-5 (2026-06-24) — Library routing. Group by takeoffCategory
  // for the new tier-1 lookup. Within each group, sort by sortOrder
  // ASC so finish-code-specific systems beat the org "house" default.
  const assembliesByTakeoffCategory = new Map<string, typeof assemblies>()
  for (const a of assemblies) {
    if (!a.takeoffCategory) continue
    const bucket = assembliesByTakeoffCategory.get(a.takeoffCategory) ?? []
    bucket.push(a)
    assembliesByTakeoffCategory.set(a.takeoffCategory, bucket)
  }
  for (const bucket of assembliesByTakeoffCategory.values()) {
    bucket.sort((x, y) => x.sortOrder - y.sortOrder)
  }
  // ADR-014 + S6-4 unit lexicon. The extractors emit 'nr' / 'm²' / 'm', while
  // SPEC.md §8 writes 'No' / 'm²' / 'lm'. We canonicalise both sides so the
  // unit-match check survives those legitimate synonyms.
  const canonicaliseUnit = (s: string | null | undefined) => {
    const raw = (s ?? '').trim().toLowerCase()
    if (raw === '') return ''
    if (raw === 'nr' || raw === 'no' || raw === 'each' || raw === 'ea') return 'nr'
    if (raw === 'm²' || raw === 'm2' || raw === 'sqm') return 'm²'
    if (raw === 'm' || raw === 'lm' || raw === 'linear' || raw === 'metres' || raw === 'meters') {
      return 'lm'
    }
    if (raw === 'lumpsum' || raw === 'ls' || raw === 'lot') return 'lumpsum'
    return raw
  }
  const unitsMatch = (a: string | null | undefined, b: string | null | undefined) =>
    canonicaliseUnit(a) === canonicaliseUnit(b)

  interface PendingUpdate {
    id: string
    sectionId: string
    rate: Prisma.Decimal | null
    rateSource: string | null
    amount: Prisma.Decimal
    isProvisional: boolean
    psAmount: Prisma.Decimal | null
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
      // MEP-6 — rule-driven MEP lines (rateSource='mep-rule:<id>')
      // already carry their rate + amount from BOQ generation. The
      // 6-tier waterfall has nothing to add; preserve the existing
      // values and accumulate into section + grand totals. Lines like
      // these are NEVER provisional (the rule has a rate) and never
      // get the PS sentinel.
      if (line.rateSource && line.rateSource.startsWith('mep-rule:')) {
        const existingRate = line.rate ?? new Prisma.Decimal(0)
        const qty = line.qty ?? new Prisma.Decimal(0)
        const amount = qty.times(existingRate)
        pending.push({
          id: line.id,
          sectionId: section.id,
          rate: existingRate,
          rateSource: line.rateSource,
          amount,
          isProvisional: false,
          psAmount: null,
        })
        pricedLines += 1
        sectionSubtotal = sectionSubtotal.plus(amount)
        continue
      }

      const category = line.takeoffItemId
        ? categoryByTakeoffId.get(line.takeoffItemId) ?? 'OTHER'
        : 'OTHER'
      const sourceTag = line.takeoffItemId
        ? tagByTakeoffId.get(line.takeoffItemId) ?? null
        : null

      let rate: Prisma.Decimal | null = null
      let rateSource: string | null = null

      // Tier 1 — Assembly match (in-memory). Two routing paths.
      //
      // LIB-5 (2026-06-24) — new takeoffCategory routing. When an
      // Assembly carries `takeoffCategory`, it matches lines whose
      // takeoff item is of that category, with optional finish-code
      // narrowing via `defaultForFinishCodes`. Sorted by sortOrder
      // ASC; the first compatible match wins.
      //
      // Legacy `appliesTo` routing kept as a fallback for older
      // assemblies that haven't been migrated to takeoffCategory yet
      // (defence: a seeded org might have a WALL assembly without the
      // new field).
      //
      // ADR-014: assembly.outputUnit must equal line.unit. A WALL
      // assembly with outputUnit='m²' cannot price a window line with
      // unit='nr'.
      //
      // Sprint-7 S7-0: wall feature legend lines (tag pattern WF-<code>,
      // where <code> ≠ PAINT) bypass the assembly tier — they're
      // specific products with their own rates, not generic paint
      // surfaces.
      const isWallFeatureLine =
        category === 'WALL_FINISH' &&
        typeof sourceTag === 'string' &&
        sourceTag.startsWith('WF-') &&
        sourceTag !== 'WF-PAINT'

      // Resolve the takeoff item's finish_code, when available — drives
      // the defaultForFinishCodes narrowing for the new routing path.
      const takeoffMeta = line.takeoffItemId
        ? (takeoffItems.find((t) => t.id === line.takeoffItemId)?.meta as
            | Record<string, unknown>
            | null
            | undefined) ?? null
        : null
      const lineFinishCode =
        takeoffMeta && typeof takeoffMeta.finish_code === 'string'
          ? (takeoffMeta.finish_code as string)
          : null

      if (!isWallFeatureLine) {
        // (1) New routing: takeoffCategory match, finish-code-narrowed,
        // sortOrder-resolved.
        const tcCandidates = (assembliesByTakeoffCategory.get(category) ?? [])
          .filter((a) => unitsMatch(a.outputUnit, line.unit))
          .filter((a) => {
            const codes = a.defaultForFinishCodes ?? []
            if (codes.length === 0) return true // org "house" default
            return lineFinishCode !== null && codes.includes(lineFinishCode)
          })
        if (tcCandidates.length > 0) {
          const a = tcCandidates[0]! // already sorted by sortOrder ASC
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

        // (2) Legacy appliesTo path — only if the new path didn't match.
        if (rate === null) {
          const appliesTo = appliesToForCategory(category)
          if (appliesTo) {
            const candidates = (assembliesByApplies.get(appliesTo) ?? [])
              .concat(assembliesByApplies.get('GENERIC') ?? [])
              // Don't double-fire: an assembly already considered via
              // takeoffCategory shouldn't also fire here.
              .filter((a) => !a.takeoffCategory)
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
        }
      }

      // Tiers 2-3: supplier prices — Sprint 4 no-op (no takeoff→Material
      // link). When wired (Sprint 6+) ADR-014 applies: the supplier price's
      // material.unit must equal line.unit.

      // Tiers 4-5: rate library. ADR-014: found.unit must equal line.unit.
      if (rate === null) {
        const code = rateCodeFor({ ...line, tag: sourceTag }, category)
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

      // PS-AGG-2 (2026-06-25) — preserve manual P/S psAmount across
      // PRICE. A "manual" P/S line is one the user typed in via
      // AddProvisionalLineCard: takeoffItemId IS NULL + isProvisional
      // was already true going in. The pre-existing PRICE write
      // unconditionally set psAmount=null which broke the
      // delete-line decrement (delete subtracted 0, aggregate stayed
      // inflated forever — the 1,090,000 ghost on Lami). Manual P/S
      // gets its existing psAmount preserved; only auto-routed P/S
      // (a takeoff item that fell through every rate tier) gets the
      // psAmount=null sentinel that tells the commercial team to
      // type the carry.
      const isManualPs =
        line.takeoffItemId === null && line.isProvisional === true
      const preservedPsAmount = isManualPs ? line.psAmount : null

      pending.push({
        id: line.id,
        sectionId: section.id,
        rate,
        rateSource,
        amount,
        isProvisional,
        psAmount: preservedPsAmount,
      })

      sectionSubtotal = sectionSubtotal.plus(amount)
      if (isProvisional) {
        // Sum manual P/S amounts (just preserved) into the running
        // total; auto-routed P/S contributes nothing until the
        // operator types a carry.
        totalProvisional = totalProvisional.plus(preservedPsAmount ?? 0)
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
            // PS-AGG-2 — manual P/S psAmount preserved (was set on
            // pending above); auto-routed P/S gets null sentinel.
            psAmount: u.psAmount,
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
