/**
 * EXTRACT_ROOMS — Sprint 2 → Sprint 4 final pipeline stage.
 *
 *   payload = { documentId }
 *
 * Sprint-4 vision quality fix (S4-3): for every plan / finish_plan sheet,
 * we re-render at 220 DPI and TILE the page into 4 OVERLAPPING quadrants.
 * Each quadrant gets its own vision pass — `extractRooms.v1` reads them as
 * 4 separate images. Results are merged + deduped before reconciliation
 * against the text pass.
 *
 * Why: A1 plan tag text is ~1.5 mm tall. At Sprint-2's 110 DPI INGEST
 * resolution that's ~6 pixels — Sonnet can't read it. At 220 DPI full-page
 * the image exceeds Anthropic's size budget. Quadrant tiling at 220 DPI
 * gives 4 reads of ~half the page each, all inside the budget, all
 * readable. Tokens go up ~3-4× on the affected sheets only; the Sprint-3
 * crown-evidence budget held for that.
 *
 * Then sync into Spaces with source='takeoff'. Manual-source Spaces are NEVER
 * touched — humans win. If a manual Space already exists with the same name
 * for the project, we skip creating a takeoff Space for that name. (The
 * takeoff TakeoffItem is still recorded so the review surface has it.)
 *
 * On completion, set Document.status = READY — the pipeline's terminal stage.
 */
import type { Prisma } from '@prisma/client'
import { STUB_SUFFIX, extractRooms } from '../../ai/anthropic'
import { renderPageBbox } from '../../ai/bboxRender'
import { normalizeFloor } from '../../ai/floorNormalize'
import { renderPageQuadrants } from '../../ai/quadrantRender'
import { parseBboxRoomAreaPairs } from '../../ai/roomsBboxParser'
import { roomsTextPass } from '../../ai/roomsTextPass'
import type { ExtractRoomsRow } from '../../ai/types'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import { recoverBuaFromText, runValidators, type ValidatorContext } from '../validators'
import { upsertValidationFlag } from '../validationFlagUpsert'
import type { JobHandler, JobRecord } from '../types'
import { colorMapFinishesForProject, type ColorMapResult } from './colorMapFinishes'
import {
  AREA_STATEMENT_CATEGORY,
  isAreaStatement,
  isFloorLegendCode,
  isLikelyNotARoom,
} from './_roomSelector'

interface ExtractRoomsPayload {
  documentId: string
}

const ROOM_SHEET_TYPES = ['plan', 'finish_plan']
const RULE_ROW_MISMATCH = 'ROW_MISMATCH'

interface ReconciledRoom {
  name: string
  code: string | null
  floor: string | null
  area_m2: number | null
  finish_code: string | null
  basis: 'MEASURED' | 'VISUAL' | 'PARAMETRIC'
  confidence: number
  mismatch: null | { field: string; vision: unknown; text: unknown }
}

/**
 * Sprint-8 S8-2 — canonical key for room name dedup.
 *
 * The same room appears across plan / finish_plan / RCP sheets, often with
 * different decorations: a floor-code suffix ("MASTER BATH FF-10"), a case
 * mismatch ("BOH KITCHEN" vs "BOH Kitchen"), or curly-vs-straight quotes
 * ("MAID'S ROOM" vs "MAID'S ROOM"). S7's deduper used a naive
 * `.split('—')[0].trim().toUpperCase()` that collapsed none of these, so
 * 22 ground-truth rooms ended up as 73 unique Spaces.
 *
 * Steps, in order:
 *   1. cut off everything after the em-dash decorator the handler adds
 *   2. casefold to upper
 *   3. normalise curly/typographic apostrophes → straight '
 *   4. drop floor-code suffixes (GF-08 / FF-10 / RF-02) so the same room
 *      named with / without its code lands in one bucket
 *   5. collapse internal whitespace and strip stray punctuation noise
 */
/**
 * Sprint-10 PB-5 — OCR-mistake aliases for the BOH kitchen. The same
 * label on the I401 finish plan gets vision-misread as BOW, BOX, ION,
 * or BOY depending on how the model's tokens fall over the 3-letter
 * prefix. They all collapse to the canonical "BOH KITCHEN" here so the
 * cross-sheet deduper merges them instead of leaving four separate
 * Spaces. (Confirmed on Plot 4357: BOW/BOX/ION/BOY all appeared as
 * KITCHEN-suffixed names in successive live runs.)
 */
const KITCHEN_OCR_ALIAS_RE = /\b(?:BOW|BOX|ION|BOY)\s+KITCHEN\b/

/**
 * Architect-side spelling + cross-sheet name variants. Each rule
 * rewrites both forms into the same canonical so the cross-sheet dedup
 * collapses them. Rules run in order; one canonical per family.
 *
 *   - "BED ROOM"   ↔ "BEDROOM"     → BEDROOM
 *   - "BATH ROOM"  ↔ "BATHROOM"    → BATH   (canonical short form;
 *                                              MASTER BATH ↔ MASTER
 *                                              BATHROOM both → MASTER BATH)
 *   - "DINNING"    ↔ "DINING"      → DINING
 *   - "LOBBY"      ↔ "LOBBYS"      → LOBBY
 *   - "POWDER ROOM"↔ "POWDER"      → POWDER (general ROOM-suffix strip
 *                                              happens later; this is
 *                                              the explicit form)
 *   - "WC"         ↔ "TOILET"       — NOT merged (sometimes different
 *                                       rooms in larger villas)
 *
 * Numeric distinguishers (BATH 01 vs BATH 02) are preserved by every
 * rule. They survive the token-sort step at the end.
 */
