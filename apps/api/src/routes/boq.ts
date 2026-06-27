import type { Prisma, TakeoffStatus } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import { renderBoqXlsx, type XlsxBoq } from '../pricing/exportXlsx'
import { toXlsxLine } from '../pricing/xlsxLineProvenance'
import {
  DEFAULT_PROVISIONAL_AED,
  MEP_CATEGORIES,
  effectiveEstimability,
  parseEstimabilityOverrides,
  type EstimabilityOverrides,
} from '../pricing/estimability'
import {
  classifyLine,
  loadRateLibrarySnapshot,
  type LineClassification,
} from '../pricing/lineClassifier'
import type { Estimability, TakeoffCategory } from '@prisma/client'
import { recomputeBoqTotals } from '../pricing/recomputeBoqTotals'
import {
  type Evidence,
  type EvidenceStep,
  type LineProvenance,
  EvidenceStep as EvidenceStepZ,
  computeConfidence,
  derivedByFormula,
  derivedByRule,
  estimated as estimatedProvenance,
  manual as manualProvenance,
  measured as measuredProvenance,
  normalizeConfidence,
  parseProvenance,
} from '../pricing/lineProvenance'
import { upsertValidationFlag } from '../jobs/validationFlagUpsert'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

/**
 * Triple-A section structure for the BOQ. Each TakeoffItem category falls
 * into exactly one section. ROOM is informational only — it goes into
 * General so the BOQ can be cross-referenced against the extracted rooms,
 * but the rooms themselves carry no rate.
 */
interface SectionDef {
  code: string
  title: string
  sortOrder: number
}

const SECTIONS: Record<string, SectionDef> = {
  '1.0': { code: '1.0', title: 'General', sortOrder: 10 },
  '2.5': { code: '2.5', title: 'Metal', sortOrder: 25 },
  '2.6': { code: '2.6', title: 'Wood', sortOrder: 26 },
  '2.7': { code: '2.7', title: 'MEP — HVAC', sortOrder: 27 },
  '2.71': { code: '2.71', title: 'MEP — Electrical', sortOrder: 271 },
  '2.72': { code: '2.72', title: 'MEP — Plumbing', sortOrder: 272 },
  '2.73': { code: '2.73', title: 'MEP — ELV', sortOrder: 273 },
  '2.8': { code: '2.8', title: 'Doors / Windows / Glazing', sortOrder: 28 },
  '2.9': { code: '2.9', title: 'Finishes', sortOrder: 29 },
  '3.1': { code: '3.1', title: 'External', sortOrder: 31 },
  '4.0': { code: '4.0', title: 'Provisional Sums', sortOrder: 40 },
}

/**
 * Sprint-4 S4-4: ROOM is INTENTIONALLY ABSENT. Rooms are inputs to QUANTIFY,
 * not BOQ line items. The Sprint-3 live run contaminated the BOQ with 154
 * "1.0 General" room-as-line entries that priced as Provisional Sums and
 * confused the export.
 */
/// CLASSIFIER-2 — human-readable discipline label for collapsed
/// PROVISIONAL lines. Used as the BoqLine.description prefix.
const MEP_DISCIPLINE_LABEL: Partial<Record<TakeoffCategory, string>> = {
  MEP_HVAC: 'HVAC',
  MEP_ELEC: 'Electrical',
  MEP_PLUMB: 'Plumbing + Drainage',
  MEP_ELV: 'ELV / Low-current',
  JOINERY: 'Joinery',
  METAL: 'Metal works',
  GRC: 'GRC',
  EXTERNAL: 'External / Landscape',
  SKIRTING: 'Skirting',
  STONE_CLADDING: 'Stone cladding',
  FACADE_SCREEN: 'Façade feature screen',
  HOME_AUTOMATION: 'Home automation',
}

const CATEGORY_TO_SECTION: Record<string, string> = {
  OTHER: '1.0',
  METAL: '2.5',
  GRC: '2.5',
  JOINERY: '2.6',
  DOOR: '2.8',
  WINDOW: '2.8',
  FLOOR_FINISH: '2.9',
  WALL_FINISH: '2.9',
  CEILING: '2.9',
  SCREED: '2.9',
  /** AI-est roadmap #1 — skirting is finishes work. */
  SKIRTING: '2.9',
  PAINT: '2.9',
  PLASTER: '2.9',
  BLOCKWORK: '2.9',
  WATERPROOFING: '2.9',
  SANITARY: '2.9',
  EXTERNAL: '3.1',
  STRUCTURE_PROV: '4.0',
  MEP_PROV: '4.0',
  // MEP-5 — rule-engine emissions land in the 2.7 section family
  // (one section per discipline). MEP_PROV stays as the manual P/S
  // bucket in 4.0 for one-off allowances the rule engine can't
  // quantify.
  MEP_HVAC: '2.7',
  MEP_ELEC: '2.71',
  MEP_PLUMB: '2.72',
  MEP_ELV: '2.73',
  // SPRINT-1.3 — three new P/S categories land in section 4.0
  // (matches how UAE contractors structure quotes — these all
  // live in the Provisional Sums bill).
  STONE_CLADDING: '4.0',
  FACADE_SCREEN: '4.0',
  HOME_AUTOMATION: '4.0',
}

/** Categories explicitly excluded from BOQ generation. */
const NEVER_BOQ = new Set(['ROOM'])

const generateBody = z
  .object({
    onlyApproved: z.boolean().optional(),
  })
  .optional()

function boqDto(row: {
  id: string
  organizationId: string
  projectId: string
  version: number
  status: string
  currency: string
  subtotal: Prisma.Decimal | null
  totalProvisional: Prisma.Decimal | null
  createdAt: Date
  updatedAt: Date
  sections: Array<{
    id: string
    code: string
    title: string
    sortOrder: number
    subtotal: Prisma.Decimal | null
    lines: Array<{
      id: string
      itemRef: string
      description: string
      unit: string
      qty: Prisma.Decimal | null
      rate: Prisma.Decimal | null
      rateSource: string | null
      amount: Prisma.Decimal | null
      isProvisional: boolean
      psAmount: Prisma.Decimal | null
      confidence: number | null
      takeoffItemId: string | null
      assemblyId: string | null
      sortOrder: number
    }>
  }>
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    version: row.version,
    status: row.status,
    currency: row.currency,
    subtotal: row.subtotal === null ? null : row.subtotal.toString(),
    totalProvisional: row.totalProvisional === null ? null : row.totalProvisional.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sections: row.sections.map((s) => ({
      id: s.id,
      code: s.code,
      title: s.title,
      sortOrder: s.sortOrder,
      subtotal: s.subtotal === null ? null : s.subtotal.toString(),
      lines: s.lines.map((l) => ({
        id: l.id,
        itemRef: l.itemRef,
        description: l.description,
        unit: l.unit,
        qty: l.qty === null ? null : l.qty.toString(),
        rate: l.rate === null ? null : l.rate.toString(),
        rateSource: l.rateSource,
        amount: l.amount === null ? null : l.amount.toString(),
        isProvisional: l.isProvisional,
        psAmount: l.psAmount === null ? null : l.psAmount.toString(),
        confidence: l.confidence,
        takeoffItemId: l.takeoffItemId,
        assemblyId: l.assemblyId,
        sortOrder: l.sortOrder,
      })),
    })),
  }
}

/**
 * TR-2 (2026-06-25) — build a LineProvenance for a fresh BoqLine
 * created from a TakeoffItem. Same inference logic as the
 * backfill, but applied at generate time so new lines have
 * provenance from the moment they exist.
 */
