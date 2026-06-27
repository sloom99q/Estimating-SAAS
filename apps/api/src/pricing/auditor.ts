/**
 * AUDIT — pluggable per-line auditor.
 *
 * Composable check modules. Each module is independent: returns a
 * verdict + reasons for ONE concern. The pipeline runs all modules
 * over each line and aggregates verdicts into a final status.
 *
 * Three planned modules; one wired today:
 *
 *   IntegrityAuditModule  (now) — structural. Provenance present?
 *                                  Evidence non-empty? Derivation
 *                                  type-appropriate? NO AI.
 *
 *   EngineeringAuditModule (later) — "is the quantity sane?". Uses
 *                                    AI + per-discipline priors.
 *                                    Catches "0.5 m² floor finish"
 *                                    type errors structural checks
 *                                    can't reach.
 *
 *   ProcurementAuditModule (later) — "is this the cheapest current
 *                                    rate? are supplier prices fresh
 *                                    (< 30 days)? does the supplier
 *                                    have credit?". Reads
 *                                    MaterialSupplierPrice +
 *                                    Supplier.creditLimitAed.
 *
 * The split is deliberate: today's Integrity checks are CHEAP +
 * DETERMINISTIC + RUN-ON-EVERY-REGENERATE. Tomorrow's AI / Procurement
 * are EXPENSIVE + JUDGEMENTAL + RUN-ON-DEMAND. Different lifecycles,
 * different surfaces, same plug-in shape.
 */
import {
  computeConfidence,
  normalizeConfidence,
  parseProvenance,
  type LineProvenance,
} from './lineProvenance'

// ─── Shared types ────────────────────────────────────────────────

export type Verdict = 'verified' | 'review' | 'failed'

export interface AuditLineInput {
  id: string
  itemRef: string
  description: string
  isProvisional: boolean
  confidence: number | null
  takeoffItemId: string | null
  qty: string | null
  rate: string | null
  amount: string | null
  psAmount: string | null
  provenance: LineProvenance | null
}

/// AUDIT-VERDICT (2026-06-27) — every module declares which axis
/// it judges. `quantity` modules can FAIL a line (qty is wrong,
/// can't ship). `rate` modules can FLAG a line but never demote the
/// QUANTITY verdict (the door count IS correct even if the rate is
/// a default). `shared` modules feed both axes.
export type Axis = 'quantity' | 'rate' | 'shared'

export interface ModuleResult {
  module: string
  axis: Axis
  verdict: Verdict
  reasons: string[]
  /// CONF-2 — actionable steps the estimator can take to move a
  /// line from review/failed to verified. One per reason, indexed
  /// 1:1 by position when both arrays are non-empty.
  resolutionSteps: string[]
  /// CONF-2 — optional semantic tags (NEEDS_REVIEW, MISSING_EVIDENCE,
  /// LOW_CONF, etc.) for the SPA to chip-render.
  tags: string[]
}

export interface AuditModule {
  name: string
  /// Optional gate — return false to skip this module on this line
  /// (e.g. ProcurementAuditModule skips P/S lines).
  applies?: (line: AuditLineInput) => boolean
  check: (line: AuditLineInput) => ModuleResult
}

export interface LineAuditResult {
  lineId: string
  /// Overall line status — worst-of all axes (back-compat for the
  /// existing verificationStatus column).
  status: Verdict
  /// AUDIT-VERDICT — per-axis verdicts. Quantity = "did we count
  /// it right?". Rate = "is the unit cost from a trusted source?".
  /// Engineer-facing UIs render TWO badges per line.
  quantityVerdict: Verdict
  rateVerdict: Verdict
  modules: ModuleResult[]
}

// ─── Verdict aggregation ─────────────────────────────────────────
// Failed beats review beats verified. Any 'failed' module → line
// status 'failed'. Else any 'review' → 'review'. Else 'verified'.
function aggregate(results: ModuleResult[]): Verdict {
  if (results.some((r) => r.verdict === 'failed')) return 'failed'
  if (results.some((r) => r.verdict === 'review')) return 'review'
  return 'verified'
}

