/**
 * TR-3 backfill — stamp / re-stamp provenance on every existing
 * BoqLine using the post-TR-3 schema (IMPORTED added, derivationType,
 * confidence 0-1, bbox coords where the upstream has them).
 *
 * Mapping rules:
 *
 *   takeoffItemId NULL                             → MANUAL
 *                                                    derivationType=null
 *                                                    evidence kind=legacy
 *                                                    (the human typed it
 *                                                     pre-TR-1; no user
 *                                                     link recoverable)
 *
 *   takeoffItemId NOT NULL, basis MEASURED|VISUAL  → MEASURED
 *                                                    derivationType=null
 *
 *   takeoffItemId NOT NULL, basis DERIVED|PARAMETRIC
 *                                                  → DERIVED
 *                                                    derivationType=formula
 *                                                    formula='amount = qty × rate'
 *                                                    OR (P/S) 'psAmount carried
 *                                                    from takeoff <tag>'
 *
 *   takeoffItemId NOT NULL, basis ESTIMATED|PLACEHOLDER
 *                                                  → ESTIMATED
 *                                                    derivationType=ai_reasoning
 *                                                    reasoning from sourceNote
 *                                                    or meta.estimationReasoning
 *
 * Sheet evidence gets a `bbox` populated from `takeoff.meta.position`
 * (the DXF MTEXT parser leaves modelspace coords there) and an
 * `extractedValue` from sourceNote where available.
 *
 * Rate evidence:
 *   rateSource 'assembly:<id>'   → add Assembly evidence
 *   rateSource 'rate-library:…'  → add RateLibrary evidence
 *
 * Idempotent — skip lines that already have provenance set unless
 * --force is passed. Dry-run by default.
 *
 *   bun apps/api/scripts/backfill-line-provenance.ts            # dry-run
 *   bun apps/api/scripts/backfill-line-provenance.ts --apply
 *   bun apps/api/scripts/backfill-line-provenance.ts --apply --force
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../src/db'
import {
  type Evidence,
  type EvidenceStep,
  type LineProvenance,
  computeConfidence,
  derivedByFormula,
  estimated as estimatedProvenance,
  manual as manualProvenance,
  measured as measuredProvenance,
  normalizeConfidence,
  step,
} from '../src/pricing/lineProvenance'

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

console.log('[backfill-provenance] mode:', apply ? 'APPLY' : 'dry-run', force ? '(--force)' : '')

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

// Pre-load takeoffs in one query.
const takeoffIds = [...new Set(lines.filter((l) => l.takeoffItemId).map((l) => l.takeoffItemId!))]
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
          select: {
            id: true,
            drawingNo: true,
            pageNo: true,
            documentId: true,
            title: true,
            sheetType: true,
            document: { select: { filename: true } },
          },
        },
      },
    })
  : []
const takeoffById = new Map(takeoffs.map((t) => [t.id, t]))

const assemblyIds = [
  ...new Set(
    lines.map((l) => parseAssemblyId(l.rateSource)).filter((x): x is string => x !== null),
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
  return { kind: 'rateLibrary', code: m[2]!, scope: m[1]! as 'org' | 'global', rate: '' }
}

function buildSheetEvidence(t: NonNullable<ReturnType<typeof takeoffById.get>>): Evidence | null {
  if (!t.sourceSheet) return null
  const meta = (t.meta ?? {}) as Record<string, unknown>
  const pos = (meta.position ?? meta.bbox) as
    | { x?: number; y?: number; w?: number; h?: number; cs?: string }
    | undefined
  const ev: Evidence = {
    kind: 'sheet',
    sheetId: t.sourceSheet.id,
    drawingNo: t.sourceSheet.drawingNo,
    pageNo: t.sourceSheet.pageNo,
    label: t.sourceNote ?? undefined,
    ...(t.sourceSheet.title ? { sheetTitle: t.sourceSheet.title } : {}),
    ...(t.sourceSheet.sheetType ? { sheetType: t.sourceSheet.sheetType } : {}),
    ...(t.sourceSheet.document?.filename
      ? { sourceDocFilename: t.sourceSheet.document.filename }
      : {}),
    ...(pos && typeof pos.x === 'number' && typeof pos.y === 'number'
      ? {
          bbox: {
            cs: (pos.cs as 'dxf-mm' | 'pdf-pt' | 'pdf-pct') ?? 'dxf-mm',
            x: pos.x,
            y: pos.y,
            ...(typeof pos.w === 'number' ? { w: pos.w } : {}),
            ...(typeof pos.h === 'number' ? { h: pos.h } : {}),
          },
        }
      : {}),
    ...(t.sourceNote ? { extractedValue: t.sourceNote.slice(0, 200) } : {}),
  }
  return ev
}

function buildRateEvidence(rateSource: string | null): Evidence | null {
  if (!rateSource) return null
  const asmId = parseAssemblyId(rateSource)
  if (asmId) {
    const a = assemblyById.get(asmId)
    return {
      kind: 'assembly',
      assemblyId: asmId,
      name: a?.name,
      brandName: a?.brand?.name ?? null,
    }
  }
  return parseRateLibraryEvidence(rateSource)
}

function buildForLine(l: (typeof lines)[number]): LineProvenance {
  // ─── Manual P/S or manual priced add ─────────────────────────
  if (l.takeoffItemId === null) {
    return manualProvenance({
      userId: 'legacy-backfill',
      at: new Date(0).toISOString(),
      note: l.isProvisional
        ? 'Manual P/S line added via SPA (backfilled — no user/timestamp recorded pre-TR-1)'
        : 'Manual priced line added via SPA (backfilled — no user/timestamp recorded pre-TR-1)',
      confidence: 1,
      stampedBy: 'backfill.v2',
    })
  }

  // ─── Derived from a TakeoffItem ──────────────────────────────
  const t = takeoffById.get(l.takeoffItemId)
  const evidence: Evidence[] = []

  if (t) {
    evidence.push({
      kind: 'takeoffItem',
      takeoffItemId: t.id,
      tag: t.tag,
      description: t.description.slice(0, 100),
      category: t.category,
    })
    const sheetEv = buildSheetEvidence(t)
    if (sheetEv) evidence.push(sheetEv)
  }
  const rateEv = buildRateEvidence(l.rateSource)
  if (rateEv) evidence.push(rateEv)

  // Fallback evidence so the auditor never sees an empty array.
  if (evidence.length === 0) {
    evidence.push({
      kind: 'legacy',
      note: `Backfilled — takeoffItemId=${l.takeoffItemId} not resolvable, rateSource=${l.rateSource ?? '-'}`,
    })
  }

  const meta = (t?.meta ?? {}) as Record<string, unknown>
  const formula = l.isProvisional
    ? `psAmount carried from takeoff ${t?.tag ?? t?.description.slice(0, 30) ?? '?'}`
    : 'amount = qty × rate'

  // CONF-4 — default evidence chain inferred from basis. The QUANTIFY
  // emitters now write a real chain into meta.evidenceChain; this
  // backfill only fires for lines whose takeoff doesn't have one.
  // Defaults are intentionally conservative — they should be
  // overwritten by a re-quantify, not lived with.
  function chainFromBasis(basis: string | undefined): EvidenceStep[] {
    switch (basis) {
      case 'MEASURED':
      case 'VISUAL':
        return [step({ id: 'bf.extract', type: 'EXTRACTION', confidence: 0.95, label: 'Backfill default — measured value from drawing/document' })]
      case 'DERIVED':
      case 'PARAMETRIC':
        return [
          step({ id: 'bf.extract', type: 'EXTRACTION', confidence: 0.95, label: 'Backfill default — input value extracted' }),
          step({ id: 'bf.derive', type: 'DERIVATION', confidence: 0.90, label: 'Backfill default — derived via formula' }),
        ]
      case 'ESTIMATED':
      case 'PLACEHOLDER':
        return [
          step({ id: 'bf.extract', type: 'EXTRACTION', confidence: 0.90, label: 'Backfill default — input signals extracted' }),
          step({ id: 'bf.prior', type: 'PRIOR', confidence: 0.75, label: 'Backfill default — estimated via prior' }),
          step({ id: 'bf.assume', type: 'ASSUMPTION', confidence: 0.75, label: 'Backfill default — assumption baked into estimate' }),
        ]
      default:
        return [step({ id: 'bf.unknown', type: 'ASSUMPTION', confidence: 0.5, label: 'Backfill default — unknown basis, full assumption' })]
    }
  }

  // Prefer the chain that QUANTIFY stamped on meta (the real
  // evidence chain). Fall back to the basis-derived default.
  const rawChain = Array.isArray(meta.evidenceChain) ? (meta.evidenceChain as EvidenceStep[]) : null
  const evidenceChain = rawChain && rawChain.length > 0 ? rawChain : chainFromBasis(t?.basis)
  const conf = computeConfidence(evidenceChain)

  if (!t) {
    // No takeoff resolvable — keep auditor happy by stamping as
    // ESTIMATED with legacy reasoning. Surfaces in review queue.
    return estimatedProvenance({
      evidence,
      reasoning: `Legacy line with takeoffItemId=${l.takeoffItemId} unresolved at backfill time`,
      confidence: conf,
      evidenceChain,
      stampedBy: 'backfill.v3',
    })
  }

  switch (t.basis) {
    case 'MEASURED':
    case 'VISUAL':
      return measuredProvenance({ evidence, confidence: conf, evidenceChain, stampedBy: 'backfill.v3' })
    case 'DERIVED':
    case 'PARAMETRIC':
      return derivedByFormula({ evidence, formula, confidence: conf, evidenceChain, stampedBy: 'backfill.v3' })
    case 'ESTIMATED':
    case 'PLACEHOLDER': {
      const reasoning =
        typeof meta.estimationReasoning === 'string'
          ? (meta.estimationReasoning as string)
          : (t.sourceNote ?? `Estimated from ${t.category} prior`)
      return estimatedProvenance({ evidence, reasoning, confidence: conf, evidenceChain, stampedBy: 'backfill.v3' })
    }
    default:
      return estimatedProvenance({
        evidence,
        reasoning: `Unknown takeoff basis '${t.basis}' — defaulted to ESTIMATED at backfill`,
        confidence: conf,
        evidenceChain,
        stampedBy: 'backfill.v3',
      })
  }
}

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
if (apply) console.log(`  updated   : ${updated}`)
else console.log('Re-run with --apply to commit.')
process.exit(0)
