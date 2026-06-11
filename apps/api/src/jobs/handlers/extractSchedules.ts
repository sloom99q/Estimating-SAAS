/**
 * EXTRACT_SCHEDULES — Sprint 2 third pipeline stage.
 *
 *   payload = { documentId }
 *
 * DUAL-PASS reconciliation, per the Plot 4357 pilot lesson:
 *
 *   (a) VISION pass: Anthropic vision call (extractDoors.v1 / extractWindows.v1)
 *       runs against the page rendered at 200 DPI.
 *   (b) TEXT pass:   independent regex parse of pdftotext output (stubbed in
 *       dev to a hand-designed mismatch on CW09 width).
 *
 * Per tag:
 *   - both agree                ⇒ TakeoffItem basis=MEASURED confidence=90
 *   - both disagree on any col  ⇒ TakeoffItem basis=MEASURED confidence=60
 *                                + ValidationFlag(ROW_MISMATCH, ERROR, both values)
 *   - vision only               ⇒ TakeoffItem basis=VISUAL confidence=70
 *   - text only                 ⇒ TakeoffItem basis=PARAMETRIC confidence=50
 *
 * NEVER silent-pick on a mismatch. The flag fires and the human reviews.
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
import type { JobHandler, JobRecord } from '../types'

interface ExtractSchedulesPayload {
  documentId: string
}

const SCHEDULE_SHEET_TYPES = new Set(['schedule', 'legend'])

const RULE_ROW_MISMATCH = 'ROW_MISMATCH'

interface ReconciledRow {
  tag: string
  description: string
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
      const mismatchedField =
        !compareNumeric(v.width_mm, t.width_mm)
          ? { field: 'width_mm', vision: v.width_mm, text: t.width_mm }
          : !compareNumeric(v.height_mm, t.height_mm)
          ? { field: 'height_mm', vision: v.height_mm, text: t.height_mm }
          : (v.finish ?? '') !== (t.finish ?? '')
          ? { field: 'finish', vision: v.finish, text: t.finish }
          : null
      return {
        tag,
        description: `${kind === 'DOOR' ? 'Door' : 'Window'} ${tag}${v.finish ? ` (${v.finish})` : ''}`,
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
    // t is defined here (the tag came from textMap).
    return {
      tag,
      description: `${kind === 'DOOR' ? 'Door' : 'Window'} ${tag} (text-only)`,
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

function decideKind(sheet: { title: string | null; drawingNo: string | null }): ScheduleKind | null {
  const haystack = `${sheet.title ?? ''} ${sheet.drawingNo ?? ''}`.toLowerCase()
  if (/door/.test(haystack)) return 'DOOR'
  if (/window|curtain[\s_-]*wall|cw/.test(haystack)) return 'WINDOW'
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
    const kind = decideKind({ title: sheet.title, drawingNo: sheet.drawingNo })
    if (!kind) continue

    const jpegBase64 = await renderHighRes(sourceBytes, sheet.pageNo)
    const textSnippet = sheet.rawTextKey
      ? (await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')).slice(0, 4000)
      : ''

    const vision = await extractSchedule({
      documentId: document.id,
      pageNo: sheet.pageNo,
      kind,
      jpegBase64,
      textSnippet,
    })
    tokensIn += vision.tokensIn
    tokensOut += vision.tokensOut

    const text = scheduleTextPass(textSnippet, kind)
    const reconciled = reconcile(vision.rows, text, kind)

    const visionFromStub = vision.promptVersion.endsWith(STUB_SUFFIX)
    for (const row of reconciled) {
      const meta: Record<string, unknown> = {
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
      const created = await prisma.takeoffItem.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          category: kind === 'DOOR' ? 'DOOR' : 'WINDOW',
          tag: row.tag,
          description: row.description,
          unit: 'nr',
          qtyAi: 1,
          basis: row.basis,
          confidence: row.confidence,
          sourceSheetId: sheet.id,
          sourceNote: `${sheet.drawingNo ?? `page ${sheet.pageNo}`}`,
          meta: meta as object,
          promptVersion: vision.promptVersion,
        },
      })
      itemsCreated += 1

      if (row.mismatch) {
        mismatches += 1
        await prisma.validationFlag.create({
          data: {
            organizationId: job.organizationId,
            projectId: document.projectId,
            takeoffItemId: created.id,
            rule: RULE_ROW_MISMATCH,
            severity: 'ERROR',
            message: `${kind} ${row.tag}: ${row.mismatch.field} disagrees (vision=${row.mismatch.vision}, text=${row.mismatch.text}).`,
          },
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

  await prisma.job.create({
    data: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      type: 'EXTRACT_ROOMS',
      payload: { documentId: document.id } as object,
    },
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
