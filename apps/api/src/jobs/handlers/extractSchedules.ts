/**
 * EXTRACT_SCHEDULES — Sprint 2 → Sprint 4 third pipeline stage.
 *
 *   payload = { documentId }
 *
 * Sprint-4 changes:
 *   - Vision call is `extractSchedule.v2` (unified). The model self-reports
 *     `kind: DOOR | WINDOW | null`. The handler's `decideKind` title heuristic
 *     becomes a hint (extended with glazing|cw|curtain|panel), passed in
 *     `kindHint`. The vision-reported kind wins on conflict.
 *   - Sheets classified as `legend` (not just `schedule`) are eligible — a
 *     Plot-4357 lesson where the window schedule was titled "GLAZING TYPES"
 *     and lived on a sheet that classify rightly called 'legend'.
 *   - Vision returns kind=null + rows=[] when the sheet isn't actually a
 *     schedule; the handler quietly skips the sheet (no flag).
 *
 * Dual-pass reconciliation unchanged:
 *   - both agree                ⇒ TakeoffItem basis=MEASURED confidence=90
 *   - both disagree on any col  ⇒ TakeoffItem basis=MEASURED confidence=60
 *                                + ValidationFlag(ROW_MISMATCH, ERROR, both values)
 *   - vision only               ⇒ TakeoffItem basis=VISUAL confidence=70
 *   - text only                 ⇒ TakeoffItem basis=PARAMETRIC confidence=50
 *
 * Chains into EXTRACT_ROOMS on success.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { STUB_SUFFIX, extractSchedule } from '../../ai/anthropic'
import { scheduleTextPass } from '../../ai/scheduleTextPass'
import type { ExtractScheduleRow, ScheduleKind } from '../../ai/types'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import { enqueueIfNotDone } from '../chainGuard'
import { upsertValidationFlag } from '../validationFlagUpsert'
import type { JobHandler, JobRecord } from '../types'

interface ExtractSchedulesPayload {
  documentId: string
}

const SCHEDULE_SHEET_TYPES = new Set(['schedule', 'legend'])

const RULE_ROW_MISMATCH = 'ROW_MISMATCH'

interface ReconciledRow {
  tag: string
  description: string
  /**
   * Sprint-10 PB-4 — the schedule's count column ("D01 6 1.00 3.00" =
   * 6 copies). Was being silently dropped at the handler boundary; both
   * SPRINT10 and S8-8 runs ended up with qtyAi=1 across the board.
   * Counts now flow into meta.count AND become qtyAi when known.
   */
  count: number | null
  width_mm: number | null
  height_mm: number | null
  finish: string | null
  type: string | null
  remarks: string | null
  basis: 'MEASURED' | 'VISUAL' | 'PARAMETRIC'
  confidence: number
  mismatch: null | { field: string; vision: unknown; text: unknown }
}

function mergeMaps(
  vision: ExtractScheduleRow[],
  text: ExtractScheduleRow[],
): { tags: string[]; visionMap: Map<string, ExtractScheduleRow>; textMap: Map<string, ExtractScheduleRow> } {
  const visionMap = new Map<string, ExtractScheduleRow>(vision.map((r) => [r.tag, r]))
  const textMap = new Map<string, ExtractScheduleRow>(text.map((r) => [r.tag, r]))
  const tags = new Set<string>([...visionMap.keys(), ...textMap.keys()])
  return { tags: Array.from(tags), visionMap, textMap }
}

function compareNumeric(a: number | null, b: number | null): boolean {
  return a == null || b == null ? a === b : Math.abs(a - b) < 0.0001
}

