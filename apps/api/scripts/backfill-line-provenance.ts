/**
 * TR-1 backfill — stamp provenance on every existing BoqLine by
 * reverse-engineering from existing denormalised fields.
 *
 *   takeoffItemId NULL + isProvisional=true   → MANUAL
 *                                                 (user typed via AddProvisionalLineCard;
 *                                                  evidence = legacy note, no user link
 *                                                  available for backfilled rows)
 *
 *   takeoffItemId NULL + isProvisional=false  → MANUAL
 *                                                 (priced manual additions — same
 *                                                  category as above)
 *
 *   takeoffItemId NOT NULL                    → derived from the TakeoffItem's basis:
 *     basis=MEASURED                            → MEASURED
 *     basis=DERIVED / PARAMETRIC                → DERIVED (formula = takeoff sourceNote
 *                                                 if it reads like one, else fallback)
 *     basis=ESTIMATED / PLACEHOLDER             → ESTIMATED (reasoning from sourceNote)
 *     basis=VISUAL                              → MEASURED (vision is still measurement)
 *
 *   rateSource starts with 'assembly:<id>'    → add Assembly evidence
 *   rateSource starts with 'rate-library:'    → add RateLibrary evidence
 *   rateSource starts with 'provisional-sum'  → no extra rate evidence
 *
 * Idempotent: skip lines that already have provenance set unless
 * --force is passed. Dry-run by default.
 *
 * Usage:
 *   bun apps/api/scripts/backfill-line-provenance.ts                # dry-run
 *   bun apps/api/scripts/backfill-line-provenance.ts --apply        # commit
 *   bun apps/api/scripts/backfill-line-provenance.ts --apply --force  # overwrite existing
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../src/db'
import {
  type Evidence,
  type LineProvenance,
  type ProvenanceInput,
  type SourceType,
} from '../src/pricing/lineProvenance'

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

console.log('[backfill-provenance] mode:', apply ? 'APPLY' : 'dry-run', force ? '(--force)' : '')

// Prisma Json-null filter: DbNull = column actually null in Postgres.
const where = force ? {} : { provenance: { equals: Prisma.DbNull } }
const lines = await prisma.boqLine.findMany({
  where,
  select: {
    id: true,
    organizationId: true,
    boqId: true,
    description: true,
    qty: true,
    rate: true,
    amount: true,
    isProvisional: true,
    psAmount: true,
    confidence: true,
    rateSource: true,
    takeoffItemId: true,
    assemblyId: true,
    provenance: true,
  },
})
console.log(`[backfill-provenance] ${lines.length} BoqLines to consider`)

// Pre-load the TakeoffItems we'll need in one query, then look up by id.
const takeoffIds = [
  ...new Set(lines.filter((l) => l.takeoffItemId).map((l) => l.takeoffItemId!)),
]
const takeoffs = takeoffIds.length
  ? await prisma.takeoffItem.findMany({
      where: { id: { in: takeoffIds } },
      select: {
        id: true,
        category: true,
        tag: true,
        description: true,
        basis: true,
        confidence: true,
        sourceSheetId: true,
        sourceNote: true,
        meta: true,
        sourceSheet: {
          select: { id: true, drawingNo: true, pageNo: true, documentId: true },
        },
      },
    })
  : []
const takeoffById = new Map(takeoffs.map((t) => [t.id, t]))

const assemblyIds = [
  ...new Set(
    lines
      .map((l) => parseAssemblyId(l.rateSource))
      .filter((x): x is string => x !== null),
  ),
]
const assemblies = assemblyIds.length
  ? await prisma.assembly.findMany({
      where: { id: { in: assemblyIds } },
      select: { id: true, name: true, brand: { select: { name: true } } },
    })
  : []
const assemblyById = new Map(assemblies.map((a) => [a.id, a]))

function parseAssemblyId(rs: string | null): string | null {
  if (!rs) return null
  const m = rs.match(/^assembly:([a-z0-9]+)/i)
  return m ? m[1]! : null
}

function parseRateLibraryEvidence(rs: string | null): Evidence | null {
  if (!rs) return null
  const m = rs.match(/^rate-library:(org|global):(.+)$/)
  if (!m) return null
  return {
    kind: 'rateLibrary',
    code: m[2]!,
    scope: m[1]! as 'org' | 'global',
    rate: '', // we'd need a join to find the actual rate; '-' is sufficient for backfill
  }
}

function buildForLine(l: (typeof lines)[number]): LineProvenance {
  // ─── Manual P/S or manual priced add ──────────────────────────
  if (l.takeoffItemId === null) {
    const evidence: Evidence[] = [
      {
        kind: 'legacy',
        note: l.isProvisional
          ? 'Manual P/S line added via SPA (backfilled — no user/timestamp recorded pre-TR-1)'
          : 'Manual priced line added via SPA (backfilled — no user/timestamp recorded pre-TR-1)',
      },
    ]
    return {
      sourceType: 'MANUAL',
      evidence,
      confidence: l.confidence ?? 100,
      stampedBy: 'backfill.v1',
    }
  }

  // ─── Derived from a TakeoffItem ───────────────────────────────
  const t = takeoffById.get(l.takeoffItemId)
  const evidence: Evidence[] = []
  const inputs: ProvenanceInput[] = []

  if (t) {
    evidence.push({
      kind: 'takeoffItem',
      takeoffItemId: t.id,
      tag: t.tag,
      description: t.description.slice(0, 100),
      category: t.category,
    })
    if (t.sourceSheet) {
      evidence.push({
        kind: 'sheet',
        sheetId: t.sourceSheet.id,
        drawingNo: t.sourceSheet.drawingNo,
        pageNo: t.sourceSheet.pageNo,
        label: t.sourceNote ?? undefined,
      })
    }
    inputs.push({
      name: 'qty',
      value: l.qty?.toString() ?? '0',
      unit: undefined,
      source: {
        kind: 'takeoffItem',
        takeoffItemId: t.id,
        tag: t.tag,
        description: t.description.slice(0, 80),
      },
    })
  }

  // Rate evidence — rate-library or assembly.
  if (l.rateSource) {
    const asmId = parseAssemblyId(l.rateSource)
    if (asmId) {
      const a = assemblyById.get(asmId)
      evidence.push({
        kind: 'assembly',
        assemblyId: asmId,
        name: a?.name,
        brandName: a?.brand?.name ?? null,
      })
    } else {
      const rl = parseRateLibraryEvidence(l.rateSource)
      if (rl) evidence.push(rl)
    }
  }

  // Rate input (only for priced lines).
  if (!l.isProvisional && l.rate !== null) {
    inputs.push({ name: 'rate', value: l.rate.toString(), unit: 'AED', source: undefined })
  }

  // ─── Pick the sourceType from TakeoffItem.basis ───────────────
  let sourceType: SourceType = 'ESTIMATED'
  if (t) {
    switch (t.basis) {
      case 'MEASURED':
      case 'VISUAL':
        sourceType = 'MEASURED'
        break
      case 'DERIVED':
      case 'PARAMETRIC':
        sourceType = 'DERIVED'
        break
      case 'ESTIMATED':
      case 'PLACEHOLDER':
        sourceType = 'ESTIMATED'
        break
      default:
        sourceType = 'ESTIMATED'
    }
  }

  // Formula is required for non-MANUAL. Use the best signal we
  // have. For priced lines: amount = qty × rate. For P/S derived
  // from takeoff: psAmount = (line carry).
  let formula: string | undefined
  if (!l.isProvisional) {
    formula = 'amount = qty × rate'
  } else if (l.isProvisional && t) {
    formula = `psAmount carried from takeoff ${t.tag ?? t.description.slice(0, 30)}`
  }

  // Reasoning — for ESTIMATED rows, pull from sourceNote or meta.
  let reasoning: string | undefined
  if (sourceType === 'ESTIMATED' && t) {
    const meta = (t.meta ?? {}) as Record<string, unknown>
    reasoning =
      typeof meta.estimationReasoning === 'string'
        ? meta.estimationReasoning
        : t.sourceNote ?? `Estimated from ${t.category} prior`
  }

  // Fallback evidence (no takeoff resolvable — shouldn't happen but
  // keep auditor happy with at least one evidence entry).
  if (evidence.length === 0) {
    evidence.push({
      kind: 'legacy',
      note: `Backfilled — takeoffItemId=${l.takeoffItemId} not resolvable, rateSource=${l.rateSource ?? '-'}`,
    })
  }

  return {
    sourceType,
    evidence,
    formula,
    inputs: inputs.length > 0 ? inputs : undefined,
    reasoning,
    confidence: l.confidence ?? undefined,
    stampedBy: 'backfill.v1',
  }
}

// ─── Apply ─────────────────────────────────────────────────────
let manualCount = 0
let measuredCount = 0
let derivedCount = 0
let estimatedCount = 0
let updated = 0

for (const l of lines) {
  const prov = buildForLine(l)
  switch (prov.sourceType) {
    case 'MANUAL':
      manualCount += 1
      break
    case 'MEASURED':
      measuredCount += 1
      break
    case 'DERIVED':
      derivedCount += 1
      break
    case 'ESTIMATED':
      estimatedCount += 1
      break
  }
  if (apply) {
    await prisma.boqLine.update({
      where: { id: l.id },
      data: { provenance: prov as object },
    })
    updated += 1
  }
}

console.log('')
console.log('[backfill-provenance] summary:')
console.log(`  MEASURED  : ${measuredCount}`)
console.log(`  DERIVED   : ${derivedCount}`)
console.log(`  ESTIMATED : ${estimatedCount}`)
console.log(`  MANUAL    : ${manualCount}`)
console.log(`  TOTAL     : ${lines.length}`)
if (apply) {
  console.log(`  updated   : ${updated}`)
} else {
  console.log('Re-run with --apply to commit.')
}
process.exit(0)
