/**
 * Line provenance / lineage payload — the structured "why does
 * this number exist" record stamped on every BoqLine.
 *
 * Five source types + a derivation typing:
 *
 *   MEASURED   facts read directly from drawings (room areas from
 *              DXF labels, door schedule rows, etc.). No derivation.
 *   DERIVED    math on facts (paint area = perimeter × height,
 *              screed = Σ floor area). derivationType='formula' or
 *              'rule'. Both produce numbers from other numbers.
 *   ESTIMATED  AI guesses bounded by priors (joinery counts, socket
 *              counts). derivationType='ai_reasoning' — a narrative
 *              like "4-bed villa, UAE norm, 43 sockets" replaces the
 *              equation.
 *   MANUAL     human-typed (P/S allowances, overrides). Evidence
 *              points at the user + timestamp.
 *   IMPORTED   external source (supplier quote, consultant BOQ,
 *              vendor catalog row, Excel import). Different from
 *              MANUAL — the human didn't compose the line, they
 *              imported it. Evidence points at the document.
 *
 * Confidence is 0-1 here (mirrored). BoqLine.confidence Int stays as
 * 0-100 for back-compat; the auditor reads provenance.confidence
 * (the 0-1 normalised value).
 *
 * Sheet evidence carries optional coordinates (bbox + extractedValue)
 * so the future SPA viewer can highlight the exact spot on the
 * drawing the number came from. Coords are nullable — populated
 * where the upstream extraction has them, empty for older sources.
 */
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────
// Geometry — bounding box on a sheet/page so the viewer can frame
// the source. Units: DXF coords (modelspace mm) for DXF sources;
// PDF page-space points for vision-extracted sources.
// ─────────────────────────────────────────────────────────────────

const BBox = z.object({
  /// Coordinate system the bbox is in. 'dxf-mm' = DXF modelspace
  /// millimetres; 'pdf-pt' = PDF page-space points; 'pdf-pct' =
  /// percentage of page (0-100, useful for vision crops).
  cs: z.enum(['dxf-mm', 'pdf-pt', 'pdf-pct']),
  x: z.number(),
  y: z.number(),
  w: z.number().optional(),
  h: z.number().optional(),
})
export type BBox = z.infer<typeof BBox>

// ─────────────────────────────────────────────────────────────────
// Evidence — pointers at WHERE the number came from. Array per line
// so a derived line can cite all its source measurements.
// ─────────────────────────────────────────────────────────────────

const EvidenceSheet = z.object({
  kind: z.literal('sheet'),
  sheetId: z.string(),
  drawingNo: z.string().nullable().optional(),
  pageNo: z.number().int().nullable().optional(),
  label: z.string().optional(),
  /// EVIDENCE-1 (2026-06-27) — the architect's sheet TITLE
  /// ("DOOR SCHEDULE", "GLAZING TYPES"). Without it the chip read
  /// `sheet A551 p27` and engineers flipping to the page couldn't
  /// confirm at a glance they were on the right sheet — felt like
  /// fabrication. Title makes the ref self-verifying.
  sheetTitle: z.string().optional(),
  /// EVIDENCE-1 — the source-PDF filename. Critical when a project
  /// has multiple uploaded documents (plot4357.pdf, addendum.pdf,
  /// etc.) — page 27 of which doc?
  sourceDocFilename: z.string().optional(),
  /// EVIDENCE-1 — sheet TYPE the classifier assigned (schedule /
  /// plan / detail / legend / etc.). Helps engineer disambiguate
  /// "schedule sheet" from "details adjacent to schedule".
  sheetType: z.string().optional(),
  /// TR-3 — drawing coordinates so the SPA viewer can highlight
  /// the exact spot. Populated by the DXF MTEXT/INSERT extractor
  /// (modelspace position is known); null for older vision
  /// extractions that didn't preserve bbox.
  bbox: BBox.optional(),
  /// TR-3 — the raw text the extractor read at the bbox before any
  /// post-processing. Examples: 'GF-04 58.82 m²' (DXF MTEXT),
  /// 'D01' (door tag). For audit: "what did we actually see in the
  /// drawing" vs the derived value.
  extractedValue: z.string().optional(),
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
  bbox: BBox.optional(),
})