type TakeoffForProvenance = {
  id: string
  tag: string | null
  description: string
  category: string
  basis: string
  confidence: number
  sourceNote: string | null
  meta: unknown
  sourceSheet: {
    id: string
    drawingNo: string | null
    pageNo: number
    // EVIDENCE-1 — title + sheetType + parent document filename so
    // the evidence chip on the BoqLine self-verifies.
    title: string | null
    sheetType: string | null
    document: { filename: string } | null
  } | null
}

function buildAutoLineProvenance(
  item: TakeoffForProvenance,
  isProvisional: boolean,
): LineProvenance {
  // Sheet evidence — populate bbox from the takeoff's DXF coords if
  // the upstream parser stashed them in meta.position. TR-3 ⇒ enables
  // the viewer to highlight the exact spot on the drawing.
  const meta = (item.meta ?? {}) as Record<string, unknown>
  const pos = (meta.position ?? meta.bbox) as
    | { x?: number; y?: number; w?: number; h?: number; cs?: string }
    | undefined
  const extracted =
    typeof meta.extractedValue === 'string'
      ? (meta.extractedValue as string)
      : (item.sourceNote ?? undefined)

  const evidence: Evidence[] = [
    {
      kind: 'takeoffItem',
      takeoffItemId: item.id,
      tag: item.tag,
      description: item.description.slice(0, 100),
      category: item.category,
    },
  ]
  if (item.sourceSheet) {
    evidence.push({
      kind: 'sheet',
      sheetId: item.sourceSheet.id,
      drawingNo: item.sourceSheet.drawingNo,
      pageNo: item.sourceSheet.pageNo,
      label: item.sourceNote ?? undefined,
      ...(item.sourceSheet.title ? { sheetTitle: item.sourceSheet.title } : {}),
      ...(item.sourceSheet.sheetType ? { sheetType: item.sourceSheet.sheetType } : {}),
      ...(item.sourceSheet.document?.filename
        ? { sourceDocFilename: item.sourceSheet.document.filename }
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
      ...(extracted ? { extractedValue: extracted } : {}),
    })
  }
  // CONF-3 — pick up the chain QUANTIFY (or the MEP / paint / vanity
  // emitters) attached on the TakeoffItem's meta. The chain is the
  // primary truth for confidence; the flat `conf` is a back-compat
  // mirror computed off the same chain for legacy readers.
  const rawChain = Array.isArray(meta.evidenceChain) ? meta.evidenceChain : null
  const parsedChain = rawChain
    ? rawChain
        .map((s) => EvidenceStepZ.safeParse(s))
        .filter((r): r is { success: true; data: EvidenceStep } => r.success)
        .map((r) => r.data)
    : []
  const evidenceChain: EvidenceStep[] | undefined =
    parsedChain.length > 0 ? parsedChain : undefined
  const conf =
    evidenceChain && evidenceChain.length > 0
      ? computeConfidence(evidenceChain)
      : normalizeConfidence(item.confidence)

  // MEP-5 — rule-driven MEP lines use derivedByRule. Evidence picks
  // up the mepRule kind with factorSource + rateSource so the audit
  // chip shows "factor from engineer-takeoff" / "rate PLACEHOLDER".
  // The confidence already reflects min(factor,rate) from the rule
  // (QUANTIFY did the math).
  if (typeof meta.mepRuleId === 'string') {
    const mepEvidence: Evidence = {
      kind: 'mepRule',
      ruleId: meta.mepRuleId as string,
      name:
        typeof meta.mepDiscipline === 'string'
          ? `${meta.mepDiscipline as string} / ${item.description}`
          : item.description,
      ...(typeof meta.mepFactorSource === 'string'
        ? { factorSource: meta.mepFactorSource as string }
        : {}),
      ...(typeof meta.mepRateSource === 'string'
        ? { rateSource: meta.mepRateSource as string }
        : {}),
    }
    return derivedByRule({
      evidence: [...evidence, mepEvidence],
      ruleRef: `mep-rule:${meta.mepRuleId as string}`,
      reasoning:
        typeof meta.mepFormulaText === 'string'
          ? (meta.mepFormulaText as string)
          : `Derived from MEP rule ${meta.mepRuleId as string}`,
      confidence: conf,
      evidenceChain,
      stampedBy: 'generateBoq.auto.mep',
    })
  }

  // Map takeoff basis → line sourceType + derivation. The integrity
  // auditor enforces:
  //   MEASURED  → no derivation (qty IS the measurement)
  //   DERIVED   → derivationType=formula + formula
  //   ESTIMATED → derivationType=ai_reasoning + reasoning
  const formula = isProvisional
    ? `psAmount carried from takeoff ${item.tag ?? item.description.slice(0, 30)}`
    : 'amount = qty × rate'

  switch (item.basis) {
    case 'MEASURED':
    case 'VISUAL':
      // A pure-measured line — auditor accepts derivationType=null
      // even when there's a rate, since the *quantity* is what was
      // measured and pricing is a downstream step, not a derivation.
      return measuredProvenance({
        evidence,
        confidence: conf,
        evidenceChain,
        stampedBy: 'generateBoq.auto',
      })
    case 'DERIVED':
    case 'PARAMETRIC':
      return derivedByFormula({
        evidence,
        formula,
        confidence: conf,
        evidenceChain,
        stampedBy: 'generateBoq.auto',
      })
    case 'ESTIMATED':
    case 'PLACEHOLDER': {
      const reasoning =
        typeof meta.estimationReasoning === 'string'
          ? (meta.estimationReasoning as string)
          : (item.sourceNote ?? `Estimated from ${item.category} prior`)
      return estimatedProvenance({
        evidence,
        reasoning,
        confidence: conf,
        evidenceChain,
        stampedBy: 'generateBoq.auto',
      })
    }
    default:
      // Unknown basis — fall back to ESTIMATED so the auditor surfaces
      // it as a review item instead of failing structurally.
      return estimatedProvenance({
        evidence,
        reasoning: `Unknown takeoff basis '${item.basis}' — defaulted to ESTIMATED`,
        confidence: conf,
        evidenceChain,
        stampedBy: 'generateBoq.auto',
      })
  }
}

/**
 * CLASSIFIER-2/5 — build provenance for a collapsed BoqLine that
 * rolls N TakeoffItems into ONE P/S or LS row. The kind ('P/S' or
 * 'LS') sets the sourceType so the audit chip stays honest:
 *   PROVISIONAL_SUM — allowance pending (estimator-set)
 *   LUMP_SUM        — supplier-quoted whole-scope (contractor-set)
 * The evidence array lists each rolled-up item so the engineer can
 * drill back into the originals via the SPA / XLSX evidence chip.
 */
function buildCollapsedCollapseProvenance(
  items: TakeoffForProvenance[],
  category: TakeoffCategory,
  psAmount: number | null | undefined,
  kind: 'PROVISIONAL_SUM' | 'LUMP_SUM',
): LineProvenance {
  const evidence: Evidence[] = items.slice(0, 25).map((it) => ({
    kind: 'takeoffItem' as const,
    takeoffItemId: it.id,
    tag: it.tag,
    description: it.description.slice(0, 80),
    category: it.category,
  }))
  if (items.length > 25) {
    evidence.push({
      kind: 'legacy',
      note: `+${items.length - 25} more takeoff items rolled up`,
    })
  }
  const kindLabel = kind === 'PROVISIONAL_SUM' ? 'P/S allowance' : 'LS supplier-quote allowance'
  evidence.push({
    kind: 'legacy',
    note: `Contractor-typical ${kindLabel} for ${category} — ${
      psAmount != null
        ? `${psAmount.toLocaleString('en-AE')} AED from engineer-takeoff defaults`
        : 'allowance pending estimator confirmation'
    }. The app deliberately does not estimate this discipline from the drawing; a contractor / supplier confirms the number.`,
  })
  return {
    sourceType: kind,
    derivationType: null,
    evidence,
    confidence: 1,
    stampedBy: kind === 'PROVISIONAL_SUM' ? 'generateBoq.provisionalCollapse' : 'generateBoq.lumpSumCollapse',
  }
}

/**
 * SPRINT-1.2 — provenance for an UNPRICED rate-pending line. Quantity
 * still has its full evidence chain (paint / skirting / derived-rule
 * etc.); the rate side carries an explicit "RATE MISSING" /
 * "RATE SLOT MISSING" note so the audit chip is honest.
 */
function buildUnpricedLineProvenance(
  item: TakeoffForProvenance,
  verdict: LineClassification | undefined,
): LineProvenance {
  // Reuse the standard auto-provenance builder for the quantity
  // side (preserves the evidence chain), then layer a rate-side
  // warning evidence on top.
  const baseProv = buildAutoLineProvenance(item, false)
  const warningText =
    verdict?.warning === 'RATE_SLOT_MISSING'
      ? `RATE SLOT MISSING — ${verdict?.suggestedCode ? `create rate-library entry '${verdict.suggestedCode}'` : 'no rate slot found'} to price this line.`
      : verdict?.warning === 'RATE_MISSING'
        ? `RATE MISSING — slot '${verdict?.suggestedCode ?? '?'}' exists but rate is 0; populate the value to price this line.`
        : 'UNPRICED — rate unavailable.'
  return {
    ...baseProv,
    evidence: [
      ...baseProv.evidence,
      { kind: 'legacy', note: warningText },
    ],
    stampedBy: 'generateBoq.unpriced',
  }
}

export function registerBoqRoutes(router: Router): void {
  /**
   * POST /api/projects/:id/boq
   *
   * Generate a new DRAFT Boq for the project. Default is to include only
   * APPROVED + EDITED TakeoffItems (the architect's brief). Pass
   * `{ onlyApproved: false }` in stub-mode dev to include AI-status items too.
   * Always creates a new version — existing BOQs are kept for history.
   */
  router.post(
    '/api/projects/:id/boq',
    requireAuth(async (req, ctx) => {
      const projectId = ctx.params.id
      let raw: unknown = null
      try {
        raw = await req.json()
      } catch {
        // body is optional; ignore parse errors here
      }
      const parsed = generateBody.safeParse(raw ?? {})
      if (!parsed.success) return errorResponse(400, 'Invalid payload', parsed.error.format())
      const onlyApproved = parsed.data?.onlyApproved ?? true

      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true, estimabilityOverrides: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      // CLASSIFIER-2 — load the per-project override map + detect
      // whether the project has MEP drawings (any sheet classified
      // discipline='MEP'). Both feed effectiveEstimability so the
      // collapse-vs-price decision is per-project, not global.
      const overrides: EstimabilityOverrides = parseEstimabilityOverrides(
        project.estimabilityOverrides,
      )
      const hasMepDrawings =
        (await db.sheet.count({
          where: {
            organizationId: ctx.organizationId,
            discipline: 'MEP',
            document: { projectId, deletedAt: null },
          },
        })) > 0

      // SPRINT-1.2 — BoqEligibilityGate. Always include AI items
      // in the initial fetch; the gate decides per-item whether
      // they reach the BOQ based on whether a rate-library slot
      // exists. Replaces the per-category auto-promote logic.
      // `onlyApproved` is now a no-op for the AI tier — AI items
      // pass when they have a populated slot OR ship as P/S "rate
      // pending" when the slot exists but the rate is null/0.
      const statusFilter: { status?: { in: TakeoffStatus[] } } = onlyApproved
        ? { status: { in: ['APPROVED', 'EDITED', 'AI'] as TakeoffStatus[] } }
        : {}

      const rateLibSnapshot = await loadRateLibrarySnapshot(db, ctx.organizationId)

      const items = await db.takeoffItem.findMany({
        where: { projectId, deletedAt: null, ...statusFilter },
        orderBy: [{ category: 'asc' }, { tag: 'asc' }, { createdAt: 'asc' }],
        include: {
          sourceSheet: {
            select: {
              id: true,
              drawingNo: true,
              pageNo: true,
              documentId: true,
              // EVIDENCE-1 — propagate title + sheetType + parent
              // document filename so buildAutoLineProvenance can
              // stamp a self-verifying sheet evidence chip.
              title: true,
              sheetType: true,
              document: { select: { filename: true } },
            },
          },
        },
      })

      if (items.length === 0) {
        return errorResponse(
          400,
          onlyApproved
            ? 'No APPROVED or EDITED takeoff items for this project. Approve some first or set onlyApproved=false.'
            : 'No takeoff items to BOQ.',
        )
      }

      // S7-1 + PB-1: BOQ generation refuses with an ERROR ValidationFlag if
      // duplicate (category, tag) pairs exist in the takeoff. PB-1 adds
      // structured `details` to the 409 so the SPA can render a friendly
      // explanation and link the user to the offending rows — raw
      // "status 409" was the trust leak the gate walkthrough surfaced.
      const seenIds = new Map<string, string[]>()
      for (const item of items) {
        if (!item.tag) continue
        const key = `${item.category}:${item.tag}`
        const list = seenIds.get(key) ?? []
        list.push(item.id)
        seenIds.set(key, list)
      }
      const dupGroups = Array.from(seenIds.entries())
        .filter(([, ids]) => ids.length > 1)
        .map(([key, ids]) => {
          const [category, tag] = key.split(':') as [string, string]
          return { category, tag, count: ids.length, takeoffItemIds: ids }
        })
      if (dupGroups.length > 0) {
        const summary = dupGroups
          .slice(0, 8)
          .map((d) => `${d.category}:${d.tag} (${d.count})`)
        await upsertValidationFlag({
          client: db,
          organizationId: ctx.organizationId,
          projectId,
          rule: 'DUPLICATE_TAG_IN_TAKEOFF',
          severity: 'ERROR',
          message: `BOQ generation refused: ${dupGroups.length} (category, tag) collision(s) in the takeoff: ${summary.join(', ')}${dupGroups.length > 8 ? `, ...(+${dupGroups.length - 8})` : ''}. Dedupe before generating.`,
        })
        return errorResponse(
          409,
          'Duplicate takeoff rows detected — resolve before generating.',
          {
            kind: 'duplicate_takeoff_rows',
            dupGroups,
            totalGroups: dupGroups.length,
          },
        )
      }

      // Group by section. S4-4: skip the categories in NEVER_BOQ (today only
      // ROOM) — they're QUANTIFY inputs, not bill items.
      // Sprint-6: also skip items with meta.kind='LEGEND'. Those are MATERIAL
      // DEFINITIONS that the EXTRACT_FINISH_LEGEND stage planted as
      // reference rows; they have null qty and would pollute the BOQ.
      const sectionBuckets = new Map<string, typeof items>()
      // SPRINT-1.2 — verdicts keyed by takeoffItem.id so the
      // downstream per-section loop can route AI items per the
      // gate's `isPriced` signal (populated slot → priced; empty
      // slot → PROVISIONAL_SUM with "rate pending" reasoning).
      const classifiedById = new Map<string, LineClassification>()
      let skippedRoomItems = 0
      let skippedLegendItems = 0
      let skippedAiByGate = 0
      for (const item of items) {
        if (NEVER_BOQ.has(item.category)) {
          skippedRoomItems += 1
          continue
        }
        const meta = (item.meta ?? {}) as Record<string, unknown>
        if (meta.kind === 'LEGEND') {
          skippedLegendItems += 1
          continue
        }
        // Axis 1 (LineState) — classifier decides if the line
        // appears at all. Only qty<=0 suppresses today; missing
        // rates / missing slots do NOT silence detection.
        // Axis 2 (pricing — isPriced / warning / suggestedCode)
        // is consumed in the per-section loop below.
        const verdict = classifyLine(item, rateLibSnapshot)
        if (verdict.state === 'SUPPRESSED') {
          skippedAiByGate += 1
          continue
        }
        classifiedById.set(item.id, verdict)
        const sectionCode = CATEGORY_TO_SECTION[item.category] ?? '1.0'
        const bucket = sectionBuckets.get(sectionCode)
        if (bucket) bucket.push(item)
        else sectionBuckets.set(sectionCode, [item])
      }
      if (skippedAiByGate > 0) {
        console.log(
          `[boq.gate] ${skippedAiByGate} AI item(s) had qty=0 — nothing to show.`,
        )
      }
      if (sectionBuckets.size === 0) {
        return errorResponse(
          400,
          skippedRoomItems > 0
            ? `Only ROOM items present (${skippedRoomItems}); run QUANTIFY first to derive billable items.`
            : 'No billable takeoff items.',
        )
      }

      // Roadmap #5 — Section 4.0 Provisional Sums always present, even
      // empty, so the SPA's "Add provisional line" button has a section
      // to write into. The estimator carries windows / lighting /
      // cladding / facade / MEP here (architect-side line items the
      // drawing doesn't measure). Empty section is harmless: it renders
      // with zero lines until the user adds something.
      if (!sectionBuckets.has('4.0')) {
        sectionBuckets.set('4.0', [] as typeof items)
      }

      // Next version for this project.
      const latest = await db.boq.findFirst({
        where: { projectId, deletedAt: null },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      // P/S PERSISTENCE (2026-06-24) — manual P/S lines the estimator
      // typed in via AddProvisionalLineCard live on the PRIOR BOQ as
      // BoqLines with `takeoffItemId IS NULL` (the generator below
      // only creates lines where takeoffItemId points back at a
      // TakeoffItem). Without carry-forward, every regenerate creates
      // a fresh empty BOQ and the estimator's ~1.8M of P/S (windows
      // 300k, lighting 70k, cladding 120k, facade 100k, MEP 300k,
      // sanitary 200k, …) silently disappears. Fix: fetch prior
      // manual lines + re-insert into matching new-BOQ sections.
      //
      // Deletion semantics correct by construction: deleting a P/S
      // line on the prior BOQ hard-deletes it (#128); on the next
      // regenerate it's no longer in the prior set, so it doesn't
      // come back.
      const priorManualLines = latest
        ? await db.boqLine.findMany({
            where: { boqId: latest.id, takeoffItemId: null },
            // Default `findMany` already returns all scalar fields
            // including `provenance` (Json). `include` pulls in the
            // section title for itemRef numbering carry.
            include: { section: { select: { code: true } } },
            orderBy: { sortOrder: 'asc' },
          })
        : []
      const priorVersionLabel = latest ? `v${latest.version}` : null

      // BOQ-500 fix (2026-06-25) — the carry-forward loop used to
      // do sequential per-line tx.boqLine.create + tx.boqLine.count
      // calls inside the transaction. Over Neon's ~50ms round-trip,
      // with a Lami-sized P/S list (~20+ lines), the interactive
      // transaction blew past Prisma's default 5s timeout and threw
      // P2028 "Transaction not found" — surfacing in the SPA as
      // a 500. Two changes:
      //   1. Pre-compute itemRefs + sortOrders in-memory, then ONE
      //      createMany per section (no per-line round-trips).
      //   2. Bump the transaction timeout to 60s + maxWait to 10s,
      //      a comfortable headroom for very large BOQs.
      const boqId = await db.$transaction(
        async (tx) => {
          const boq = await tx.boq.create({
            data: {
              organizationId: ctx.organizationId,
              projectId,
              version: nextVersion,
              status: 'DRAFT',
              currency: 'AED',
            },
          })

          const sectionsByCode = new Map<string, string>()
          // Track how many lines each section already has so the
          // carry-forward pass can extend the itemRef numbering
          // without a per-line tx.boqLine.count round-trip.
          const sectionLineCount = new Map<string, number>()

          for (const [sectionCode, sectionItems] of sectionBuckets) {
            const def = SECTIONS[sectionCode]
            if (!def) continue
            const section = await tx.boqSection.create({
              data: {
                organizationId: ctx.organizationId,
                boqId: boq.id,
                code: def.code,
                title: def.title,
                sortOrder: def.sortOrder,
              },
            })
            sectionsByCode.set(def.code, section.id)

            // CLASSIFIER-2 (2026-06-27) — bucket items by their
            // EFFECTIVE estimability. The pricing decisions:
            //   MEASURED / DERIVED / MANUAL → emit as today (one
            //     BoqLine per item, priced).
            //   PROVISIONAL → COLLAPSE all items of the same category
            //     into ONE P/S BoqLine carrying the discipline
            //     allowance (DEFAULT_PROVISIONAL_AED). This is the
            //     "22 placeholder MEP lines → 4 P/S lines" pivot —
            //     contractors don't estimate MEP from a floor plan
            //     and we shouldn't pretend to.
            //   PLACEHOLDER → SKIP from the main BOQ entirely. They
            //     stay as TakeoffItems for drill-down, and the
            //     XLSX-3 draft tab can show them when explicitly
            //     requested.
            // Single classification pass → 4 buckets:
            //   priced       — MEASURED/DERIVED/MANUAL with isPriced=true
            //                  (priced × rate as today)
            //   ratePending  — AI items the gate let through with
            //                  isPriced=false (UNPRICED — visible per-item
            //                  with RATE_MISSING / RATE_SLOT_MISSING badge)
            //   provByCategory — Estimability=PROVISIONAL_SUM (collapse)
            //   lumpByCategory — Estimability=LUMP_SUM        (collapse)
            const priced: typeof sectionItems = []
            const ratePending: typeof sectionItems = []
            const provByCategory = new Map<TakeoffCategory, typeof sectionItems>()
            const lumpByCategory = new Map<TakeoffCategory, typeof sectionItems>()
            for (const item of sectionItems) {
              const meta = (item.meta ?? {}) as Record<string, unknown>
              const est = effectiveEstimability({
                category: item.category as TakeoffCategory,
                meta,
                overrides,
                hasMepDrawings,
              })
              if (est === 'PLACEHOLDER') continue
              if (est === 'PROVISIONAL_SUM') {
                const cat = item.category as TakeoffCategory
                const list = provByCategory.get(cat) ?? []
                list.push(item)
                provByCategory.set(cat, list)
                continue
              }
              if (est === 'LUMP_SUM') {
                const cat = item.category as TakeoffCategory
                const list = lumpByCategory.get(cat) ?? []
                list.push(item)
                lumpByCategory.set(cat, list)
                continue
              }
              // MEASURED / DERIVED / MANUAL. AI-tier items with
              // isPriced=false ship as VISIBLE-UNPRICED at per-item
              // granularity (not collapsed). Estimator sees each
              // detected qty + the rate slot they need to fix.
              const verdict = classifiedById.get(item.id)
              if (verdict && verdict.state === 'ACTIVE' && !verdict.isPriced) {
                ratePending.push(item)
              } else {
                priced.push(item)
              }
            }

            // Pre-compute lineData for one createMany.
            type LineData = Parameters<typeof tx.boqLine.createMany>[0]['data']
            const lineData: Exclude<LineData, readonly unknown[]>[] = []
            let lineIx = 0
            const nextRef = (): string =>
              `${def.code}/${(lineIx + 1).toString().padStart(3, '0')}`

            // (a) Priced items — one BoqLine per item.
            for (const item of priced) {
              const isProvisional =
                item.category === 'STRUCTURE_PROV' || item.category === 'MEP_PROV'
              const meta = (item.meta ?? {}) as Record<string, unknown>
              const qty = Number(item.qtyFinal ?? item.qtyAi ?? 0)
              const isMep =
                typeof meta.mepRuleId === 'string' && typeof meta.mepRate === 'number'
              const mepRate = isMep ? (meta.mepRate as number) : null
              const mepRateSource = isMep ? `mep-rule:${meta.mepRuleId as string}` : null
              const amount = mepRate !== null ? qty * mepRate : null
              lineData.push({
                organizationId: ctx.organizationId,
                boqId: boq.id,
                sectionId: section.id,
                itemRef: nextRef(),
                description: item.description,
                unit: item.unit,
                qty,
                isProvisional,
                confidence: item.confidence,
                takeoffItemId: item.id,
                rate: mepRate !== null ? mepRate.toString() : null,
                amount: amount !== null ? amount.toString() : null,
                rateSource: mepRateSource,
                provenance: buildAutoLineProvenance(item, isProvisional) as object,
                sortOrder: lineIx,
              })
              lineIx += 1
            }

            // (b) PROVISIONAL_SUM collapse — one BoqLine per category,
            // psAmount = DEFAULT_PROVISIONAL_AED (when the discipline
            // has a contractor-confirmed allowance). Provenance lists
            // rolled-up TakeoffItems as evidence; sourceType=PROVISIONAL_SUM.
            for (const cat of [...provByCategory.keys()].sort()) {
              const items = provByCategory.get(cat)!
              const psAmount = DEFAULT_PROVISIONAL_AED[cat]
              const disciplineLabel = MEP_DISCIPLINE_LABEL[cat] ?? cat.replace(/_/g, ' ')
              const psText =
                psAmount != null
                  ? ` (P/S ${psAmount.toLocaleString('en-AE')} AED, contractor-typical allowance)`
                  : ' (P/S, allowance to be confirmed)'
              const description =
                `${disciplineLabel} — provisional sum${psText}; rolled up from ${items.length} takeoff item${items.length === 1 ? '' : 's'}`
              lineData.push({
                organizationId: ctx.organizationId,
                boqId: boq.id,
                sectionId: section.id,
                itemRef: nextRef(),
                description,
                unit: 'LS',
                qty: '1',
                isProvisional: true,
                psAmount: psAmount != null ? psAmount.toString() : null,
                confidence: 100,
                takeoffItemId: null,
                rate: null,
                amount: null,
                rateSource: null,
                provenance: buildCollapsedCollapseProvenance(items, cat, psAmount, 'PROVISIONAL_SUM') as object,
                sortOrder: lineIx,
              })
              lineIx += 1
            }

            // (c) LUMP_SUM collapse — one BoqLine per category. Same
            // shape as P/S but stamped sourceType=LUMP_SUM in the
            // provenance so the audit chip reads "LS — supplier quote
            // pending" rather than "P/S allowance".
            for (const cat of [...lumpByCategory.keys()].sort()) {
              const items = lumpByCategory.get(cat)!
              const psAmount = DEFAULT_PROVISIONAL_AED[cat]
              const disciplineLabel = MEP_DISCIPLINE_LABEL[cat] ?? cat.replace(/_/g, ' ')
              const lsText =
                psAmount != null
                  ? ` (LS ${psAmount.toLocaleString('en-AE')} AED, supplier-quote allowance)`
                  : ' (LS, supplier quote pending)'
              const description =
                `${disciplineLabel} — lump sum${lsText}; rolled up from ${items.length} takeoff item${items.length === 1 ? '' : 's'}`
              lineData.push({
                organizationId: ctx.organizationId,
                boqId: boq.id,
                sectionId: section.id,
                itemRef: nextRef(),
                description,
                unit: 'LS',
                qty: '1',
                isProvisional: true,
                psAmount: psAmount != null ? psAmount.toString() : null,
                confidence: 100,
                takeoffItemId: null,
                rate: null,
                amount: null,
                rateSource: null,
                provenance: buildCollapsedCollapseProvenance(items, cat, psAmount, 'LUMP_SUM') as object,
                sortOrder: lineIx,
              })
              lineIx += 1
            }

            // (d) UNPRICED rate-pending items — per-item BoqLines,
            // NOT collapsed. rate=null, amount=null, isProvisional=
            // false (this is a measured line awaiting a rate, not a
            // deliberate P/S allowance). The description is prefixed
            // with the warning so the engineer reads at-a-glance.
            // Sprint-1.2 visibility rule: detected quantity NEVER
            // silenced by a missing rate.
            for (const item of ratePending) {
              const verdict = classifiedById.get(item.id)
              const warning = verdict?.warning ?? 'RATE_MISSING'
              const suggested = verdict?.suggestedCode ?? null
              const prefix =
                warning === 'RATE_SLOT_MISSING'
                  ? `[RATE SLOT MISSING${suggested ? ` — add ${suggested}` : ''}]`
                  : `[RATE MISSING${suggested ? ` — populate ${suggested}` : ''}]`
              const qty = Number(item.qtyFinal ?? item.qtyAi ?? 0)
              lineData.push({
                organizationId: ctx.organizationId,
                boqId: boq.id,
                sectionId: section.id,
                itemRef: nextRef(),
                description: `${prefix} ${item.description}`,
                unit: item.unit,
                qty,
                isProvisional: false,
                rate: null,
                amount: null,
                rateSource: null,
                confidence: item.confidence,
                takeoffItemId: item.id,
                psAmount: null,
                provenance: buildUnpricedLineProvenance(item, verdict) as object,
                sortOrder: lineIx,
              })
              lineIx += 1
            }

            sectionLineCount.set(def.code, lineIx)
            if (lineData.length > 0) {
              await tx.boqLine.createMany({ data: lineData })
            }
          }

          // Carry forward manual P/S. A prior section we don't have
          // in the new BOQ (rare — categories changed) gets created
          // on demand so we don't drop the line.
          if (priorManualLines.length > 0) {
            // Group by section code so itemRef numbering continues
            // after the auto-generated lines.
            const linesBySection = new Map<string, typeof priorManualLines>()
            for (const l of priorManualLines) {
              const code = l.section.code
              if (!linesBySection.has(code)) linesBySection.set(code, [])
              linesBySection.get(code)!.push(l)
            }

            let carriedTotal = 0
            let carriedProvisional = 0

            for (const [sectionCode, lines] of linesBySection) {
              let sectionId = sectionsByCode.get(sectionCode)
              if (!sectionId) {
                const def = SECTIONS[sectionCode]
                if (!def) continue
                const section = await tx.boqSection.create({
                  data: {
                    organizationId: ctx.organizationId,
                    boqId: boq.id,
                    code: def.code,
                    title: def.title,
                    sortOrder: def.sortOrder,
                  },
                })
                sectionsByCode.set(def.code, section.id)
                sectionLineCount.set(def.code, 0)
                sectionId = section.id
              }
              const existingCount = sectionLineCount.get(sectionCode) ?? 0
              // BATCH the insert — single round-trip per section.
              //
              // BUG-2 fix (2026-06-25) — the prior version of this map
              // included `brand: l.brand`, but BoqLine has no `brand`
              // column (the field lives on Material / Assembly, not on
              // BoqLine). Prisma's createMany silently corrupted the
              // insert when given an unknown field — Decimal columns
              // landed as NULL even when the source values were
              // populated. That's how 4.0/001 Windows P/S carried
              // forward with psAmount=NULL on v4, dropping 590k of P/S
              // from the per-line display. Dropping the bogus `brand`
              // line restores the correct shape. Decimal fields are
              // also stringified — safer with createMany on Prisma
              // 5.x, where Decimal-object inputs occasionally drop to
              // null mid-batch.
              await tx.boqLine.createMany({
                data: lines.map((l, i) => {
                  const refIndex = existingCount + i + 1
                  const amount = l.amount ? Number(l.amount.toString()) : 0
                  const ps = l.psAmount ? Number(l.psAmount.toString()) : 0
                  carriedTotal += amount
                  carriedProvisional += ps
                  // TR-2 — carry the prior line's provenance forward,
                  // appending a "carried from vN" evidence chip so
                  // the audit trail shows the chain. If the prior
                  // line lacked provenance (legacy pre-backfill —
                  // shouldn't happen post-TR-1), build a fresh
                  // MANUAL stamp.
                  const priorProv = parseProvenance(l.provenance)
                  const carriedProv: LineProvenance = priorProv
                    ? {
                        ...priorProv,
                        evidence: [
                          ...priorProv.evidence,
                          {
                            kind: 'legacy',
                            note: `Carried forward from BOQ ${priorVersionLabel ?? 'prior'} line ${l.itemRef}`,
                          },
                        ],
                        stampedBy: 'generateBoq.carryForward',
                      }
                    : {
                        sourceType: 'MANUAL',
                        derivationType: null,
                        evidence: [
                          {
                            kind: 'legacy',
                            note: `Carried forward from BOQ ${priorVersionLabel ?? 'prior'} (no provenance on source)`,
                          },
                        ],
                        confidence: normalizeConfidence(l.confidence ?? 100),
                        stampedBy: 'generateBoq.carryForward',
                      }
                  return {
                    organizationId: ctx.organizationId,
                    boqId: boq.id,
                    sectionId: sectionId!,
                    itemRef: `${sectionCode}/${refIndex.toString().padStart(3, '0')}`,
                    description: l.description,
                    unit: l.unit,
                    qty: l.qty?.toString() ?? null,
                    rate: l.rate?.toString() ?? null,
                    amount: l.amount?.toString() ?? null,
                    isProvisional: l.isProvisional,
                    psAmount: l.psAmount?.toString() ?? null,
                    confidence: l.confidence,
                    // takeoffItemId stays NULL — marks as "manual" so
                    // the NEXT regenerate carries it forward too.
                    provenance: carriedProv as object,
                    sortOrder: existingCount + i,
                  }
                }),
              })
              sectionLineCount.set(sectionCode, existingCount + lines.length)
            }

            // PS-AGG-2 — totals are now self-healing via
            // recomputeBoqTotals (called below). Maintained-increment
            // logic kept here is redundant; left as a single source-of-
            // truth recompute outside this block.
          }

          return boq.id
        },
        { timeout: 60_000, maxWait: 10_000 },
      )

      // PS-AGG-2 — derive subtotal + totalProvisional from actual
      // BoqLine rows. Single source of truth; no more drift between
      // the aggregate and the lines no matter which mutation path
      // (generate / carry-forward / price / addLine / deleteLine /
      // patchLine) wrote what.
      await recomputeBoqTotals(db, boqId)

      const full = await db.boq.findFirstOrThrow({
        where: { id: boqId },
        include: {
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      return jsonResponse(boqDto(full), 201)
    }),
  )

  router.get(
    '/api/projects/:id/boq',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const versionParam = ctx.query.get('version')
      const where: { projectId: string; deletedAt: null; version?: number } = {
        projectId: ctx.params.id,
        deletedAt: null,
      }
      if (versionParam) where.version = Number.parseInt(versionParam, 10)
      const boq = await db.boq.findFirst({
        where,
        orderBy: { version: 'desc' },
        include: {
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      return jsonResponse(boqDto(boq))
    }),
  )

  router.get(
    '/api/boqs/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        include: {
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      return jsonResponse(boqDto(boq))
    }),
  )

  /**
   * GET /api/boqs/:id/audit
   *
   * REVIEW-1 — run the deterministic auditor pipeline over every
   * BoqLine in the BOQ + persist verificationStatus (VERIFIED /
   * FLAGGED) per line. Returns a summary + the list of flagged lines
   * so the SPA review queue can render "X verified, Y need review"
   * with the row-level reasons without a second round-trip.
   *
   * Pure structural verification — no AI, no LLM. Cheap enough to run
   * on every page-load. Future Engineering + Procurement modules plug
   * in via auditor.AUDIT_MODULES.
   */
  router.get(
    '/api/boqs/:id/audit',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: {
          id: true,
          version: true,
          status: true,
          project: { select: { id: true, name: true } },
        },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')

      const { auditLineWithModules, summarize, toAuditInput } = await import(
        '../pricing/auditor'
      )

      const lines = await db.boqLine.findMany({
        where: { boqId: boq.id },
        include: { section: { select: { code: true, title: true } } },
        orderBy: [{ section: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      })

      const perLine = lines.map((l) => {
        const input = toAuditInput(l)
        const result = auditLineWithModules(input)
        return { input, sectionCode: l.section.code, sectionTitle: l.section.title, result, raw: l }
      })

      // Persist verificationStatus per line so the SPA list view +
      // XLSX exporter can render badges without re-running the
      // pipeline. Writes are pipelined (Promise.all) instead of
      // serialised inside a transaction — each update is independent
      // + idempotent (last-write-wins on re-audit), so the transaction
      // overhead was pure latency. 78 serial Neon round-trips were
      // tripping Bun.serve's 10s idleTimeout; pipelined they finish
      // in ~1s.
      await Promise.all(
        perLine.map((r) => {
          // AUDIT-VERDICT — persisted status is still the worst-of
          // axes for the existing column, but verificationDetail now
          // carries quantityVerdict + rateVerdict so the SPA + XLSX
          // can render dual badges.
          const status = r.result.status === 'verified' ? 'VERIFIED' : 'FLAGGED'
          return db.boqLine.update({
            where: { id: r.input.id },
            data: {
              verificationStatus: status,
              verificationDetail: {
                status: r.result.status,
                quantityVerdict: r.result.quantityVerdict,
                rateVerdict: r.result.rateVerdict,
                modules: r.result.modules.map((m) => ({
                  module: m.module,
                  axis: m.axis,
                  verdict: m.verdict,
                  reasons: m.reasons,
                  resolutionSteps: m.resolutionSteps,
                  tags: m.tags,
                })),
              } as object,
            },
          })
        }),
      )

      const summary = summarize(perLine)
      const flagged = perLine
        .filter((r) => r.result.status !== 'verified')
        .map((r) => ({
          id: r.input.id,
          itemRef: r.input.itemRef,
          sectionCode: r.sectionCode,
          description: r.input.description,
          status: r.result.status,
          sourceType: r.input.provenance?.sourceType ?? null,
          derivationType: r.input.provenance?.derivationType ?? null,
          confidence: r.input.provenance?.confidence ?? null,
          amount: r.raw.amount?.toString() ?? null,
          psAmount: r.raw.psAmount?.toString() ?? null,
          modules: r.result.modules,
        }))

      return jsonResponse({
        boq: { id: boq.id, version: boq.version, status: boq.status, project: boq.project },
        summary,
        flagged,
      })
    }),
  )

  /** Enqueue a PRICE job for the BOQ. Returns 202 + jobId. */
  router.post(
    '/api/boqs/:id/price',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true, projectId: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const job = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: boq.projectId,
          type: 'PRICE',
          payload: { boqId: boq.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
    }),
  )

  /**
   * Inline XLSX export. Renders + writes to the BlobStore + returns the bytes
   * in one response. `?internal=1` enables the CONFIDENCE + SOURCE columns.
   * For larger BOQs the EXPORT_XLSX job exists (handlers/exportXlsx.ts) and
   * follows the same render path; this route is the fast-path for Sprint 3.
   */
  router.get(
    '/api/boqs/:id/export.xlsx',
    requireAuth(async (_req, ctx) => {
      const includeInternal = ctx.query.get('internal') === '1'
      // XLSX-3 — caller picks how placeholder-MEP lines are handled.
      // Default 'tab' (own "DRAFT MEP" sheet, not in GRAND TOTAL).
      const placeholderRaw = ctx.query.get('placeholderMep')
      const placeholderMep: 'tab' | 'exclude' | 'inline' =
        placeholderRaw === 'exclude' || placeholderRaw === 'inline'
          ? placeholderRaw
          : 'tab'
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        include: {
          project: { select: { name: true } },
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')

      // XLSX-1 (2026-06-27) — run the deterministic auditor inline
      // + persist verificationStatus before rendering, so the export
      // is always self-consistent. No-op if the persisted state is
      // already fresh; either way the renderer reads what's in the
      // row. The pipeline is pure structural + confidence math,
      // ~1-2s for ~100 lines.
      const { auditLineWithModules, toAuditInput } = await import('../pricing/auditor')
      const allLines = boq.sections.flatMap((s) => s.lines)
      const results = allLines.map((l) => ({
        line: l,
        result: auditLineWithModules(toAuditInput(l)),
      }))
      await Promise.all(
        results.map(({ line, result }) => {
          const status = result.status === 'verified' ? 'VERIFIED' : 'FLAGGED'
          const detail = {
            status: result.status,
            quantityVerdict: result.quantityVerdict,
            rateVerdict: result.rateVerdict,
            modules: result.modules.map((m) => ({
              module: m.module,
              axis: m.axis,
              verdict: m.verdict,
              reasons: m.reasons,
              resolutionSteps: m.resolutionSteps,
              tags: m.tags,
            })),
          }
          return db.boqLine.update({
            where: { id: line.id },
            data: { verificationStatus: status, verificationDetail: detail as object },
          })
        }),
      )

      // Re-read with the freshly persisted audit fields. Cheap — same
      // result set, just one more round-trip.
      const audited = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        include: {
          project: { select: { name: true } },
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      if (!audited) return errorResponse(404, 'BOQ not found')

      const xlsxModel: XlsxBoq = {
        projectName: audited.project.name,
        version: audited.version,
        currency: audited.currency,
        subtotal: audited.subtotal === null ? null : audited.subtotal.toString(),
        totalProvisional:
          audited.totalProvisional === null ? null : audited.totalProvisional.toString(),
        auditedAt: new Date().toISOString(),
        sections: audited.sections.map((s) => ({
          code: s.code,
          title: s.title,
          subtotal: s.subtotal === null ? null : s.subtotal.toString(),
          lines: s.lines.map(toXlsxLine),
        })),
      }
      const buffer = await renderBoqXlsx(xlsxModel, { includeInternal, placeholderMep })
      const placeholderTag =
        placeholderMep === 'inline' ? '-with-draft-mep' : placeholderMep === 'exclude' ? '-no-draft-mep' : ''
      const filename = `boq-${audited.project.name.replace(/[^a-zA-Z0-9]+/g, '_')}-v${audited.version}${includeInternal ? '-internal' : ''}${placeholderTag}.xlsx`
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Access-Control-Allow-Origin': '*',
        },
      })
    }),
  )

  /**
   * Sprint-10 S10-3 — Add a MANUAL BoqLine to a chosen section.
   *
   *   POST /api/boqs/:id/sections/:sectionId/lines
   *
   * Used by the quotation UI's "Add line" button. Free-form line — the
   * caller supplies description, unit, qty, plus EITHER a rate (cost
   * line) OR a P/S flag (carry forward). Recompute happens client-side
   * for the section sum; the PRICE job is the authoritative
   * recomputation when the user clicks Re-price.
   */
  router.post(
    '/api/boqs/:id/sections/:sectionId/lines',
    requireAuth(async (req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true, projectId: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const section = await db.boqSection.findFirst({
        where: { id: ctx.params.sectionId, boqId: boq.id },
        select: { id: true, code: true },
      })
      if (!section) return errorResponse(404, 'BOQ section not found in this BOQ')
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const body = z
        .object({
          description: z.string().min(1).max(500),
          brand: z.string().max(120).optional(),
          unit: z.string().min(1).max(20),
          qty: z.number().finite().nonnegative(),
          // EITHER rate (cost line) OR isProvisional with psAmount.
          rate: z.number().finite().nonnegative().optional(),
          isProvisional: z.boolean().optional(),
          psAmount: z.number().finite().nonnegative().optional(),
        })
        .refine(
          (b) =>
            (b.rate !== undefined && b.isProvisional !== true) ||
            (b.isProvisional === true && b.psAmount !== undefined),
          'Provide rate for a costed line, or isProvisional=true + psAmount for a P/S carry',
        )
        .safeParse(raw)
      if (!body.success) {
        return errorResponse(400, 'Invalid payload', body.error.format())
      }
      const existingLines = await db.boqLine.findMany({
        where: { boqId: boq.id, sectionId: section.id },
        select: { sortOrder: true, itemRef: true },
      })
      const nextSort = existingLines.reduce((max, l) => Math.max(max, l.sortOrder), 0) + 10
      const nextNumber = existingLines.length + 1
      const itemRef = `${section.code}/${String(nextNumber).padStart(3, '0')}`
      const description = body.data.brand
        ? `${body.data.description} (${body.data.brand})`
        : body.data.description
      const amount =
        body.data.rate !== undefined ? body.data.rate * body.data.qty : null
      // TR-2 — MANUAL provenance with user + timestamp stamp.
      const provenance = manualProvenance({
        userId: ctx.user.id,
        at: new Date().toISOString(),
        note: body.data.isProvisional
          ? `Manual P/S added: ${body.data.description.slice(0, 100)}`
          : `Manual priced line added: ${body.data.description.slice(0, 100)}`,
        confidence: 1,
        stampedBy: 'addProvisionalBoqLine.route',
      })
      const created = await db.boqLine.create({
        data: {
          organizationId: ctx.organizationId,
          boqId: boq.id,
          sectionId: section.id,
          itemRef,
          description,
          unit: body.data.unit,
          qty: body.data.qty,
          rate: body.data.rate ?? null,
          rateSource: body.data.rate !== undefined ? 'MANUAL' : null,
          amount,
          isProvisional: body.data.isProvisional ?? false,
          psAmount: body.data.psAmount ?? null,
          provenance: provenance as object,
          sortOrder: nextSort,
        },
      })
      // S10-3 MANUAL provenance — Correction-style audit row so the
      // data-quality flow knows this line is human-supplied.
      await db.correction.create({
        data: {
          organizationId: ctx.organizationId,
          entity: 'BoqLine',
          entityId: created.id,
          field: 'MANUAL',
          aiValue: null,
          humanValue: itemRef,
          reason: 'Add Line from quotation UI',
          userId: ctx.user.id,
        },
      })
      // PS-AGG-2 — recompute totals from actual lines. Same as the
      // delete + patch paths now: single source of truth, no
      // maintained deltas to drift.
      await recomputeBoqTotals(db, boq.id)
      return jsonResponse({ id: created.id, itemRef }, 201)
    }),
  )

  /**
   * #128 — PATCH a BoqLine. Edits description, qty, rate (cost lines
   * only), or psAmount (P/S only). The line stays in its section, the
   * isProvisional flag stays fixed (toggling P/S↔cost is a different
   * semantic; delete + re-add).
   *
   * Adjusts the BOQ.subtotal / totalProvisional by the delta and writes
   * a Correction row capturing which field changed.
   */
  router.patch(
    '/api/boqs/:id/lines/:lineId',
    requireAuth(async (req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const line = await db.boqLine.findFirst({
        where: { id: ctx.params.lineId, boqId: boq.id },
      })
      if (!line) return errorResponse(404, 'BOQ line not found in this BOQ')
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const body = z
        .object({
          description: z.string().min(1).max(500).optional(),
          qty: z.number().finite().nonnegative().optional(),
          rate: z.number().finite().nonnegative().nullable().optional(),
          psAmount: z.number().finite().nonnegative().nullable().optional(),
        })
        .refine(
          (b) =>
            b.description !== undefined ||
            b.qty !== undefined ||
            b.rate !== undefined ||
            b.psAmount !== undefined,
          'At least one of description / qty / rate / psAmount required',
        )
        .safeParse(raw)
      if (!body.success) {
        return errorResponse(400, 'Invalid payload', body.error.format())
      }

      // Compute the new field values + the delta vs. the existing row.
      const oldAmount = line.amount ? Number(line.amount.toString()) : 0
      const oldPs = line.psAmount ? Number(line.psAmount.toString()) : 0

      const nextQty =
        body.data.qty !== undefined ? body.data.qty : line.qty ? Number(line.qty.toString()) : 0
      const nextRate =
        body.data.rate === null
          ? null
          : body.data.rate !== undefined
          ? body.data.rate
          : line.rate
          ? Number(line.rate.toString())
          : null
      const nextPs =
        body.data.psAmount === null
          ? null
          : body.data.psAmount !== undefined
          ? body.data.psAmount
          : line.psAmount
          ? Number(line.psAmount.toString())
          : null

      // Cost lines: amount = qty × rate. P/S lines: amount stays null.
      const newAmount =
        line.isProvisional || nextRate === null ? null : nextQty * nextRate
      const newPs = line.isProvisional ? nextPs : null

      const update: Record<string, unknown> = {}
      if (body.data.description !== undefined) update.description = body.data.description
      if (body.data.qty !== undefined) update.qty = body.data.qty
      if (body.data.rate !== undefined) update.rate = body.data.rate
      if (body.data.psAmount !== undefined) update.psAmount = body.data.psAmount
      update.amount = newAmount
      if (line.isProvisional) update.psAmount = newPs

      const updated = await db.boqLine.update({
        where: { id: line.id },
        data: update,
      })

      // PS-AGG-2 — derive totals from actual lines instead of
      // maintaining deltas. By construction the aggregate matches.
      await recomputeBoqTotals(db, boq.id)

      // Audit: record what changed. One Correction per request — the
      // human-side reason text summarises which fields moved.
      const changes: string[] = []
      if (body.data.description !== undefined) changes.push('description')
      if (body.data.qty !== undefined) changes.push(`qty:${line.qty?.toString() ?? '—'}→${nextQty}`)
      if (body.data.rate !== undefined) changes.push(`rate:${line.rate?.toString() ?? '—'}→${nextRate ?? '—'}`)
      if (body.data.psAmount !== undefined) changes.push(`psAmount:${line.psAmount?.toString() ?? '—'}→${newPs ?? '—'}`)
      await db.correction.create({
        data: {
          organizationId: ctx.organizationId,
          entity: 'BoqLine',
          entityId: line.id,
          field: 'EDIT',
          aiValue: null,
          humanValue: changes.join(' · '),
          reason: 'Edit Line from quotation UI',
          userId: ctx.user.id,
        },
      })
      return jsonResponse({ id: updated.id, itemRef: updated.itemRef })
    }),
  )

  /**
   * #128 — DELETE a BoqLine. Hard delete (no deletedAt column on
   * BoqLine). Subtract the line's amount + psAmount from the BOQ
   * totals, write a Correction row capturing the deletion.
   */
  router.del(
    '/api/boqs/:id/lines/:lineId',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const line = await db.boqLine.findFirst({
        where: { id: ctx.params.lineId, boqId: boq.id },
      })
      if (!line) return errorResponse(404, 'BOQ line not found in this BOQ')

      const oldAmount = line.amount ? Number(line.amount.toString()) : 0
      const oldPs = line.psAmount ? Number(line.psAmount.toString()) : 0

      await db.boqLine.delete({ where: { id: line.id } })
      // PS-AGG-2 — recompute from actual lines. The old decrement
      // logic broke when PRICE had zeroed the line's psAmount
      // earlier: deleting it then decremented by 0, leaving the
      // aggregate inflated (root cause of the 1,090,000 ghost).
      await recomputeBoqTotals(db, boq.id)
      await db.correction.create({
        data: {
          organizationId: ctx.organizationId,
          entity: 'BoqLine',
          entityId: line.id,
          field: 'DELETE',
          aiValue: line.description,
          humanValue: `deleted (itemRef=${line.itemRef}, amount=${oldAmount}, psAmount=${oldPs})`,
          reason: 'Delete Line from quotation UI',
          userId: ctx.user.id,
        },
      })
      return jsonResponse({ ok: true, deletedId: line.id })
    }),
  )

  /**
   * AI-est roadmap #3 — opt-in ESTIMATE_KITCHEN job. Triggered ONLY by
   * the SPA "Estimate kitchen" button; no automatic chain, no cold-
   * upload billing. Costs ~1.5-2k tokens per click; the suggestions
   * land in JOINERY for the expert to Confirm.
   */
  /**
   * AI-est roadmap #4a — opt-in ESTIMATE_WARDROBES job. One Opus call
   * per bedroom; cost scales with bedroom count (~$0.05 each). Same
   * suggestion-only contract as kitchen.
   */
  router.post(
    '/api/projects/:id/estimate-wardrobes',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const job = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: project.id,
          type: 'ESTIMATE_WARDROBES',
          payload: { projectId: project.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
    }),
  )

  router.post(
    '/api/projects/:id/estimate-kitchen',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const job = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: project.id,
          type: 'ESTIMATE_KITCHEN',
          payload: { projectId: project.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
    }),
  )

  /** Enqueue a QUANTIFY job. Stops short of automatic chain — user-triggered. */
  router.post(
    '/api/projects/:id/quantify',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const job = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: project.id,
          type: 'QUANTIFY',
          payload: { projectId: project.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
    }),
  )
}