const ROOM_NAME_CANONICALIZATIONS: Array<{ re: RegExp; to: string }> = [
  { re: /\bBED\s+ROOM\b/g, to: 'BEDROOM' },
  { re: /\bBATH\s+ROOM\b/g, to: 'BATHROOM' },
  { re: /\bDINN?ING\b/g, to: 'DINING' },
  { re: /\bLOBBY?S\b/g, to: 'LOBBY' },
  // BATHROOM → BATH: shorter canonical. Run AFTER BATH ROOM → BATHROOM
  // so "MASTER BATH ROOM" goes BATH ROOM → BATHROOM → BATH and lands
  // alongside "MASTER BATH" (plan-side label).
  { re: /\bBATHROOM\b/g, to: 'BATH' },
  // Expert call 2026-06-20: BOH KITCHEN ↔ KITCHEN are the same physical
  // room on residential villa plans (one plan calls it "BOH KITCHEN",
  // another just "Kitchen"). Larger commercial spaces may have separate
  // BOH + show kitchens; if a project breaks the assumption the expert
  // sees one collapsed row and manually splits. Same call as the
  // MASTER BATH = MASTER BATHROOM collapse.
  { re: /\bBOH\s+KITCHEN\b/g, to: 'KITCHEN' },
]

/**
 * Tokens that aren't identity-bearing — strip after canonicalization
 * so "POWDER ROOM" merges with "POWDER", "FAMILY ROOM" with "FAMILY",
 * "(FF - Lower)" floor markers vanish. Pure deny-list of generic words
 * that show up as identity noise on different sheets of the same plan.
 */
/**
 * Tokens stripped from every room name regardless of context.
 *
 * Expert review (2026-06-20): LOWER/UPPER and B1/B2/BF are KEPT as
 * identity-bearing tokens.
 *   - LOWER/UPPER distinguish stair landings (GF-Lower vs GF-Upper
 *     are physically distinct floor areas a contractor measures
 *     individually — same for stair-under stores).
 *   - B1/B2/BF mark basement rooms (a "B1 BEDROOM" is a basement
 *     bedroom, distinct from a generic "BEDROOM" on the main floors).
 */
const NON_IDENTITY_TOKENS = new Set<string>([
  'ROOM',
])

/**
 * Floor markers stripped ONLY for NORMAL rooms — see STRUCTURAL_NAME_RE.
 * The S8-2 cross-sheet design intentionally merges a same-named room
 * across floors (MASTER BATH on plan + Master Bathroom (FF) on finish
 * plan collapse to one bucket; the row with area + confirmed finish
 * wins). That convenience is right for living/sleeping/wet rooms.
 *
 * But for structural rooms — stair landings, stair-under stores, voids,
 * shafts — the floor is identity. GF-Lower and FF-Lower are different
 * concrete pours, billed separately. Keep the floor token in those.
 */
const FLOOR_MARKER_TOKENS = new Set<string>([
  'GF', 'FF', 'RF', 'L1', 'L2',
])

const STRUCTURAL_NAME_RE = /\b(STAIR|LANDING|STORE|VOID|SHAFT)\b/i

/**
 * Pro-grade room-name normalizer. Five stages:
 *
 *   1. lowercase the floor-decorator suffix ("— GF") — drop it
 *   2. uppercase, apostrophe normalize, KITCHEN OCR alias
 *   3. strip room codes (GF-01, FF-12) + punctuation (/&,.;:())
 *   4. apply canonicalization rules (BED ROOM=BEDROOM, BATH=BATHROOM=BATH,
 *      DINNING=DINING, LOBBY[S]=LOBBY)
 *   5. drop non-identity tokens (ROOM suffix, floor markers)
 *   6. token-sort — "02 BEDROOM" and "BEDROOM 02" normalize identically
 *
 * Hard guarantee: numeric distinguishers (BATH 01 vs BATH 02) survive
 * intact — they're tokens that won't match NON_IDENTITY_TOKENS.
 *
 * Reviewer-facing contract (memorized): expected to merge plan-side
 * "MASTER BATH" with finish-plan-side "Master Bathroom (FF)" because
 * the villa has ONE master bath. If the villa has separate master
 * baths on different floors, both will collapse to the same key — the
 * cross-sheet dedup picks the one with area+finish, the loser is
 * soft-deleted. For Plot 4357 + similar plans this is the right call;
 * if a different villa breaks the assumption, the expert sees only
 * one row and can manually correct.
 */