const EvidenceRateLibrary = z.object({
  kind: z.literal('rateLibrary'),
  code: z.string(),
  scope: z.enum(['org', 'global']),
  rate: z.string(),
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

const EvidenceImport = z.object({
  kind: z.literal('import'),
  /// 'supplier-quote' | 'consultant-boq' | 'excel-import' |
  /// 'vendor-catalog' | 'other'
  importType: z.string(),
  /// Name / ref of the source artefact (the consultant's
  /// "Estimator 2024-04.xlsx" or the supplier's quote PDF).
  sourceLabel: z.string(),
  importedAt: z.string(),
  importedBy: z.string().optional(),
})

const EvidenceLegacy = z.object({
  kind: z.literal('legacy'),
  note: z.string(),
})

export const Evidence = z.discriminatedUnion('kind', [
  EvidenceSheet,
  EvidenceTakeoffItem,
  EvidenceDocument,
  EvidenceRateLibrary,
  EvidenceAssembly,
  EvidenceUser,
  EvidenceMepRule,
  EvidenceImport,
  EvidenceLegacy,
])
export type Evidence = z.infer<typeof Evidence>

// ─────────────────────────────────────────────────────────────────
// Evidence chain — weighted-multiplicative confidence propagation.
//
// CONF-1 (2026-06-25). Replaces flat per-line confidence with a chain
// of EvidenceStep nodes, one per uncertainty introduced on the way to
// the line's quantity. Each step carries:
//
//   confidence  0..1   our trust in THIS step in isolation
//   weight      0..1   how much this step's uncertainty matters to
//                       the final-quantity correctness
//
// Compounded as Π(ci^wi) — pure multiplication would collapse deep
// chains toward zero (especially MEP), destroying the signal. Raising
// each ci to its weight first makes low-weight uncertainties hit
// softly + high-weight ones hit hard, so fragile lines drop and solid
// ones stay high — that's the signal.
//
// Step TYPES tell you what kind of uncertainty entered:
//   EXTRACTION   reading a value off a drawing/document (OCR, MTEXT,
//                vision). Failure mode: misread.
//   MEASUREMENT  geometric computation on extracted coords (area,
//                perimeter). Failure mode: bad geometry.
//   DERIVATION   formula applied to facts (paint area = perimeter ×
//                height × coats). Failure mode: wrong formula choice.
//   ASSUMPTION   value asserted, not measured (height=3.0m, sockets-
//                per-bedroom=8, rate=2,800 AED/TR). Failure mode: not
//                true for THIS project.
//   PRIOR        bounded guess from training/heuristic (aspect-ratio
//                prior over room area). Failure mode: project outside
//                the prior.
//
// LATERAL CONFIDENCE (cross-validation bonus / conflict penalty)
// deliberately deferred — get weighted propagation stable first.
// ─────────────────────────────────────────────────────────────────

export const EvidenceStepType = z.enum([
  'EXTRACTION',
  'MEASUREMENT',
  'DERIVATION',
  'ASSUMPTION',
  'PRIOR',
])
export type EvidenceStepType = z.infer<typeof EvidenceStepType>

export const EvidenceStep = z.object({
  /// Stable id so SPA can highlight which step to fix.
  id: z.string(),
  type: EvidenceStepType,
  /// 0..1 — confidence in THIS step alone.
  confidence: z.number().min(0).max(1),
  /// 0..1 — importance to the line's final quantity. Higher = a
  /// wrong value here moves the answer more. Default per type from
  /// DEFAULT_WEIGHTS below; rules + lines may override.
  weight: z.number().min(0).max(1),
  /// Human-readable label rendered in the audit chip + review queue
  /// ("Room area extracted from DXF MTEXT label").
  label: z.string().optional(),
  /// Where to look to resolve / verify this step. Free text for now;
  /// SPA renders alongside resolution steps.
  sourceRef: z.string().optional(),
})
export type EvidenceStep = z.infer<typeof EvidenceStep>

/// Default importance weights by step type. The intuition encoded
/// here: ASSUMPTION + PRIOR hit hardest because they're the steps
/// most likely to be wrong for THIS project; EXTRACTION is moderate
/// because a misread is usually cross-checkable; DERIVATION is low
/// because the formula itself is exact (only as wrong as its inputs).
export const DEFAULT_WEIGHTS: Record<EvidenceStepType, number> = {
  EXTRACTION: 0.6,
  MEASUREMENT: 0.7,
  DERIVATION: 0.5,
  ASSUMPTION: 0.8,
  PRIOR: 0.5,
}

/// Pure, deterministic. C = Π(ci^wi). Returns 1 for an empty chain
/// (interpreted as "no uncertainty modelled" — usually means an
/// EXTRACTION step is missing; the auditor surfaces empty chains as
/// review).
export function computeConfidence(steps: EvidenceStep[] | null | undefined): number {
  if (!steps || steps.length === 0) return 1
  let acc = 1
  for (const s of steps) {
    // Clamp into the open interval (epsilon, 1] to avoid log(0) /
    // 0^0 weirdness when a step is stamped at confidence 0 or
    // weight 0.
    const c = Math.max(1e-6, Math.min(1, s.confidence))
    const w = Math.max(0, Math.min(1, s.weight))
    acc *= Math.pow(c, w)
  }
  return acc
}

/// Convenience — build a step from its type, picking the default
/// weight unless overridden.
export function step(args: {
  id: string
  type: EvidenceStepType
  confidence: number
  weight?: number
  label?: string
  sourceRef?: string
}): EvidenceStep {
  return {
    id: args.id,
    type: args.type,
    confidence: args.confidence,
    weight: args.weight ?? DEFAULT_WEIGHTS[args.type],
    ...(args.label !== undefined ? { label: args.label } : {}),
    ...(args.sourceRef !== undefined ? { sourceRef: args.sourceRef } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────
// Inputs — for derived/rule lines, the named values that fed the
// computation.
// ─────────────────────────────────────────────────────────────────

export const ProvenanceInput = z.object({
  name: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  source: Evidence.optional(),
})
export type ProvenanceInput = z.infer<typeof ProvenanceInput>

// ─────────────────────────────────────────────────────────────────
// The payload.
// ─────────────────────────────────────────────────────────────────

/// CLASSIFIER-5 (2026-06-27) — added PROVISIONAL_SUM + LUMP_SUM as
/// first-class statuses so the audit chip on a BOQ line is honest
/// instead of forcing every non-priced line through MANUAL:
///
///   PROVISIONAL_SUM (P/S) — allowance set aside pending supplier
///     quote / scope confirmation. Stone cladding, façade, home
///     automation, windows. Estimator-set figure, NOT computed
///     from the drawing.
///   LUMP_SUM (LS) — supplier quote already in hand, contractor
///     has confirmed the whole-scope number. Joinery is the
///     canonical case. Has a fixed price; the BOQ doesn't break
///     it into qty × rate.
///
/// TR-3 — added IMPORTED for supplier quotes / consultant BOQ /
/// vendor catalogs. Different from MANUAL: the human didn't compose
/// the line, they pulled it from an external source.
export const SourceType = z.enum([
  'MEASURED',
  'DERIVED',
  'ESTIMATED',
  'MANUAL',
  'IMPORTED',
  'PROVISIONAL_SUM',
  'LUMP_SUM',
])
export type SourceType = z.infer<typeof SourceType>

/// TR-3 — how the line's value was produced.
///   formula        an equation (e.g. 'wallArea = perimeter × height')
///   rule           a named rule fired (MEP rule, finish-code map)
///   ai_reasoning   an AI prior produced a narrative (e.g. "4-bed
///                  villa, UAE norm, 43 sockets")
///   null           MEASURED or MANUAL or IMPORTED — no derivation
export const DerivationType = z.enum(['formula', 'rule', 'ai_reasoning'])
export type DerivationType = z.infer<typeof DerivationType>

export const LineProvenance = z.object({
  sourceType: SourceType,
  /// Required for DERIVED + ESTIMATED. Forbidden for MEASURED /
  /// MANUAL / IMPORTED (the audit module enforces).
  derivationType: DerivationType.nullable().optional(),
  evidence: z.array(Evidence).min(1),
  /// Required when derivationType='formula'.
  formula: z.string().optional(),
  /// Required when derivationType='rule'. Points at the rule that
  /// fired (e.g. 'mep-rule:hvac-tonnage', 'finish-code-map:ST01').
  ruleRef: z.string().optional(),
  /// Required when derivationType='ai_reasoning'. Also used as
  /// optional rationale for ESTIMATED lines.
  reasoning: z.string().optional(),
  inputs: z.array(ProvenanceInput).optional(),
  /// TR-3 — flat confidence (0..1). Back-compat for lines not yet
  /// migrated to evidenceChain. Auditor prefers chain when present.
  confidence: z.number().min(0).max(1).optional(),
  /// CONF-1 — weighted evidence chain. Auditor uses
  /// computeConfidence(evidenceChain) when present, falling back to
  /// the flat `confidence` field for back-compat. Empty/missing
  /// chain on a non-MANUAL line is a soft warning (no provenance
  /// modelling — please add steps).
  evidenceChain: z.array(EvidenceStep).optional(),
  stampedBy: z.string().optional(),
})
export type LineProvenance = z.infer<typeof LineProvenance>

// ─────────────────────────────────────────────────────────────────
// Helper builders.
// ─────────────────────────────────────────────────────────────────

export function measured(args: {
  evidence: Evidence[]
  confidence?: number
  evidenceChain?: EvidenceStep[]
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'MEASURED',
    derivationType: null,
    evidence: args.evidence,
    confidence: args.confidence,
    evidenceChain: args.evidenceChain,
    stampedBy: args.stampedBy,
  }
}

export function derivedByFormula(args: {
  evidence: Evidence[]
  formula: string
  inputs?: ProvenanceInput[]
  confidence?: number
  evidenceChain?: EvidenceStep[]
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'DERIVED',
    derivationType: 'formula',
    evidence: args.evidence,
    formula: args.formula,
    inputs: args.inputs,
    confidence: args.confidence,
    evidenceChain: args.evidenceChain,
    stampedBy: args.stampedBy,
  }
}

export function derivedByRule(args: {
  evidence: Evidence[]
  ruleRef: string
  reasoning?: string
  inputs?: ProvenanceInput[]
  confidence?: number
  evidenceChain?: EvidenceStep[]
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'DERIVED',
    derivationType: 'rule',
    evidence: args.evidence,
    ruleRef: args.ruleRef,
    reasoning: args.reasoning,
    inputs: args.inputs,
    confidence: args.confidence,
    evidenceChain: args.evidenceChain,
    stampedBy: args.stampedBy,
  }
}

export function estimated(args: {
  evidence: Evidence[]
  reasoning: string
  inputs?: ProvenanceInput[]
  confidence?: number
  evidenceChain?: EvidenceStep[]
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'ESTIMATED',
    derivationType: 'ai_reasoning',
    evidence: args.evidence,
    reasoning: args.reasoning,
    inputs: args.inputs,
    confidence: args.confidence,
    evidenceChain: args.evidenceChain,
    stampedBy: args.stampedBy,
  }
}

export function manual(args: {
  userId: string
  at?: string
  note?: string
  confidence?: number
  evidenceChain?: EvidenceStep[]
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'MANUAL',
    derivationType: null,
    evidence: [
      {
        kind: 'user',
        userId: args.userId,
        at: args.at ?? new Date().toISOString(),
        note: args.note,
      },
    ],
    confidence: args.confidence ?? 1,
    evidenceChain: args.evidenceChain,
    stampedBy: args.stampedBy,
  }
}

/// CLASSIFIER-5 — collapsed P/S line. Allowance pending supplier
/// quote / scope confirmation; estimator-set figure.
export function provisionalSum(args: {
  evidence: Evidence[]
  reasoning?: string
  evidenceChain?: EvidenceStep[]
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'PROVISIONAL_SUM',
    derivationType: null,
    evidence: args.evidence,
    reasoning: args.reasoning,
    evidenceChain: args.evidenceChain,
    confidence: 1,
    stampedBy: args.stampedBy,
  }
}

/// CLASSIFIER-5 — collapsed LS line. Supplier quote already in
/// hand; fixed price for the whole scope (joinery, kitchens).
export function lumpSum(args: {
  evidence: Evidence[]
  reasoning?: string
  evidenceChain?: EvidenceStep[]
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'LUMP_SUM',
    derivationType: null,
    evidence: args.evidence,
    reasoning: args.reasoning,
    evidenceChain: args.evidenceChain,
    confidence: 1,
    stampedBy: args.stampedBy,
  }
}

export function imported(args: {
  importType: string
  sourceLabel: string
  importedAt?: string
  importedBy?: string
  extraEvidence?: Evidence[]
  confidence?: number
  stampedBy: string
}): LineProvenance {
  return {
    sourceType: 'IMPORTED',
    derivationType: null,
    evidence: [
      {
        kind: 'import',
        importType: args.importType,
        sourceLabel: args.sourceLabel,
        importedAt: args.importedAt ?? new Date().toISOString(),
        importedBy: args.importedBy,
      },
      ...(args.extraEvidence ?? []),
    ],
    confidence: args.confidence ?? 1,
    stampedBy: args.stampedBy,
  }
}

/// Safe parse for DB reads. Returns null on missing or invalid
/// payloads — auditor handles null explicitly as 'failed'.
export function parseProvenance(raw: unknown): LineProvenance | null {
  if (!raw) return null
  const r = LineProvenance.safeParse(raw)
  return r.success ? r.data : null
}

/// Normalise a confidence value from any source. Legacy fields are
/// 0-100 Int; the new provenance field is 0-1 number. This bridges
/// both for the auditor.
export function normalizeConfidence(rawConfidence: number | null | undefined): number {
  if (rawConfidence == null) return 0
  if (rawConfidence <= 1) return rawConfidence
  return rawConfidence / 100
}
