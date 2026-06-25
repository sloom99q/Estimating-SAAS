/**
 * Line provenance — the structured "why does this number exist"
 * payload stamped on every BoqLine.
 *
 * Three layers + a fallback:
 *   MEASURED  facts read directly from drawings — room areas from
 *             DXF labels, door counts from schedule tables, etc.
 *             Confidence high; evidence points at the source sheet
 *             + takeoff item.
 *   DERIVED   math on facts — wall paint area = perimeter × height,
 *             screed = Σ floor area, HVAC tonnage = area / 135.
 *             Confidence inherits from the inputs; formula must be
 *             explicit so the auditor can replay it.
 *   ESTIMATED AI guesses bounded by priors — joinery counts, socket
 *             counts, lighting per room. Confidence reflects the
 *             prior strength; reasoning is a short rationale string.
 *   MANUAL    human-typed — P/S allowances, manual overrides.
 *             Evidence points at the user + timestamp.
 *
 * The deterministic auditor (auditLine.ts) reads this payload and
 * decides verified / review / failed without an LLM call.
 *
 * Stored as Prisma Json on BoqLine.provenance; this module is the
 * single source of truth for the shape.
 */
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────
// Evidence — pointers at WHERE the number came from. An array per
// line so a derived line can cite all its source measurements.
// ─────────────────────────────────────────────────────────────────

const EvidenceSheet = z.object({
  kind: z.literal('sheet'),
  sheetId: z.string(),
  drawingNo: z.string().nullable().optional(),
  pageNo: z.number().int().nullable().optional(),
  label: z.string().optional(),
})

const EvidenceTakeoffItem = z.object({
  kind: z.literal('takeoffItem'),
  takeoffItemId: z.string(),
  tag: z.string().nullable().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
})

const EvidenceDocument = z.object({
  kind: z.literal('document'),
  documentId: z.string(),
  filename: z.string(),
  pageNo: z.number().int().nullable().optional(),
})

const EvidenceRateLibrary = z.object({
  kind: z.literal('rateLibrary'),
  code: z.string(),
  scope: z.enum(['org', 'global']),
  rate: z.string(), // Decimal-as-string snapshot
})

const EvidenceAssembly = z.object({
  kind: z.literal('assembly'),
  assemblyId: z.string(),
  name: z.string().optional(),
  brandName: z.string().nullable().optional(),
})

const EvidenceUser = z.object({
  kind: z.literal('user'),
  userId: z.string(),
  at: z.string(),
  note: z.string().optional(),
})

const EvidenceMepRule = z.object({
  kind: z.literal('mepRule'),
  ruleId: z.string(),
  name: z.string().optional(),
  factorSource: z.string().optional(),
  rateSource: z.string().optional(),
})

const EvidenceLegacy = z.object({
  kind: z.literal('legacy'),
  note: z.string(), // for backfilled rows where we only know the rateSource string
})

export const Evidence = z.discriminatedUnion('kind', [
  EvidenceSheet,
  EvidenceTakeoffItem,
  EvidenceDocument,
  EvidenceRateLibrary,
  EvidenceAssembly,
  EvidenceUser,
  EvidenceMepRule,
  EvidenceLegacy,
])
export type Evidence = z.infer<typeof Evidence>

// ─────────────────────────────────────────────────────────────────
// Inputs — for DERIVED lines, the named values that fed the formula.
// ─────────────────────────────────────────────────────────────────

export const ProvenanceInput = z.object({
  name: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  /// Optional pointer back at the upstream measurement for the input.
  /// Same shape as the line-level evidence so the auditor can chain.
  source: Evidence.optional(),
})
export type ProvenanceInput = z.infer<typeof ProvenanceInput>

// ─────────────────────────────────────────────────────────────────
// The payload itself.
// ─────────────────────────────────────────────────────────────────

export const SourceType = z.enum(['MEASURED', 'DERIVED', 'ESTIMATED', 'MANUAL'])
export type SourceType = z.infer<typeof SourceType>

export const LineProvenance = z.object({
  sourceType: SourceType,
  evidence: z.array(Evidence).min(1),
  /// Required for non-MANUAL lines. Plain-text math expression that
  /// the auditor displays alongside the inputs (e.g. 'wallArea = perimeter × height').
  formula: z.string().optional(),
  inputs: z.array(ProvenanceInput).optional(),
  /// Required-ish for ESTIMATED lines (auditor flags ESTIMATED-
  /// without-reasoning as review).
  reasoning: z.string().optional(),
  /// Mirror of BoqLine.confidence at write time, so audit reports
  /// surface the snapshot value even when the live confidence drifts.
  confidence: z.number().int().min(0).max(100).optional(),
  /// Free-form authoring hint — which code path wrote the line.
  /// Useful for ops debugging ('PRICE.tier1.assembly',
  /// 'addProvisionalBoqLine.route', 'backfill.v1').
  stampedBy: z.string().optional(),
})
export type LineProvenance = z.infer<typeof LineProvenance>

// ─────────────────────────────────────────────────────────────────
// Helper builders — convenience for the write paths so they don't
// have to assemble the object literally each time.
// ─────────────────────────────────────────────────────────────────

export function measured(args: {
  evidence: Evidence[]
  formula?: string
  inputs?: ProvenanceInput[]
  confidence?: number
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'MEASURED',
    evidence: args.evidence,
    formula: args.formula,
    inputs: args.inputs,
    confidence: args.confidence,
    stampedBy: args.stampedBy,
  }
}

export function derived(args: {
  evidence: Evidence[]
  formula: string
  inputs: ProvenanceInput[]
  confidence?: number
  stampedBy: string
  reasoning?: string
}): LineProvenance {
  return {
    sourceType: 'DERIVED',
    evidence: args.evidence,
    formula: args.formula,
    inputs: args.inputs,
    confidence: args.confidence,
    reasoning: args.reasoning,
    stampedBy: args.stampedBy,
  }
}

export function estimated(args: {
  evidence: Evidence[]
  reasoning: string
  formula?: string
  inputs?: ProvenanceInput[]
  confidence?: number
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'ESTIMATED',
    evidence: args.evidence,
    reasoning: args.reasoning,
    formula: args.formula,
    inputs: args.inputs,
    confidence: args.confidence,
    stampedBy: args.stampedBy,
  }
}

export function manual(args: {
  userId: string
  at?: string
  note?: string
  confidence?: number
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'MANUAL',
    evidence: [
      {
        kind: 'user',
        userId: args.userId,
        at: args.at ?? new Date().toISOString(),
        note: args.note,
      },
    ],
    confidence: args.confidence ?? 100,
    stampedBy: args.stampedBy,
  }
}

/// Safe parse for reads from the DB. Returns the typed payload or
/// null when the line predates TR-1. Never throws.
export function parseProvenance(raw: unknown): LineProvenance | null {
  if (!raw) return null
  const r = LineProvenance.safeParse(raw)
  return r.success ? r.data : null
}
