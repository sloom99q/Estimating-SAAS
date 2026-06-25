/**
 * AUDIT-1 — deterministic per-line auditor. Pure TypeScript, no LLM.
 *
 * Reads BoqLine.provenance + the line's scalar fields and answers
 * three questions:
 *
 *   1. Does the line have a complete provenance payload? (sourceType
 *      set, evidence non-empty, formula present for non-MANUAL.)
 *      Anything missing → status='failed' — the line is unauditable;
 *      it might be a hardcoded value sneaking through, a stale row,
 *      or a write path the code review missed. Either way the
 *      estimator needs to see it.
 *
 *   2. Is the line plausibly correct given its own provenance?
 *      ESTIMATED-without-reasoning, MANUAL-with-confidence-0, etc.
 *      Issues here are 'review' rather than 'failed' — the line
 *      can ship, but it's worth a second look.
 *
 *   3. Is confidence high enough to skip review by default? Below
 *      the threshold → 'review'. Above → 'verified'.
 *
 * The auditor is intentionally NOT an LLM. The questions above are
 * structural — they ask "does the line have the metadata we need"
 * — not "is the number plausible." Plausibility checks (does
 * 1,170 AED for LIVING paint look right) are a future agent layer
 * that can read the verification report this produces.
 */
import type { LineProvenance } from './lineProvenance'

export type AuditStatus = 'verified' | 'review' | 'failed'

export interface AuditResult {
  status: AuditStatus
  reasons: string[]
}

export interface AuditableLine {
  id: string
  itemRef: string
  description: string
  isProvisional: boolean
  confidence: number | null
  takeoffItemId: string | null
  /// Already-parsed provenance (use parseProvenance from
  /// lineProvenance.ts before passing). null = no payload set.
  provenance: LineProvenance | null
}

const REVIEW_CONFIDENCE_THRESHOLD = 60

export function auditLine(line: AuditableLine): AuditResult {
  const reasons: string[] = []

  // ── Tier 1 — provenance structural completeness ────────────────
  const p = line.provenance
  if (!p) {
    return {
      status: 'failed',
      reasons: ['no provenance payload — line predates TR-1 or write path missed stamping'],
    }
  }
  if (!p.sourceType) {
    reasons.push('provenance.sourceType missing')
  }
  if (!p.evidence || p.evidence.length === 0) {
    reasons.push('provenance.evidence empty')
  }
  if (p.sourceType !== 'MANUAL' && !p.formula) {
    reasons.push(`provenance.formula required for ${p.sourceType} but missing`)
  }
  if (reasons.length > 0) {
    return { status: 'failed', reasons }
  }

  // ── Tier 2 — semantic checks (warn, not fail) ──────────────────
  if (p.sourceType === 'ESTIMATED' && !p.reasoning) {
    reasons.push('ESTIMATED line lacks reasoning string')
  }
  if (p.sourceType === 'MANUAL') {
    const userEvidence = p.evidence.find((e) => e.kind === 'user')
    const legacyEvidence = p.evidence.find((e) => e.kind === 'legacy')
    if (!userEvidence && !legacyEvidence) {
      reasons.push('MANUAL line has no user or legacy backfill evidence')
    }
  }
  if (!line.isProvisional && p.sourceType !== 'MANUAL') {
    const hasRateEvidence = p.evidence.some(
      (e) => e.kind === 'rateLibrary' || e.kind === 'assembly' || e.kind === 'mepRule',
    )
    if (!hasRateEvidence) {
      reasons.push('priced line has no rate evidence (assembly / rateLibrary / mepRule)')
    }
  }

  // ── Tier 3 — confidence threshold ──────────────────────────────
  const conf = line.confidence ?? p.confidence ?? 0
  if (conf < REVIEW_CONFIDENCE_THRESHOLD && p.sourceType !== 'MANUAL') {
    reasons.push(`confidence ${conf} below review threshold ${REVIEW_CONFIDENCE_THRESHOLD}`)
  }

  return {
    status: reasons.length > 0 ? 'review' : 'verified',
    reasons,
  }
}

/// Summary aggregation across all lines in a BOQ.
export interface AuditSummary {
  total: number
  verified: number
  review: number
  failed: number
  bySourceType: Record<string, { verified: number; review: number; failed: number }>
  bySection: Record<string, { verified: number; review: number; failed: number }>
  topFailReasons: Array<{ reason: string; count: number }>
}

export function summarize(
  results: Array<{ line: AuditableLine; sectionCode: string; result: AuditResult }>,
): AuditSummary {
  const summary: AuditSummary = {
    total: results.length,
    verified: 0,
    review: 0,
    failed: 0,
    bySourceType: {},
    bySection: {},
    topFailReasons: [],
  }
  const reasonCounts = new Map<string, number>()
  for (const r of results) {
    summary[r.result.status] += 1
    const st = r.line.provenance?.sourceType ?? 'UNKNOWN'
    summary.bySourceType[st] = summary.bySourceType[st] ?? { verified: 0, review: 0, failed: 0 }
    summary.bySourceType[st]![r.result.status] += 1
    summary.bySection[r.sectionCode] = summary.bySection[r.sectionCode] ?? {
      verified: 0, review: 0, failed: 0,
    }
    summary.bySection[r.sectionCode]![r.result.status] += 1
    for (const reason of r.result.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
    }
  }
  summary.topFailReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  return summary
}