/// AUDIT-VERDICT — per-axis aggregator. A `shared` module counts
/// toward both axes; `quantity` only toward quantity; `rate` only
/// toward rate. This is the function that ensures a NO_RATE_EVIDENCE
/// flag NEVER pulls a measured door's QUANTITY verdict down.
function aggregateAxis(results: ModuleResult[], axis: 'quantity' | 'rate'): Verdict {
  const relevant = results.filter((r) => r.axis === axis || r.axis === 'shared')
  return aggregate(relevant)
}

// ─── Module 1 — Integrity (structural) ───────────────────────────

const REVIEW_CONFIDENCE_THRESHOLD = 0.6 // 0-1 scale

// Helper — push a reason + matching resolution + tag in lockstep so
// the SPA can render the trio inline.
function addFinding(
  bag: { reasons: string[]; resolutionSteps: string[]; tags: string[] },
  reason: string,
  resolution: string,
  tag: string,
): void {
  bag.reasons.push(reason)
  bag.resolutionSteps.push(resolution)
  bag.tags.push(tag)
}

const integrityModule: AuditModule = {
  name: 'Integrity',
  check(line) {
    const bag = { reasons: [] as string[], resolutionSteps: [] as string[], tags: [] as string[] }
    const p = line.provenance

    // Structural completeness — these are 'failed'.
    if (!p) {
      addFinding(
        bag,
        'no provenance payload — line predates TR-1 or write path missed stamping',
        'Re-run backfill-line-provenance.ts --force, or regenerate the BOQ (write paths now stamp provenance automatically).',
        'MISSING_PROVENANCE',
      )
      return {
        module: 'Integrity',
        axis: 'shared',
        verdict: 'failed',
        reasons: bag.reasons,
        resolutionSteps: bag.resolutionSteps,
        tags: bag.tags,
      }
    }
    if (!p.sourceType) {
      addFinding(
        bag,
        'sourceType missing',
        'Edit the line and pick MEASURED / DERIVED / ESTIMATED / MANUAL / IMPORTED.',
        'MISSING_SOURCETYPE',
      )
    }
    if (!p.evidence || p.evidence.length === 0) {
      addFinding(
        bag,
        'evidence empty',
        'Add at least one evidence entry — sheet ref, takeoff link, document, supplier quote, or user note.',
        'MISSING_EVIDENCE',
      )
    }

    // Derivation type-appropriateness.
    //   DERIVED  → derivationType MUST be 'formula' or 'rule', and
    //              the matching field (formula/ruleRef) must exist.
    //   ESTIMATED → derivationType MUST be 'ai_reasoning' with a
    //              non-empty reasoning string.
    //   MEASURED / MANUAL / IMPORTED → derivationType MUST be null.
    if (p.sourceType === 'DERIVED') {
      if (p.derivationType !== 'formula' && p.derivationType !== 'rule') {
        addFinding(
          bag,
          `DERIVED requires derivationType=formula|rule (got ${p.derivationType ?? 'null'})`,
          'Pick formula (with the equation) or rule (with a ruleRef like mep-rule:<id>).',
          'BAD_DERIVATION',
        )
      } else if (p.derivationType === 'formula' && !p.formula) {
        addFinding(
          bag,
          'DERIVED+formula requires provenance.formula',
          'Add the equation string, e.g. "amount = qty × rate" or "wallArea = perimeter × height × coats".',
          'BAD_DERIVATION',
        )
      } else if (p.derivationType === 'rule' && !p.ruleRef) {
        addFinding(
          bag,
          'DERIVED+rule requires provenance.ruleRef',
          'Add a ruleRef pointing at the rule (e.g. mep-rule:<id>, finish-code-map:<code>).',
          'BAD_DERIVATION',
        )
      }
    }
    if (p.sourceType === 'ESTIMATED') {
      if (p.derivationType !== 'ai_reasoning') {
        addFinding(
          bag,
          `ESTIMATED requires derivationType=ai_reasoning (got ${p.derivationType ?? 'null'})`,
          'Set derivationType=ai_reasoning + add a narrative explaining the estimate.',
          'BAD_DERIVATION',
        )
      }
      if (!p.reasoning || p.reasoning.length === 0) {
        addFinding(
          bag,
          'ESTIMATED requires non-empty reasoning',
          'Add a 1-2 sentence rationale: prior used, scope assumption, why this number.',
          'MISSING_REASONING',
        )
      }
    }
    if (
      (p.sourceType === 'MEASURED' ||
        p.sourceType === 'MANUAL' ||
        p.sourceType === 'IMPORTED' ||
        p.sourceType === 'PROVISIONAL_SUM' ||
        p.sourceType === 'LUMP_SUM') &&
      p.derivationType != null
    ) {
      addFinding(
        bag,
        `${p.sourceType} should have derivationType=null (got '${p.derivationType}'); a measured/typed/imported/P-S/LS line has no derivation step`,
        `Clear derivationType (set to null) — or change sourceType to DERIVED if there really is a derivation step.`,
        'BAD_DERIVATION',
      )
    }

    if (bag.reasons.length > 0) {
      // Missing required fields = failed; the line cannot ship as-is.
      return {
        module: 'Integrity',
        axis: 'quantity',
        verdict: 'failed',
        reasons: bag.reasons,
        resolutionSteps: bag.resolutionSteps,
        tags: bag.tags,
      }
    }

    // Soft warning — MANUAL line missing user evidence. Affects
    // QUANTITY axis (the quantity itself is unsourced).
    const soft = { reasons: [] as string[], resolutionSteps: [] as string[], tags: [] as string[] }
    if (p.sourceType === 'MANUAL') {
      const userEv = p.evidence.find((e) => e.kind === 'user')
      const legacyEv = p.evidence.find((e) => e.kind === 'legacy')
      if (!userEv && !legacyEv) {
        addFinding(
          soft,
          'MANUAL line has no user or legacy backfill evidence',
          'Add a user evidence entry (who, when) so the audit chain is intact.',
          'MISSING_EVIDENCE',
        )
      }
    }
    if (soft.reasons.length > 0) {
      return {
        module: 'Integrity',
        axis: 'quantity',
        verdict: 'review',
        reasons: soft.reasons,
        resolutionSteps: soft.resolutionSteps,
        tags: soft.tags,
      }
    }
    return {
      module: 'Integrity',
      axis: 'quantity',
      verdict: 'verified',
      reasons: [],
      resolutionSteps: [],
      tags: [],
    }
  },
}