function reconcile(
  vision: ExtractScheduleRow[],
  text: ExtractScheduleRow[],
  kind: ScheduleKind,
): ReconciledRow[] {
  const { tags, visionMap, textMap } = mergeMaps(vision, text)
  return tags.map((tag) => {
    const v = visionMap.get(tag)
    const t = textMap.get(tag)
    if (v && t) {
      // Compare every column. First mismatched column wins the flag message.
      // PB-4: count drift is the swap-trap canary on door/window schedules.
      // Check it first so a count mismatch surfaces ahead of dim drift.
      const visionCount = typeof v.count === 'number' ? v.count : null
      const textCount = typeof t.count === 'number' ? t.count : null
      const mismatchedField =
        visionCount !== null && textCount !== null && visionCount !== textCount
          ? { field: 'count', vision: visionCount, text: textCount }
          : !compareNumeric(v.width_mm, t.width_mm)
          ? { field: 'width_mm', vision: v.width_mm, text: t.width_mm }
          : !compareNumeric(v.height_mm, t.height_mm)
          ? { field: 'height_mm', vision: v.height_mm, text: t.height_mm }
          : (v.finish ?? '') !== (t.finish ?? '')
          ? { field: 'finish', vision: v.finish, text: t.finish }
          : null
      // P5/P6 — count selection. Cold-upload dump showed CW01 land with
      // count=193 because vision hallucinated a 3-digit number off the
      // schedule sheet and the reconciler trusted vision-over-text
      // unconditionally (`visionCount ?? textCount`). For schedules, the
      // text-pass is the authoritative source: the architect's columnar
      // data is unambiguous, vision's LLM read of tabular content is not.
      // Prefer text on disagreement. As a belt-and-braces, cap implausibly
      // large counts: residential window types rarely exceed 50 units —
      // treat anything past that as a hallucination and fall back to the
      // other source.
      const COUNT_SANITY_CAP = 50
      const sanitize = (n: number | null): number | null =>
        n !== null && n > COUNT_SANITY_CAP ? null : n
      const safeText = sanitize(textCount)
      const safeVision = sanitize(visionCount)
      const reconciledCount = safeText ?? safeVision
      return {
        tag,
        description: `${kind === 'DOOR' ? 'Door' : 'Window'} ${tag}${v.finish ? ` (${v.finish})` : ''}`,
        count: reconciledCount,
        width_mm: v.width_mm,
        height_mm: v.height_mm,
        finish: v.finish,
        type: v.type,
        remarks: v.remarks,
        basis: 'MEASURED' as const,
        confidence: mismatchedField ? 60 : 90,
        mismatch: mismatchedField,
      }
    }
    if (v) {
      return {
        tag,
        description: `${kind === 'DOOR' ? 'Door' : 'Window'} ${tag} (vision-only)`,
        count: typeof v.count === 'number' ? v.count : null,
        width_mm: v.width_mm,
        height_mm: v.height_mm,
        finish: v.finish,
        type: v.type,
        remarks: v.remarks,
        basis: 'VISUAL' as const,
        confidence: 70,
        mismatch: null,
      }
    }
    return {
      tag,
      description: `${kind === 'DOOR' ? 'Door' : 'Window'} ${tag} (text-only)`,
      count: typeof t!.count === 'number' ? t!.count : null,
      width_mm: t!.width_mm,
      height_mm: t!.height_mm,
      finish: t!.finish,
      type: t!.type,
      remarks: t!.remarks,
      basis: 'PARAMETRIC' as const,
      confidence: 50,
      mismatch: null,
    }
  })
}

/**
 * Re-render the schedule page at 200 DPI for the vision pass. Spec calls for
 * higher resolution on schedules specifically (tabular content needs detail).
 * In stub mode the AI doesn't actually look at the bytes; we still do the work
 * so the timing characteristics are realistic.
 */