export function normalizeRoomName(raw: string): string {
  // Detect structural rooms (stair landings, stair-under stores, voids,
  // shafts) on the ORIGINAL raw text — the canonicalization stage strips
  // some of these markers, so the test must happen first.
  const isStructural = STRUCTURAL_NAME_RE.test(raw)
  let s = raw
    .split('—')[0]!
    .toUpperCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(KITCHEN_OCR_ALIAS_RE, 'BOH KITCHEN')
    .replace(/\b(GF|FF|RF|L1|L2|B1|B2|BF)[\s-]?\d{1,3}\b/g, '')
    .replace(/[.,;:()/&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (const rule of ROOM_NAME_CANONICALIZATIONS) {
    s = s.replace(rule.re, rule.to)
  }
  const tokens = s
    .split(' ')
    .filter(Boolean)
    .filter((tok) => !NON_IDENTITY_TOKENS.has(tok))
    .filter((tok) => isStructural || !FLOOR_MARKER_TOKENS.has(tok))
    .sort()
  return tokens.join(' ')
}

function compareNumeric(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b
  // ±2% tolerance per DoD 4. Spec calls room areas as MEASURED at this rate.
  const tolerance = Math.max(Math.abs(a), Math.abs(b)) * 0.02
  return Math.abs(a - b) <= tolerance
}

/**
 * Sprint-7 S7-3: deterministic finish_code assignment.
 *
 * The vision pass stores its raw observation in meta.rawFinishObservation —
 * vision-reported code (whether or not it's in the active legend vocabulary)
 * plus the model's evidence sentence plus a slice of the text snippet at
 * that moment. This function maps that raw observation to a finish_code
 * from the CURRENT legend vocabulary, without re-billing vision. Callers
 * (the rooms handler at extraction time, and the /remap endpoint later)
 * use the same function so a legend update can re-key every room for $0.
 *
 * Priority:
 *   1. Vision's chosen code matches a legend code exactly → 70 conf.
 *   2. Vision's chosen code substring-appears in textSnippet → 85 conf.
 *   3. Any legend code substring-appears in the evidence sentence → 70 conf.
 *   4. Any legend code substring-appears in the textSnippetSlice → 70 conf.
 *   5. None → null (FINISH_UNMAPPED flag raised by the handler).
 */
export interface RawFinishObservation {
  visionCode: string | null
  evidence: string | null
  textSnippetSlice: string | null
}

/**
 * Sprint-8 S8-3 extension. When the caller has the actual legend ITEMS
 * (not just the code list) we can do semantic matching from the room's
 * evidence/name to the legend's material/usage description. E.g. vision
 * says "white marble floor" → matches the legend item whose name is
 * "WHITE MARBLE" → returns ST01.
 */
export interface LegendItemHint {
  code: string
  name: string | null
  material: string | null
  usage: string | null
  kind: string | null
}

export function assignFinishCode(
  raw: RawFinishObservation,
  legendCodes: string[],
  textSnippet: string,
  legendItems: LegendItemHint[] = [],
): { finishCode: string | null; finishConfidence: number | null } {
  const vocab = new Set(legendCodes.map((c) => c.toUpperCase()))
  const visionCode = (raw.visionCode ?? '').trim().toUpperCase()
  if (visionCode && vocab.has(visionCode)) {
    const re = new RegExp(`\\b${visionCode}\\b`)
    return { finishCode: visionCode, finishConfidence: re.test(textSnippet) ? 85 : 70 }
  }
  const evidence = (raw.evidence ?? '').toUpperCase()
  for (const code of vocab) {
    if (code === 'BATHROOM') continue
    const re = new RegExp(`\\b${code}\\b`)
    if (re.test(evidence)) return { finishCode: code, finishConfidence: 70 }
  }
  const slice = (raw.textSnippetSlice ?? '').toUpperCase()
  for (const code of vocab) {
    if (code === 'BATHROOM') continue
    const re = new RegExp(`\\b${code}\\b`)
    if (re.test(slice)) return { finishCode: code, finishConfidence: 70 }
  }

  // S8-3 semantic match. Vision often returns evidence like "white marble
  // floor in the living room" without naming the code. Walk the legend
  // items and find ones whose NAME or MATERIAL appears in the evidence.
  // Single-hit ⇒ assign; multi-hit ⇒ ambiguous, skip.
  if (legendItems.length > 0 && evidence.length > 0) {
    const hits = new Set<string>()
    for (const item of legendItems) {
      if (!vocab.has(item.code.toUpperCase())) continue
      const keywords = [item.name, item.material, item.usage]
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 3)
        .map((s) => s.toUpperCase())
      for (const kw of keywords) {
        // Match on phrase boundaries; "MARBLE" inside "MARBLEHEAD" doesn't
        // count. Stripping common-noise tail words keeps phrases like
        // "WHITE MARBLE" from being too long to match.
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\b${escaped}\\b`)
        if (re.test(evidence)) {
          hits.add(item.code.toUpperCase())
          break
        }
      }
    }
    if (hits.size === 1) {
      return { finishCode: [...hits][0]!, finishConfidence: 65 }
    }
  }

  return { finishCode: null, finishConfidence: null }
}

/**
 * Sprint-7 S7-3: pure-function re-map driver. Loads ROOM items + LEGEND
 * items for a project, runs assignFinishCode against the current legend
 * vocabulary, and persists. Re-runnable for $0; called by the
 * POST /api/projects/:id/remap-finishes endpoint.
 */
export interface RemapFinishesResult {
  rooms: number
  newlyMapped: number
  changedCode: number
  unchanged: number
  stillUnmapped: number
}

export async function remapFinishesForProject(
  organizationId: string,
  projectId: string,
): Promise<RemapFinishesResult> {
  // Legend items always have a tag (the code itself). Rooms typically don't,
  // so we have to query them separately — the old combined query with
  // `tag: { not: null }` accidentally excluded every room.
  const [legendItems, rooms] = await Promise.all([
    prisma.takeoffItem.findMany({
      where: { organizationId, projectId, deletedAt: null, tag: { not: null } },
      select: { id: true, category: true, tag: true, meta: true },
    }),
    prisma.takeoffItem.findMany({
      where: { organizationId, projectId, deletedAt: null, category: 'ROOM' },
      select: { id: true, category: true, tag: true, meta: true },
    }),
  ])
  // PIVOT — restrict to FLOOR-vocabulary entries. The villa drawings carry
  // FF (joinery) + FN (wall) + WD (wall) + LS (landscape) legends that the
  // legend extractor legitimately captures, but a ROOM's floor finish
  // suggestion must NEVER pick from them. isFloorLegendCode() is the
  // single discriminator (ST/PR codes + BATHROOM sentinel).
  const legendLookup = legendItems.filter((i) => {
    const m = (i.meta ?? {}) as Record<string, unknown>
    return m.kind === 'LEGEND' && i.tag != null && isFloorLegendCode(i.tag)
  })
  const legendCodes = legendLookup.map((i) => i.tag!).concat(['BATHROOM'])
  const legendHints: LegendItemHint[] = legendLookup.map((i) => {
    const m = (i.meta ?? {}) as Record<string, unknown>
    return {
      code: i.tag!,
      name: typeof m.name === 'string' ? m.name : null,
      material: typeof m.material === 'string' ? m.material : null,
      usage: typeof m.usage === 'string' ? m.usage : null,
      kind: typeof m.legendKind === 'string' ? m.legendKind : null,
    }
  })
  let newlyMapped = 0
  let changedCode = 0
  let unchanged = 0
  let stillUnmapped = 0
  // PIVOT — remapFinishesForProject is the "re-run the AI suggestion logic
  // against the current legend" path. It writes to meta.finishSuggestion
  // (NEVER meta.finish_code, which is reserved for human confirmation via
  // the dropdown / accept-suggestions endpoint). The before/after compare
  // is against the previous suggestion, not the confirmed code.
  const suggestionOf = (m: Record<string, unknown>): string | null => {
    const s = m.finishSuggestion as { code?: string | null } | null | undefined
    return s?.code ?? null
  }
  const writeSuggestion = (
    m: Record<string, unknown>,
    code: string | null,
    confidence: number | null,
  ): Prisma.JsonObject => {
    if (code == null) {
      const { finishSuggestion: _drop, ...rest } = m as Record<string, unknown> & {
        finishSuggestion?: unknown
      }
      return rest as Prisma.JsonObject
    }
    return {
      ...m,
      finishSuggestion: {
        code,
        confidence,
        source: 'remap',
        reason: 'remapFinishesForProject',
      },
    } as Prisma.JsonObject
  }
  for (const r of rooms) {
    const m = (r.meta ?? {}) as Record<string, unknown>
    const raw = (m.rawFinishObservation ?? null) as RawFinishObservation | null
    const before = suggestionOf(m)
    let next: { finishCode: string | null; finishConfidence: number | null }
    if (!raw) {
      const evidence = typeof m.finish_evidence === 'string' ? m.finish_evidence : null
      const visionCode = before
      const synth: RawFinishObservation = {
        visionCode,
        evidence,
        textSnippetSlice: null,
      }
      next = assignFinishCode(synth, legendCodes, '', legendHints)
    } else {
      next = assignFinishCode(raw, legendCodes, '', legendHints)
    }
    if (next.finishCode === before) {
      if (next.finishCode == null) stillUnmapped += 1
      else unchanged += 1
      continue
    }
    if (before == null) newlyMapped += 1
    else changedCode += 1
    await prisma.takeoffItem.update({
      where: { id: r.id },
      data: { meta: writeSuggestion(m, next.finishCode, next.finishConfidence) },
    })
  }
  return { rooms: rooms.length, newlyMapped, changedCode, unchanged, stillUnmapped }
}

/**
 * Sprint-4 S4-3: 4 quadrant vision passes can each return the same room
 * (overlap region). Within a SINGLE sheet, collapse rows with the same
 * normalized name. Prefer the row that has `area_m2` populated over the one
 * without; otherwise prefer the row that has a code over one that doesn't.
 */
function dedupeBySheet(rows: ExtractRoomsRow[]): ExtractRoomsRow[] {
  const byName = new Map<string, ExtractRoomsRow>()
  for (const row of rows) {
    const key = row.name.trim().toUpperCase()
    if (!key) continue
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, row)
      continue
    }
    const score = (r: ExtractRoomsRow) =>
      (r.area_m2 !== null ? 2 : 0) + (r.code !== null ? 1 : 0)
    if (score(row) > score(existing)) byName.set(key, row)
  }
  return Array.from(byName.values())
}

/**
 * Sprint-7 S7-4: merge bbox-spatial pairs into the regex-text input. Spatial
 * pairs are pixel-accurate (xMin/yMin straight from pdftotext) and outrank
 * the line-window regex on numeric conflict. Same-name dedupe is
 * case-insensitive; ties on identical (name, area) collapse to one row.
 */
function mergeSpatialIntoText(
  regex: ExtractRoomsRow[],
  spatial: ReturnType<typeof parseBboxRoomAreaPairs>,
): ExtractRoomsRow[] {
  const byName = new Map<string, ExtractRoomsRow>()
  for (const r of regex) byName.set(r.name.trim().toUpperCase(), r)
  for (const p of spatial) {
    const key = p.name.trim().toUpperCase()
    const existing = byName.get(key)
    if (!existing) {
      byName.set(key, {
        name: p.name.trim(),
        code: null,
        floor: null,
        area_m2: p.area_m2,
        finish_code: null,
        finish_evidence: null,
      })
      continue
    }
    // Spatial wins on area; preserve other fields the regex pass may have set.
    byName.set(key, { ...existing, area_m2: p.area_m2 })
  }
  return Array.from(byName.values())
}

function reconcile(vision: ExtractRoomsRow[], text: ExtractRoomsRow[]): ReconciledRoom[] {
  const visionMap = new Map(vision.map((r) => [r.name, r]))
  const textMap = new Map(text.map((r) => [r.name, r]))
  const names = new Set<string>([...visionMap.keys(), ...textMap.keys()])
  const out: ReconciledRoom[] = []
  for (const name of names) {
    const v = visionMap.get(name)
    const t = textMap.get(name)
    if (v && t) {
      const mismatch = !compareNumeric(v.area_m2, t.area_m2)
        ? { field: 'area_m2', vision: v.area_m2, text: t.area_m2 }
        : null
      out.push({
        name,
        code: v.code ?? t.code,
        floor: v.floor ?? t.floor,
        area_m2: v.area_m2 ?? t.area_m2,
        finish_code: v.finish_code ?? t.finish_code,
        basis: 'MEASURED',
        confidence: mismatch ? 60 : 90,
        mismatch,
      })
    } else if (v) {
      out.push({
        name,
        code: v.code,
        floor: v.floor,
        area_m2: v.area_m2,
        finish_code: v.finish_code,
        basis: 'VISUAL',
        confidence: 70,
        mismatch: null,
      })
    } else if (t) {
      out.push({
        name,
        code: t.code,
        floor: t.floor,
        area_m2: t.area_m2,
        finish_code: t.finish_code,
        basis: 'PARAMETRIC',
        confidence: 50,
        mismatch: null,
      })
    }
  }
  return out
}

export const extractRoomsHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as ExtractRoomsPayload
  if (!payload.documentId) throw new Error('EXTRACT_ROOMS: payload.documentId required')

  const document = await prisma.document.findFirst({
    where: { id: payload.documentId, organizationId: job.organizationId },
  })
  if (!document) throw new Error(`EXTRACT_ROOMS: document ${payload.documentId} not found`)

  const sheets = await prisma.sheet.findMany({
    where: {
      documentId: document.id,
      organizationId: job.organizationId,
      sheetType: { in: ROOM_SHEET_TYPES },
    },
    orderBy: { pageNo: 'asc' },
  })

  const blob = getBlobStore()
  // Load the source PDF once — every plan/finish_plan sheet needs it for the
  // quadrant render.
  const sourceBytes = sheets.length > 0 ? await blob.get(document.storageKey) : Buffer.alloc(0)

  // S6-2: load the legend codes EXTRACT_FINISH_LEGEND has already saved as
  // TakeoffItems with meta.kind='LEGEND'. The list seeds the closed-vocab
  // for finish_code on each room. 'BATHROOM' is the per-bathroom-drawings
  // sentinel and is always offered alongside the real codes.
  const legendItems = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      deletedAt: null,
      tag: { not: null },
    },
    select: { tag: true, meta: true },
  })
  // PIVOT — same floor-only filter as remapFinishesForProject. The room
  // vision pass only sees ST/PR codes + BATHROOM in its closed vocab; even
  // if the legend table grabbed the joinery FF codes, they can never
  // surface as a room's floor finish suggestion.
  const legendLookup = legendItems.filter((i) => {
    const m = (i.meta ?? {}) as Record<string, unknown>
    return m.kind === 'LEGEND' && i.tag != null && isFloorLegendCode(i.tag)
  })
  const legendCodes = Array.from(
    new Set(legendLookup.map((i) => i.tag!).concat(['BATHROOM'])),
  )

  let tokensIn = 0
  let tokensOut = 0
  let itemsCreated = 0
  let spacesUpserted = 0
  let manualSkipped = 0
  let mismatches = 0
  let quadrantsRendered = 0
  // P3 — cold UI uploads were producing a 79-row "room" explode because
  // vision occasionally returned title-block keywords ("DRAWING TITLE",
  // "SCALE", "DOOR SCHEDULE") and tiny micro-areas as rows. Two counters
  // surface the funnel rejection rate so the run report shows what was
  // dropped vs reclassified.
  let roomsRejected = 0
  let areaStatementsReclassified = 0
  // S7-4 (the Area Gate): aggregate of name|area pairs the spatial parser
  // recovered from pdftotext -bbox-layout. Counted per-sheet AND collated so
  // the run report tells the reviewer how many drawn-area rooms we
  // grounded against the architect's printed labels — a gate the prior
  // regex-and-vision-only pipeline kept failing.
  let bboxPairsTotal = 0
  const bboxPairsBySheet: Array<{ pageNo: number; pairs: number }> = []

  for (const sheet of sheets) {
    const textSnippet = sheet.rawTextKey
      ? (await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')).slice(0, 4000)
      : ''

    // S4-3: render 4 overlapping quadrants at 220 DPI. Each quadrant gets its
    // own vision pass. Failures fall back to the original full-page jpeg
    // produced by INGEST at 110 DPI — a degraded but non-broken path.
    let quadrants: Awaited<ReturnType<typeof renderPageQuadrants>> = []
    try {
      quadrants = await renderPageQuadrants(sourceBytes, sheet.pageNo, { dpi: 220, overlapPct: 0.1 })
    } catch (err) {
      // Don't kill the job for one bad render.
      console.error(`[extractRooms] quadrant render failed for page ${sheet.pageNo}:`, err)
    }

    const visionRows: ExtractRoomsRow[] = []
    let promptVersion = ''
    if (quadrants.length === 4) {
      quadrantsRendered += 4
      for (const q of quadrants) {
        const r = await extractRooms({
          documentId: document.id,
          pageNo: sheet.pageNo,
          jpegBase64: q.base64,
          textSnippet,
          legendCodes,
        })
        tokensIn += r.tokensIn
        tokensOut += r.tokensOut
        promptVersion = r.promptVersion
        visionRows.push(...r.rows)
      }
    } else {
      // Fallback: full-page image at INGEST DPI. Degraded but non-broken.
      const fallback = sheet.imageKey
        ? await blob.get(sheet.imageKey).then((b) => b.toString('base64')).catch(() => null)
        : null
      const r = await extractRooms({
        documentId: document.id,
        pageNo: sheet.pageNo,
        jpegBase64: fallback,
        textSnippet,
        legendCodes,
      })
      tokensIn += r.tokensIn
      tokensOut += r.tokensOut
      promptVersion = r.promptVersion
      visionRows.push(...r.rows)
    }

    // Within-sheet dedupe across the 4 quadrants (a room straddling the center
    // is captured twice). Keep the row with `area_m2` populated over the one
    // without.
    const merged = dedupeBySheet(visionRows)

    // S7-4 spatial pass. Run pdftotext -bbox-layout for this page, build
    // name|area pairs from physical proximity, and merge them into the
    // text-side input. Bbox pairs are pixel-accurate ground truth from the
    // drawing — they outrank regex pairs on numeric conflict. Failures are
    // soft (drawings without a text layer, etc.) — the regex/vision passes
    // still run.
    const regexText = roomsTextPass(textSnippet, sheet.pageNo)
    let spatialPairs: ReturnType<typeof parseBboxRoomAreaPairs> = []
    try {
      const bbox = await renderPageBbox(sourceBytes, sheet.pageNo)
      spatialPairs = parseBboxRoomAreaPairs(bbox)
    } catch (err) {
      console.error(`[extractRooms] bbox render failed for page ${sheet.pageNo}:`, err)
    }
    bboxPairsTotal += spatialPairs.length
    bboxPairsBySheet.push({ pageNo: sheet.pageNo, pairs: spatialPairs.length })
    const text = mergeSpatialIntoText(regexText, spatialPairs)
    const reconciled = reconcile(merged, text)
    const visionFromStub = promptVersion.endsWith(STUB_SUFFIX)

    for (const room of reconciled) {
      const normalizedFloor = normalizeFloor(room.floor)
      // P3 — title-block / schedule-frame strings: drop with a counter.
      // This is the funnel that protects the SPA review surface from the
      // cold-upload 79-row explode.
      if (isLikelyNotARoom(room.name, room.area_m2)) {
        roomsRejected += 1
        continue
      }
      // P3 — building-level statements (BUA, plot area, "Proposed Villa")
      // stay in the takeoff but at category=AREA_STATEMENT so the BOQ
      // selector + scorer skip them. Both isLikelyNotARoom and
      // isAreaStatement consult shared rules in _roomSelector.ts.
      const describedAs = `${room.name}${normalizedFloor ? ` — ${normalizedFloor}` : ''}`
      const isStatement = isAreaStatement(describedAs)
      if (isStatement) areaStatementsReclassified += 1
      // S7-3: store the RAW observation from the vision pass — independent
      // of whatever legend vocabulary happened to be in effect at the time.
      // assignFinishCode() reads rawFinishObservation in a deterministic
      // post-map; re-running the legend stage no longer requires re-running
      // the rooms vision pass to update finish_code.
      const visionRow = merged.find(
        (r) => r.name.trim().toUpperCase() === room.name.trim().toUpperCase(),
      )
      const rawFinishObservation = {
        visionCode: visionRow?.finish_code ?? null,
        evidence: visionRow?.finish_evidence ?? null,
        // S8-3: was 600 chars — too tight for assignFinishCode's last-resort
        // textSnippetSlice scan to find legend codes on busy I401-style sheets.
        // 2000 is comfortably inside the per-sheet text we already loaded.
        textSnippetSlice: textSnippet.slice(0, 2000),
      }

      // Build the legend-hint set once per project. Each iteration calls
      // assignFinishCode with the same hint list — Sprint-8 S8-3 semantic
      // fallback uses the legend item's name/material/usage to match against
      // the room's evidence.
      const legendHintsLocal: LegendItemHint[] = legendLookup.map((i) => {
        const m = (i.meta ?? {}) as Record<string, unknown>
        return {
          code: i.tag!,
          name: typeof m.name === 'string' ? m.name : null,
          material: typeof m.material === 'string' ? m.material : null,
          usage: typeof m.usage === 'string' ? m.usage : null,
          kind: typeof m.legendKind === 'string' ? m.legendKind : null,
        }
      })

      const { finishCode, finishConfidence } = assignFinishCode(
        rawFinishObservation,
        legendCodes,
        textSnippet,
        legendHintsLocal,
      )

      // PIVOT — finish code from vision is a SUGGESTION, never a
      // confirmed assignment. meta.finish_code is RESERVED for the
      // human-confirmed code (set by the SPA dropdown via PATCH).
      // meta.finishSuggestion is the AI's proposal that the reviewer
      // accepts or overrides. PRICE skips rooms with finish_code=null
      // (the unassigned bucket goes P/S — already in place).
      const meta: Record<string, unknown> = {
        code: room.code,
        floor: room.floor,
        floorNormalized: normalizedFloor,
        area_m2: room.area_m2,
        finish_code: null,
        finishSuggestion: finishCode
          ? {
              code: finishCode,
              confidence: finishConfidence,
              source: 'vision',
              reason: 'vision-extract',
            }
          : null,
        finish_evidence: rawFinishObservation.evidence,
        rawFinishObservation,
      }
      if (visionFromStub) meta.stub = true
      const takeoff = await prisma.takeoffItem.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          category: isStatement ? AREA_STATEMENT_CATEGORY : 'ROOM',
          tag: room.code,
          description: describedAs,
          unit: 'm²',
          qtyAi: room.area_m2 ?? undefined,
          basis: room.basis,
          confidence: room.confidence,
          sourceSheetId: sheet.id,
          sourceNote: sheet.drawingNo ?? `page ${sheet.pageNo}`,
          meta: meta as object,
          promptVersion,
        },
      })
      itemsCreated += 1

      if (room.mismatch) {
        mismatches += 1
        await upsertValidationFlag({
          client: prisma,
          organizationId: job.organizationId,
          projectId: document.projectId,
          takeoffItemId: takeoff.id,
          rule: RULE_ROW_MISMATCH,
          severity: 'ERROR',
          message: `ROOM ${room.name}: ${room.mismatch.field} disagrees (vision=${room.mismatch.vision}, text=${room.mismatch.text}).`,
        })
      }

      // S6-2: rooms the model couldn't label get an INFO flag so the human
      // reviewer surfaces them quickly. We don't fail the run.
      if (finishCode === null) {
        await upsertValidationFlag({
          client: prisma,
          organizationId: job.organizationId,
          projectId: document.projectId,
          takeoffItemId: takeoff.id,
          rule: 'FINISH_UNMAPPED',
          severity: 'INFO',
          message: `ROOM ${room.name}${normalizedFloor ? ` (${normalizedFloor})` : ''}: no finish_code assigned. Likely needs human review.`,
        })
      }
    }
  }

  // ---------------------------------------------------------------------
  // S4-4 cross-sheet dedupe + Spaces sync from the deduped set.
  //
  // The same room frequently appears on plan + finish_plan + RCP sheets.
  // Group by (normalizedName, normalizedFloor) and keep the row with the
  // best score: area populated > no area, code populated > no code, higher
  // confidence wins ties. Losers are soft-deleted.
  // ---------------------------------------------------------------------
  const allRoomItems = await prisma.takeoffItem.findMany({
    where: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      category: 'ROOM',
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  })
  // S8-2: dedup by normalised name only. Floor stays informational; the
  // surviving row's floor is preserved as the bucket's floor. The live
  // S7-5 data shows the same physical room landing on multiple floors only
  // because of vision-side misclassification (BATH 02 emitted on GF and L1
  // and ∅ for the same L1 bathroom); collapsing across floors lets the
  // best-scored row win and drops the duplicate noise. Real same-named
  // rooms across floors (rare in this fixture) are still distinguishable
  // via their tag (FF-NN / GF-NN) on the surviving row.
  const groups = new Map<string, typeof allRoomItems>()
  for (const item of allRoomItems) {
    const name = normalizeRoomName(item.description)
    if (!name) continue
    const bucket = groups.get(name)
    if (bucket) bucket.push(item)
    else groups.set(name, [item])
  }
  const survivors: typeof allRoomItems = []
  let collapsedRoomDuplicates = 0
  for (const [, items] of groups) {
    if (items.length === 1) {
      survivors.push(items[0]!)
      continue
    }
    const score = (i: (typeof allRoomItems)[number]) =>
      (i.qtyAi !== null ? 4 : 0) + (i.tag !== null ? 2 : 0) + i.confidence / 100
    const sorted = items.slice().sort((a, b) => score(b) - score(a))
    const survivor = sorted[0]!
    const losers = sorted.slice(1)
    // PIVOT — propagate finishSuggestion (NOT finish_code) from a loser
    // into the survivor when the survivor lacks one. The cold-upload
    // pattern is: area-bearing row from the floor plan (A101/A102) wins
    // on score because qtyAi is populated, but the finish *suggestion*
    // came from a finish-plan vision pass that scored lower. We carry
    // the suggestion so the reviewer sees it in the dropdown; the
    // assignment is still human-confirmed.
    const survivorMeta = (survivor.meta ?? {}) as Record<string, unknown>
    const survivorSuggestion = survivorMeta.finishSuggestion as
      | { code?: string | null }
      | null
      | undefined
    const survivorHasSuggestion = !!survivorSuggestion?.code
    if (!survivorHasSuggestion && losers.length > 0) {
      const donor = losers.find((l) => {
        const lm = (l.meta ?? {}) as Record<string, unknown>
        const lsugg = lm.finishSuggestion as { code?: string | null } | null | undefined
        return !!lsugg?.code
      })
      if (donor) {
        const dm = donor.meta as Record<string, unknown>
        const mergedMeta: Record<string, unknown> = {
          ...survivorMeta,
          finishSuggestion: dm.finishSuggestion,
          finish_evidence: dm.finish_evidence ?? survivorMeta.finish_evidence ?? null,
          finishSuggestionCarriedFromTakeoffItemId: donor.id,
        }
        if (!survivorMeta.rawFinishObservation && dm.rawFinishObservation) {
          mergedMeta.rawFinishObservation = dm.rawFinishObservation
        }
        await prisma.takeoffItem.update({
          where: { id: survivor.id },
          data: { meta: mergedMeta as Prisma.JsonObject },
        })
        survivor.meta = mergedMeta as typeof survivor.meta
      }
    }
    survivors.push(survivor)
    if (losers.length > 0) {
      await prisma.takeoffItem.updateMany({
        where: { id: { in: losers.map((l) => l.id) } },
        data: { deletedAt: new Date() },
      })
      collapsedRoomDuplicates += losers.length
    }
  }

  // P5/P6 — RUN THE COLOR-MAPPER. Sprint-9 S9-2 introduced
  // colorMapFinishesForProject (deterministic RGB sampling of the I4xx
  // finish plans against the legend palette) but it was never wired into
  // the pipeline — orphan handler. Without it, vision is the only path
  // to a finish_code, and cold uploads come back with most main-floor
  // rooms FINISH_UNMAPPED because Sonnet can't reliably read the swatch
  // ↔ room-fill mapping at the available resolution. The color-mapper
  // is zero token cost and runs after the cross-sheet dedup so it gets
  // the merged survivor set.
  let colorMap: ColorMapResult | null = null
  try {
    colorMap = await colorMapFinishesForProject(job.organizationId, document.projectId)
  } catch (err) {
    console.error('[extractRooms] colorMapFinishesForProject failed:', err)
  }

  // S8-2: Spaces sync only over survivors WITH measured area. Vision-noise
  // titles ("PROPOSED VILLA", "PLAN AREA", "GARDEN", "MAIN VILLA") drift
  // through the per-sheet pass as "rooms" — they have no area and end up
  // padding the Spaces count well past the 20–40 target. The takeoff row
  // still exists so a human reviewer can promote it if it's actually a
  // missed measurement, but the Space is only created when the area was
  // recovered (text-layer, bbox-spatial, or vision-confirmed).
  let unmeasuredSurvivors = 0
  for (const survivor of survivors) {
    if (survivor.qtyAi === null) {
      unmeasuredSurvivors += 1
      continue
    }
    const m = (survivor.meta ?? {}) as Record<string, unknown>
    const name = survivor.description.split('—')[0]!.trim()
    const areaM2 = survivor.qtyAi === null ? null : Number(survivor.qtyAi.toString())
    const floor =
      (typeof m.floorNormalized === 'string' && m.floorNormalized) ||
      (typeof m.floor === 'string' ? m.floor : null)
    const code = typeof m.code === 'string' ? m.code : survivor.tag

    const manual = await prisma.space.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        name,
        source: 'manual',
        deletedAt: null,
      },
      select: { id: true },
    })
    if (manual) {
      manualSkipped += 1
      continue
    }
    const side = Math.max(0.1, Math.sqrt(areaM2 ?? 1))
    const existing = await prisma.space.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        name,
        source: 'takeoff',
        deletedAt: null,
      },
      select: { id: true },
    })
    if (existing) {
      await prisma.space.update({
        where: { id: existing.id },
        data: {
          code,
          floor,
          areaM2: areaM2 ?? null,
          confidence: survivor.confidence,
          length: side,
          width: side,
        },
      })
    } else {
      await prisma.space.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          name,
          length: side,
          width: side,
          height: 3,
          code,
          floor,
          areaM2: areaM2 ?? null,
          source: 'takeoff',
          confidence: survivor.confidence,
        },
      })
    }
    spacesUpserted += 1
  }

  // ---------------------------------------------------------------------
  // S4-5 validation net. Pure-TS validators on the final takeoff state.
  // ---------------------------------------------------------------------
  const [project, doors, windows, planSheets] = await Promise.all([
    prisma.project.findUnique({
      where: { id: document.projectId },
      select: { type: true },
    }),
    prisma.takeoffItem.findMany({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        category: 'DOOR',
        deletedAt: null,
      },
      select: { id: true, category: true, tag: true, meta: true },
    }),
    prisma.takeoffItem.findMany({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        category: 'WINDOW',
        deletedAt: null,
      },
      select: { id: true, category: true, tag: true, meta: true },
    }),
    prisma.sheet.findMany({
      where: {
        documentId: document.id,
        organizationId: job.organizationId,
        sheetType: { in: ['plan', 'finish_plan', 'rcp', 'elevation'] },
        rawTextKey: { not: null },
      },
      select: { rawTextKey: true },
    }),
  ])
  let planTextBlob = ''
  for (const s of planSheets) {
    if (!s.rawTextKey) continue
    const t = await blob.get(s.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')
    planTextBlob += `\n${t}`
  }
  // S8-5 BUA recovery — look at the cover / register / setting-out sheets,
  // which usually carry the project's Built-Up Area declaration. Plan
  // sheets sometimes carry it too (A101 setting-out plan), so we widen the
  // search to those text blobs plus a dedicated cover-sheet pull.
  const coverSheets = await prisma.sheet.findMany({
    where: {
      documentId: document.id,
      organizationId: job.organizationId,
      sheetType: { in: ['cover', 'register', 'plan'] },
      rawTextKey: { not: null },
    },
    select: { rawTextKey: true },
  })
  let coverTextBlob = ''
  for (const s of coverSheets) {
    if (!s.rawTextKey) continue
    const t = await blob.get(s.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')
    coverTextBlob += `\n${t}`
  }
  const declaredBuaM2 = recoverBuaFromText(coverTextBlob)
  // S9-1: persist the recovered BUA on the Project so downstream pages
  // (BOQ, takeoff review) can show "584 m²" without re-reading the cover
  // sheet. Idempotent: only writes when we have a new value AND it changed.
  if (declaredBuaM2 !== null) {
    await prisma.project.update({
      where: { id: document.projectId },
      data: { buaM2: declaredBuaM2 },
    })
  }
  // S8-5 unique room areas — sum of the post-dedup survivors.
  const uniqueRoomAreas: number[] = []
  for (const s of survivors) {
    if (s.qtyAi !== null) uniqueRoomAreas.push(Number(s.qtyAi.toString()))
  }
  const validatorCtx: ValidatorContext = {
    projectType: project?.type ?? null,
    doors,
    windows,
    planTextBlob,
    roomAreasM2: uniqueRoomAreas,
    declaredBuaM2,
  }
  const validatorResults = runValidators(validatorCtx)
  for (const r of validatorResults) {
    await upsertValidationFlag({
      client: prisma,
      organizationId: job.organizationId,
      projectId: document.projectId,
      takeoffItemId: r.takeoffItemId ?? null,
      rule: r.rule,
      severity: r.severity,
      message: r.message,
    })
  }

  if (tokensIn > 0 || tokensOut > 0) {
    await prisma.usage.upsert({
      where: { organizationId: job.organizationId },
      create: { organizationId: job.organizationId, tokensIn, tokensOut },
      update: {
        tokensIn: { increment: tokensIn },
        tokensOut: { increment: tokensOut },
      },
    })
  }

  // PB-3 hygiene: don't claim READY while sibling stage jobs are still
  // in flight for the same document. The SPRINT10 double-chain finished
  // EXTRACT_ROOMS on the slow side first, flipped the doc to READY, then
  // the second chain's ROOMS finished — UI showed READY with RUNNING
  // jobs underneath it. The doc moves to READY only when no pipeline
  // job is QUEUED or RUNNING.
  const stillActive = await prisma.job.count({
    where: {
      projectId: document.projectId,
      type: { in: ['INGEST', 'CLASSIFY', 'EXTRACT_FINISH_LEGEND', 'EXTRACT_SCHEDULES', 'EXTRACT_ROOMS'] },
      status: { in: ['QUEUED', 'RUNNING'] },
      payload: { path: ['documentId'], equals: document.id },
      // Exclude THIS handler's own job — its status still reads RUNNING
      // until the runner flips it to DONE after we return.
      id: { not: job.id },
    },
  })
  await prisma.document.update({
    where: { id: document.id },
    // Keep PROCESSING if a peer is still in flight; only flip READY when
    // we're the last one out.
    data: { status: stillActive > 0 ? 'PROCESSING' : 'READY' },
  })

  return {
    ok: true,
    documentId: document.id,
    roomsProcessed: itemsCreated,
    /** Sprint-4 S4-4: rooms that survived the cross-sheet dedupe pass. */
    deduplicatedSurvivors: itemsCreated - collapsedRoomDuplicates,
    /** Sprint-4 S4-4: per-project duplicate ROOM rows collapsed. */
    collapsedRoomDuplicates,
    spacesUpserted,
    manualSpacesSkipped: manualSkipped,
    rowMismatches: mismatches,
    quadrantsRendered,
    /** Sprint-7 S7-4: total spatial (bbox) name|area pairs recovered. */
    bboxPairsTotal,
    /** Sprint-7 S7-4: per-sheet spatial pair counts (for diagnostics). */
    bboxPairsBySheet,
    /** Sprint-8 S8-2: survivors skipped from Spaces because no area. */
    unmeasuredSurvivors,
    /** P3 — title-block / schedule-frame names dropped at the funnel. */
    roomsRejected,
    /** P3 — building-level statements routed to AREA_STATEMENT category. */
    areaStatementsReclassified,
    /** P5/P6 — Sprint-9 S9-2 color-sampler counters: rooms remapped via
     *  RGB sampling of the I4xx finish plans against the legend palette.
     *  null if the pass was skipped (no I4xx sheets / no rooms / error). */
    colorMap: colorMap
      ? {
          sheetsProcessed: colorMap.sheetsProcessed,
          roomsConsidered: colorMap.roomsConsidered,
          roomsMapped: colorMap.roomsMapped,
          newlyMapped: colorMap.newlyMapped,
          changedCode: colorMap.changedCode,
          paletteSamplesFromDocument: colorMap.paletteSamplesFromDocument,
          paletteSamplesCanonical: colorMap.paletteSamplesCanonical,
        }
      : null,
    /** Sprint-4 S4-5: validation flags raised by the post-extraction net. */
    validatorFlagsRaised: validatorResults.length,
    tokensIn,
    tokensOut,
  }
}