// ─── Module — RateEvidence (axis: rate) ─────────────────────────
//
// AUDIT-VERDICT (2026-06-27). Pulled out of Integrity so a priced
// line with default-rate doesn't drag down its QUANTITY verdict.
// "0.9 measured door + default rate" is now: Quantity=VERIFIED,
// Rate=DEFAULT — two separate badges, both honest.

const rateEvidenceModule: AuditModule = {
  name: 'RateEvidence',
  applies: (line) => {
    const st = line.provenance?.sourceType
    // P/S + LS are estimator/contractor-set; they have no underlying
    // unit-rate the Library could match. Skip the rate-evidence
    // check for them — it would always REVIEW noisily.
    return (
      !line.isProvisional &&
      st !== 'MANUAL' &&
      st !== 'IMPORTED' &&
      st !== 'PROVISIONAL_SUM' &&
      st !== 'LUMP_SUM'
    )
  },
  check(line) {
    const p = line.provenance
    if (!p) {
      return {
        module: 'RateEvidence',
        axis: 'rate',
        verdict: 'failed',
        reasons: ['no provenance — cannot assess rate source'],
        resolutionSteps: ['Re-run backfill-line-provenance.ts --force or regenerate the BOQ.'],
        tags: ['MISSING_PROVENANCE'],
      }
    }
    const hasLibraryEvidence = p.evidence.some(
      (e) => e.kind === 'rateLibrary' || e.kind === 'assembly' || e.kind === 'mepRule' || e.kind === 'import',
    )
    if (hasLibraryEvidence) {
      return {
        module: 'RateEvidence',
        axis: 'rate',
        verdict: 'verified',
        reasons: [],
        resolutionSteps: [],
        tags: [],
      }
    }
    return {
      module: 'RateEvidence',
      axis: 'rate',
      verdict: 'review',
      reasons: ['priced line has no rate source link (assembly / rateLibrary / mepRule / supplier import)'],
      resolutionSteps: [
        'Link the line to a Library Assembly, import a supplier rate, OR mark the line provisional with a P/S allowance.',
      ],
      tags: ['NO_RATE_EVIDENCE'],
    }
  },
}