async function renderHighRes(documentBytes: Buffer, pageNo: number): Promise<string | null> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `schedule-${pageNo}-`))
  try {
    const src = path.join(workDir, 'source.pdf')
    await fs.writeFile(src, documentBytes)
    const prefix = path.join(workDir, 'page')
    // @ts-ignore Bun global
    const proc = Bun.spawn(
      ['pdftoppm', '-jpeg', '-r', '200', '-f', String(pageNo), '-l', String(pageNo), src, prefix],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const code = await proc.exited
    if (code !== 0) return null
    // pdftoppm emits page-<n>.jpg with no padding when only one page is rendered.
    const candidates = [`${prefix}-${pageNo}.jpg`, `${prefix}-1.jpg`]
    for (const c of candidates) {
      try {
        const bytes = await fs.readFile(c)
        return bytes.toString('base64')
      } catch {
        // try next
      }
    }
    return null
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Sprint-4: returns a HINT only. The vision pass's `kind` self-report wins.
 * Extended vocabulary so glazing/curtain-wall sheets (Plot 4357 A501/A502
 * "GLAZING TYPES") are seeded toward WINDOW even when the title omits the
 * word "window" or "schedule".
 */
function decideKind(sheet: { title: string | null; drawingNo: string | null }): ScheduleKind | null {
  const haystack = `${sheet.title ?? ''} ${sheet.drawingNo ?? ''}`.toLowerCase()
  if (/door/.test(haystack)) return 'DOOR'
  // 'glazing' / 'cw' / 'curtain' / 'panel' / 'window' all route to WINDOW.
  if (/window|curtain[\s_-]*wall|glazing|panel|\bcw\b|^cw/.test(haystack)) return 'WINDOW'
  return null
}

export const extractSchedulesHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as ExtractSchedulesPayload
  if (!payload.documentId) throw new Error('EXTRACT_SCHEDULES: payload.documentId required')

  const document = await prisma.document.findFirst({
    where: { id: payload.documentId, organizationId: job.organizationId },
  })
  if (!document) throw new Error(`EXTRACT_SCHEDULES: document ${payload.documentId} not found`)

  const sheets = await prisma.sheet.findMany({
    where: {
      documentId: document.id,
      organizationId: job.organizationId,
      sheetType: { in: Array.from(SCHEDULE_SHEET_TYPES) },
    },
    orderBy: { pageNo: 'asc' },
  })

  const blob = getBlobStore()
  const sourceBytes = await blob.get(document.storageKey)

  let tokensIn = 0
  let tokensOut = 0
  let itemsCreated = 0
  let mismatches = 0

  for (const sheet of sheets) {
    // Sprint-4: the title heuristic is now ADVISORY. Even if kindHint is
    // null, we still call vision — it may correctly identify a schedule the
    // title didn't reveal. Vision-reported kind wins.
    const kindHint = decideKind({ title: sheet.title, drawingNo: sheet.drawingNo })

    const jpegBase64 = await renderHighRes(sourceBytes, sheet.pageNo)
    // PB-4: load the FULL text-layer of the schedule sheet for the
    // text-pass — A551's body sits past 4 KB on Plot 4357, so the
    // prior 4 KB slice was guaranteeing a zero-row text pass and
    // forcing every row to vision-only basis with qtyAi=1. Vision
    // still gets a slice (token budget) but the text-side parser
    // sees everything.
    const rawText = sheet.rawTextKey
      ? await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')
      : ''
    const textSnippet = rawText.slice(0, 4000)

    const vision = await extractSchedule({
      documentId: document.id,
      pageNo: sheet.pageNo,
      kindHint,
      jpegBase64,
      textSnippet,
    })
    tokensIn += vision.tokensIn
    tokensOut += vision.tokensOut

    // Vision said "not a schedule" → quietly skip.
    if (vision.kind === null) continue
    const kind: ScheduleKind = vision.kind

    const text = scheduleTextPass(rawText, kind)
    const reconciled = reconcile(vision.rows, text, kind)

    const visionFromStub = vision.promptVersion.endsWith(STUB_SUFFIX)
    for (const row of reconciled) {
      const meta: Record<string, unknown> = {
        // PB-4: count was being dropped here. Both SPRINT10 and S8-8 ran
        // qty=1 across the board because of this. Counts now persist;
        // qtyAi uses them when known so QUANTIFY / BOQ see real totals.
        count: row.count,
        width_mm: row.width_mm,
        height_mm: row.height_mm,
        finish: row.finish,
        type: row.type,
        remarks: row.remarks,
      }
      // Sprint-3 A1: mark the takeoff row when the vision pass was stubbed.
      // The text pass is real, so the row isn't fully fabricated — we surface
      // both facts explicitly.
      if (visionFromStub) meta.stub = true
      const category = kind === 'DOOR' ? 'DOOR' : 'WINDOW'
      // S7-1 natural-key upsert: (project, category, tag).
      //
      // MULTI-DOC #3 (2026-06-21) — previously also scoped to
      // `sourceSheet.documentId = document.id`, which meant D01 in
      // doc-A and D01 in doc-B were treated as different rows. One
      // project = one villa (the BOQ generator already assumes this);
      // the same tag across docs IS the same door. Dropping the doc
      // filter makes the natural key match what the legend handler
      // already does. The UPDATE branch below overwrites with the
      // current doc's values (newest-wins, per user verdict): the
      // most recent extraction owns the row, and the sourceSheet
      // pointer lands on the freshest sheet so the trace stays
      // current.
      const existing = await prisma.takeoffItem.findFirst({
        where: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          deletedAt: null,
          category,
          tag: row.tag,
        },
        select: { id: true },
      })
      // Schedule items go in at status='EDITED' so the BOQ generator's
      // default onlyApproved filter (APPROVED + EDITED) admits them
      // without a human round-trip. Doors/windows ARE the architect's
      // schedule — counts and dims are extracted, not opinions. The
      // reviewer can still edit qtyFinal inline if a row is wrong; the
      // status stays EDITED through that edit. Matches QUANTIFY's
      // pattern for its derived FLOOR_FINISH / CEILING / WALL_FINISH
      // lines (quantify.ts:465).
      const created = existing
        ? await prisma.takeoffItem.update({
            where: { id: existing.id },
            data: {
              description: row.description,
              unit: 'nr',
              qtyAi: row.count ?? 1,
              basis: row.basis,
              confidence: row.confidence,
              status: 'EDITED',
              sourceSheetId: sheet.id,
              sourceNote: `${sheet.drawingNo ?? `page ${sheet.pageNo}`}`,
              meta: meta as object,
              promptVersion: vision.promptVersion,
            },
          })
        : await prisma.takeoffItem.create({
            data: {
              organizationId: job.organizationId,
              projectId: document.projectId,
              category,
              tag: row.tag,
              description: row.description,
              unit: 'nr',
              qtyAi: row.count ?? 1,
              basis: row.basis,
              confidence: row.confidence,
              status: 'EDITED',
              sourceSheetId: sheet.id,
              sourceNote: `${sheet.drawingNo ?? `page ${sheet.pageNo}`}`,
              meta: meta as object,
              promptVersion: vision.promptVersion,
            },
          })
      itemsCreated += 1

      if (row.mismatch) {
        mismatches += 1
        await upsertValidationFlag({
          client: prisma,
          organizationId: job.organizationId,
          projectId: document.projectId,
          takeoffItemId: created.id,
          rule: RULE_ROW_MISMATCH,
          severity: 'ERROR',
          message: `${kind} ${row.tag}: ${row.mismatch.field} disagrees (vision=${row.mismatch.vision}, text=${row.mismatch.text}).`,
        })
      }
    }
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

  // S7-1: chain handoff no-op guard.
  await enqueueIfNotDone({
    client: prisma,
    organizationId: job.organizationId,
    projectId: document.projectId,
    type: 'EXTRACT_ROOMS',
    documentId: document.id,
  })

  return {
    ok: true,
    documentId: document.id,
    schedulesProcessed: sheets.length,
    itemsCreated,
    rowMismatches: mismatches,
    tokensIn,
    tokensOut,
  }
}
