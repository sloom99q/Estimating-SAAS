/**
 * Pluck the provenance + evidence chain off a BoqLine row and shape
 * it into the XlsxLine fields the renderer expects. Pure — no DB
 * access, no side effects. The route + export job both call this so
 * the denormalisation logic is shared.
 *
 * XLSX-1 (2026-06-27).
 */
import type { Evidence, LineProvenance } from './lineProvenance'
import { parseProvenance } from './lineProvenance'
import type { XlsxAuditDetail, XlsxEvidenceStep, XlsxLine } from './exportXlsx'

interface RawBoqLine {
  itemRef: string
  description: string
  unit: string
  qty: { toString(): string } | null
  rate: { toString(): string } | null
  rateSource: string | null
  amount: { toString(): string } | null
  isProvisional: boolean
  psAmount: { toString(): string } | null
  confidence: number | null
  verificationStatus: string | null
  verificationDetail: unknown
  provenance: unknown
}

function describeEvidence(e: Evidence): string {
  switch (e.kind) {
    case 'sheet': {
      // EVIDENCE-1 — self-verifying sheet ref:
      //   "A551 (DOOR SCHEDULE — schedule) p27 of plot4357.pdf "D01 1200×2400""
      // Engineer can open the named PDF, jump to page 27, confirm
      // they're on a sheet titled "DOOR SCHEDULE" before trusting
      // the extracted value.
      const titlePart = e.sheetTitle ? ` (${e.sheetTitle}` + (e.sheetType ? ` — ${e.sheetType}` : '') + ')' : ''
      const docPart = e.sourceDocFilename ? ` of ${e.sourceDocFilename}` : ''
      return (
        `sheet ${e.drawingNo ?? e.sheetId.slice(-6)}${titlePart}` +
        (e.pageNo ? ` p${e.pageNo}` : '') +
        docPart +
        (e.bbox ? ` @[${e.bbox.x.toFixed(0)},${e.bbox.y.toFixed(0)}]` : '') +
        (e.extractedValue ? ` "${e.extractedValue.slice(0, 60)}"` : '')
      )
    }
    case 'takeoffItem':
      return `takeoff ${e.tag ?? e.takeoffItemId.slice(-6)} (${e.category})`
    case 'document':
      return `doc ${e.filename}` + (e.pageNo ? ` p${e.pageNo}` : '')
    case 'rateLibrary':
      return `rate-lib:${e.scope}:${e.code}`
    case 'assembly':
      return `assembly:${e.name ?? e.assemblyId.slice(-6)}` + (e.brandName ? ` (${e.brandName})` : '')
    case 'user':
      return `user:${e.userId.slice(-6)} at ${e.at?.slice(0, 16)}`
    case 'mepRule':
      return (
        `mep-rule:${e.name ?? e.ruleId.slice(-6)}` +
        (e.factorSource ? ` · factor: ${e.factorSource.slice(0, 80)}` : '') +
        (e.rateSource ? ` · rate: ${e.rateSource.slice(0, 80)}` : '')
      )
    case 'import':
      return `import:${e.importType} from ${e.sourceLabel}`
    case 'legacy':
      return `legacy: ${(e.note ?? '').slice(0, 60)}`
    default:
      return JSON.stringify(e).slice(0, 60)
  }
}

function deriveDetail(p: LineProvenance): string {
  switch (p.derivationType) {
    case 'formula':
      return p.formula ?? '(formula not recorded)'
    case 'rule':
      return (p.reasoning ?? '') + (p.ruleRef ? `\n  ${p.ruleRef}` : '')
    case 'ai_reasoning':
      return p.reasoning ?? '(reasoning not recorded)'
    default:
      return p.reasoning ?? p.formula ?? ''
  }
}

function evidenceSummary(p: LineProvenance): string {
  // Drop the noisy takeoffItem self-pointer — the row itemRef already
  // names the takeoff. Keep sheets, documents, mepRule, user, assembly,
  // rateLibrary, import, legacy.
  const filtered = p.evidence.filter((e) => e.kind !== 'takeoffItem')
  if (filtered.length === 0 && p.evidence.length > 0) {
    return describeEvidence(p.evidence[0]!)
  }
  return filtered.map(describeEvidence).join(' · ')
}

function parseVerdict(raw: unknown): 'verified' | 'review' | 'failed' | null {
  return raw === 'verified' || raw === 'review' || raw === 'failed' ? raw : null
}

function safeAuditDetail(raw: unknown): XlsxAuditDetail | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as {
    status?: unknown
    quantityVerdict?: unknown
    rateVerdict?: unknown
    modules?: unknown
  }
  const status = parseVerdict(r.status)
  const modules = Array.isArray(r.modules)
    ? r.modules.map((m) => {
        const mm = (m ?? {}) as {
          module?: unknown
          axis?: unknown
          verdict?: unknown
          reasons?: unknown
          resolutionSteps?: unknown
          tags?: unknown
        }
        return {
          module: typeof mm.module === 'string' ? mm.module : 'unknown',
          axis:
            mm.axis === 'quantity' || mm.axis === 'rate' || mm.axis === 'shared'
              ? mm.axis
              : undefined,
          verdict: parseVerdict(mm.verdict) ?? ('review' as const),
          reasons: Array.isArray(mm.reasons) ? mm.reasons.filter((x): x is string => typeof x === 'string') : [],
          resolutionSteps: Array.isArray(mm.resolutionSteps)
            ? mm.resolutionSteps.filter((x): x is string => typeof x === 'string')
            : undefined,
          tags: Array.isArray(mm.tags) ? mm.tags.filter((x): x is string => typeof x === 'string') : undefined,
        }
      })
    : []
  return {
    status,
    quantityVerdict: parseVerdict(r.quantityVerdict),
    rateVerdict: parseVerdict(r.rateVerdict),
    modules,
  }
}

export function toXlsxLine(line: RawBoqLine): XlsxLine {
  const p = parseProvenance(line.provenance)
  const evidenceChain: XlsxEvidenceStep[] = p?.evidenceChain
    ? p.evidenceChain.map((s) => ({
        type: s.type,
        confidence: s.confidence,
        weight: s.weight,
        ...(s.label !== undefined ? { label: s.label } : {}),
        ...(s.sourceRef !== undefined ? { sourceRef: s.sourceRef } : {}),
      }))
    : []
  const verificationStatus =
    line.verificationStatus === 'VERIFIED' || line.verificationStatus === 'FLAGGED' || line.verificationStatus === 'PENDING'
      ? line.verificationStatus
      : null

  return {
    itemRef: line.itemRef,
    description: line.description,
    unit: line.unit,
    qty: line.qty === null ? null : line.qty.toString(),
    rate: line.rate === null ? null : line.rate.toString(),
    rateSource: line.rateSource,
    amount: line.amount === null ? null : line.amount.toString(),
    isProvisional: line.isProvisional,
    psAmount: line.psAmount === null ? null : line.psAmount.toString(),
    confidence: line.confidence,
    sourceType: p?.sourceType ?? null,
    derivationType: p?.derivationType ?? null,
    derivationDetail: p ? deriveDetail(p) : null,
    evidenceSummary: p ? evidenceSummary(p) : null,
    evidenceChain,
    verificationStatus,
    verificationDetail: safeAuditDetail(line.verificationDetail),
  }
}