// ─── Module 2 — Confidence threshold ────────────────────────────

const confidenceModule: AuditModule = {
  name: 'Confidence',
  // MANUAL / IMPORTED / PROVISIONAL_SUM / LUMP_SUM are 1.0 by
  // default — they're estimator/contractor-set figures, not
  // computed values, so the confidence threshold is noise.
  applies: (line) => {
    const st = line.provenance?.sourceType
    return (
      st !== 'MANUAL' &&
      st !== 'IMPORTED' &&
      st !== 'PROVISIONAL_SUM' &&
      st !== 'LUMP_SUM'
    )
  },
  check(line) {
    const p = line.provenance
    // CONF-2 — prefer the weighted evidence chain. Fall back to the
    // flat provenance.confidence (back-compat for non-migrated lines)
    // then to the BoqLine.confidence Int.
    const chain = p?.evidenceChain
    let conf: number
    let source: 'chain' | 'flat' = 'flat'
    if (chain && chain.length > 0) {
      conf = computeConfidence(chain)
      source = 'chain'
    } else {
      conf = normalizeConfidence(p?.confidence ?? (line.confidence === null ? 0 : line.confidence))
    }
    if (conf < REVIEW_CONFIDENCE_THRESHOLD) {
      const reasons: string[] = []
      const resolutionSteps: string[] = []
      const tags: string[] = ['LOW_CONF']
      reasons.push(
        `confidence ${conf.toFixed(2)} below threshold ${REVIEW_CONFIDENCE_THRESHOLD}` +
          (source === 'chain' ? ' (weighted-compound from evidence chain)' : ' (flat — no chain)'),
      )
      if (source === 'chain' && chain && chain.length > 0) {
        // Surface the WORST step — the one whose ci^wi pulled the
        // compound down the most. That's the actionable fix.
        const ranked = chain
          .map((s) => ({
            step: s,
            contribution: Math.pow(Math.max(1e-6, Math.min(1, s.confidence)), Math.max(0, Math.min(1, s.weight))),
          }))
          .sort((a, b) => a.contribution - b.contribution)
        const worst = ranked[0]!
        reasons.push(
          `weakest step: ${worst.step.type} "${worst.step.label ?? worst.step.id}" c=${worst.step.confidence.toFixed(2)} w=${worst.step.weight.toFixed(2)} → contributes ${worst.contribution.toFixed(2)}`,
        )
        resolutionSteps.push(
          resolutionFor(worst.step, worst.step.sourceRef),
        )
        // Single combined resolution covers both reasons.
        resolutionSteps.push('See weakest-step resolution above.')
      } else {
        resolutionSteps.push(
          'No evidence chain on this line — populate it (EvidenceStep[] in provenance) so the auditor can pinpoint WHICH assumption is fragile.',
        )
      }
      return {
        module: 'Confidence',
        axis: 'quantity',
        verdict: 'review',
        reasons,
        resolutionSteps,
        tags,
      }
    }
    return {
      module: 'Confidence',
      axis: 'quantity',
      verdict: 'verified',
      reasons: [],
      resolutionSteps: [],
      tags: [],
    }
  },
}

function resolutionFor(
  step: { type: 'EXTRACTION' | 'MEASUREMENT' | 'DERIVATION' | 'ASSUMPTION' | 'PRIOR' },
  sourceRef?: string,
): string {
  const ref = sourceRef ? ` (source: ${sourceRef})` : ''
  switch (step.type) {
    case 'EXTRACTION':
      return `Re-check the source extraction${ref}: open the drawing, verify the value matches what the extractor read.`
    case 'MEASUREMENT':
      return `Verify the geometric computation${ref}: open the source and confirm area/perimeter is right; correct in the takeoff table if not.`
    case 'DERIVATION':
      return `Confirm the formula choice${ref} matches scope (e.g. coats=2 not 1, perimeter excludes openings, etc.).`
    case 'ASSUMPTION':
      return `This is the dangerous step — assumption may not hold for this project${ref}. Either substitute a measured value, or confirm the assumption with project context + bump confidence after verifying.`
    case 'PRIOR':
      return `Prior used as fallback${ref}. Replace with a measured value when available; otherwise confirm the prior fits this project type and bump confidence.`
  }
}

// ─── Registry — modules run in declared order ────────────────────

export const AUDIT_MODULES: AuditModule[] = [
  integrityModule,
  confidenceModule,
  rateEvidenceModule,
  // EngineeringAuditModule plugs in here.
  // ProcurementAuditModule plugs in here.
]

// ─── Public API ──────────────────────────────────────────────────

export function auditLineWithModules(
  line: AuditLineInput,
  modules: AuditModule[] = AUDIT_MODULES,
): LineAuditResult {
  const moduleResults: ModuleResult[] = []
  for (const m of modules) {
    if (m.applies && !m.applies(line)) continue
    moduleResults.push(m.check(line))
  }
  return {
    lineId: line.id,
    status: aggregate(moduleResults),
    quantityVerdict: aggregateAxis(moduleResults, 'quantity'),
    rateVerdict: aggregateAxis(moduleResults, 'rate'),
    modules: moduleResults,
  }
}

/// Build the AuditLineInput from a raw BoqLine row (with parsed
/// provenance). Helper so callers don't repeat the field-pluck.
export function toAuditInput(line: {
  id: string
  itemRef: string
  description: string
  isProvisional: boolean
  confidence: number | null
  takeoffItemId: string | null
  qty: { toString(): string } | null
  rate: { toString(): string } | null
  amount: { toString(): string } | null
  psAmount: { toString(): string } | null
  provenance: unknown
}): AuditLineInput {
  return {
    id: line.id,
    itemRef: line.itemRef,
    description: line.description,
    isProvisional: line.isProvisional,
    confidence: line.confidence,
    takeoffItemId: line.takeoffItemId,
    qty: line.qty?.toString() ?? null,
    rate: line.rate?.toString() ?? null,
    amount: line.amount?.toString() ?? null,
    psAmount: line.psAmount?.toString() ?? null,
    provenance: parseProvenance(line.provenance),
  }
}

// ─── Summary aggregation ─────────────────────────────────────────

export interface AuditSummary {
  total: number
  verified: number
  review: number
  failed: number
  bySourceType: Record<string, { verified: number; review: number; failed: number }>
  byDerivationType: Record<string, { verified: number; review: number; failed: number }>
  bySection: Record<string, { verified: number; review: number; failed: number }>
  topReasons: Array<{ reason: string; module: string; count: number }>
}

export function summarize(
  perLine: Array<{
    input: AuditLineInput
    sectionCode: string
    result: LineAuditResult
  }>,
): AuditSummary {
  const summary: AuditSummary = {
    total: perLine.length,
    verified: 0,
    review: 0,
    failed: 0,
    bySourceType: {},
    byDerivationType: {},
    bySection: {},
    topReasons: [],
  }
  const reasonCounts = new Map<string, { module: string; count: number }>()
  for (const r of perLine) {
    summary[r.result.status] += 1
    const st = r.input.provenance?.sourceType ?? 'UNKNOWN'
    const dt = r.input.provenance?.derivationType ?? 'none'
    summary.bySourceType[st] = summary.bySourceType[st] ?? { verified: 0, review: 0, failed: 0 }
    summary.bySourceType[st]![r.result.status] += 1
    summary.byDerivationType[dt] = summary.byDerivationType[dt] ?? { verified: 0, review: 0, failed: 0 }
    summary.byDerivationType[dt]![r.result.status] += 1
    summary.bySection[r.sectionCode] = summary.bySection[r.sectionCode] ?? { verified: 0, review: 0, failed: 0 }
    summary.bySection[r.sectionCode]![r.result.status] += 1
    for (const m of r.result.modules) {
      for (const reason of m.reasons) {
        const k = `${m.module}: ${reason}`
        const existing = reasonCounts.get(k)
        if (existing) existing.count += 1
        else reasonCounts.set(k, { module: m.module, count: 1 })
      }
    }
  }
  summary.topReasons = [...reasonCounts.entries()]
    .map(([reason, { module, count }]) => ({ reason, module, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
  return summary
}
