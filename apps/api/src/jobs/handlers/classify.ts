/**
 * CLASSIFY — Sprint 2 second pipeline stage.
 *
 *   payload = { documentId }
 *
 * For every Sheet that doesn't yet have `aiJson`, ask the Anthropic client to
 * classify it. Inputs: the per-page jpeg (base64) + first 1500 chars of text
 * layer. Output: drawing_no/title/discipline/sheet_type/scale/floor +
 * confidence. We stamp `promptVersion` on every Sheet — that's the lever for
 * later A/B prompt evaluation.
 *
 * Post-loop rule from the spec: if NO sheet was classified as STR or MEP,
 * raise a project-wide MISSING_DISCIPLINE ValidationFlag (WARN) — those
 * disciplines will need to be marked PROVISIONAL in pricing later. Sprint 2's
 * acceptance fixture deliberately has no STR/MEP set, so the flag fires.
 *
 * Chains into EXTRACT_FINISH_LEGEND on success (Sprint 6); that handler
 * chains the rest of the takeoff pipeline.
 */
import { STUB_SUFFIX, classifySheet } from '../../ai/anthropic'
import { CLASSIFY_PROMPT_VERSION } from '../../ai/prompts/classify.v1'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import { enqueueIfNotDone } from '../chainGuard'
import type { JobHandler, JobRecord } from '../types'

const isStubResult = (promptVersion: string): boolean => promptVersion.endsWith(STUB_SUFFIX)

// Sprint-4 S4-6 (c): UAE-convention drawing-number prefixes. MEP sheets use
// 'M-…' (mechanical) or 'E-…' (electrical). Structural is 'S-…'. The check
// is intentionally loose — the vision pass sometimes drops the dash or
// reads e.g. "ME-001" — so we look at the first character only.
function firstChar(drawingNo: string | null | undefined): string | null {
  if (!drawingNo) return null
  const trimmed = drawingNo.trim()
  return trimmed.length === 0 ? null : trimmed.charAt(0).toUpperCase()
}

function isMepDrawingPrefix(drawingNo: string | null | undefined): boolean {
  const c = firstChar(drawingNo)
  // Unknown drawing-no → don't assert mismatch (we can't disprove).
  if (c === null) return true
  return c === 'M' || c === 'E' || c === 'P' // P for plumbing
}

function isStrDrawingPrefix(drawingNo: string | null | undefined): boolean {
  const c = firstChar(drawingNo)
  if (c === null) return true
  return c === 'S'
}

interface ClassifyJobPayload {
  documentId: string
}

const MISSING_DISCIPLINE_RULE = 'MISSING_DISCIPLINE'

export const classifyHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as ClassifyJobPayload
  if (!payload.documentId) throw new Error('CLASSIFY: payload.documentId required')

  const document = await prisma.document.findFirst({
    where: { id: payload.documentId, organizationId: job.organizationId },
  })
  if (!document) throw new Error(`CLASSIFY: document ${payload.documentId} not found`)

  const sheets = await prisma.sheet.findMany({
    where: { documentId: document.id, organizationId: job.organizationId },
    orderBy: { pageNo: 'asc' },
  })

  const blob = getBlobStore()
  let tokensIn = 0
  let tokensOut = 0
  // Sprint-5 S5-A idempotency contract:
  //   - Initial filter skips sheets whose `aiJson` is already populated. This
  //     covers the steady-state reaper-driven retry case (one process, one
  //     attempt at a time): a previous attempt's per-sheet writes already
  //     survived into the DB, so the next attempt only does the rest.
  //   - The per-iteration freshness check below also guards against the
  //     concurrent-worker case (Sprint 4+ may run multiple workers). A
  //     sibling worker could have classified this sheet between the bulk
  //     load above and this loop iteration; if so, skip and don't re-bill
  //     Anthropic.
  // Either way: an already-classified sheet is never re-billed.
  const pendingSheets = sheets.filter((s) => s.aiJson === null)

  for (const sheet of pendingSheets) {
    const fresh = await prisma.sheet.findUnique({
      where: { id: sheet.id },
      select: { aiJson: true },
    })
    if (fresh?.aiJson !== null && fresh?.aiJson !== undefined) continue

    const textSnippet = sheet.rawTextKey
      ? (await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')).slice(0, 1500)
      : ''
    const jpegBase64 = sheet.imageKey
      ? await blob.get(sheet.imageKey).then((b) => b.toString('base64')).catch(() => null)
      : null

    const result = await classifySheet({
      documentId: document.id,
      pageNo: sheet.pageNo,
      totalPages: sheets.length,
      jpegBase64,
      textSnippet,
    })

    tokensIn += result.tokensIn
    tokensOut += result.tokensOut

    // Sprint-4 S4-6 (c): register misclassification guard. The Sprint-3 live
    // run had vision assert discipline=MEP on architectural sheets whose
    // drawing-no started with A. UAE convention: M / E prefix = MEP; S = STR.
    // If the assertion doesn't match the prefix, downgrade the discipline to
    // UNKNOWN and emit an INFO flag at the document level (added below).
    let effectiveDiscipline = result.discipline
    let prefixMismatch = false
    if (result.discipline === 'MEP' && !isMepDrawingPrefix(result.drawing_no)) {
      effectiveDiscipline = 'UNKNOWN'
      prefixMismatch = true
    } else if (result.discipline === 'STR' && !isStrDrawingPrefix(result.drawing_no)) {
      effectiveDiscipline = 'UNKNOWN'
      prefixMismatch = true
    }

    // Sprint-3 A1: stub outputs carry an unmistakable marker so fabricated
    // data is recognisable forever — both via promptVersion (`...-stub`) and
    // via aiJson.stub=true.
    const aiJson: Record<string, unknown> = {
      ...(result as unknown as Record<string, unknown>),
    }
    if (isStubResult(result.promptVersion)) aiJson.stub = true
    if (prefixMismatch) {
      aiJson.disciplineRaw = result.discipline
      aiJson.disciplinePrefixMismatch = true
    }
    await prisma.sheet.update({
      where: { id: sheet.id },
      data: {
        drawingNo: result.drawing_no,
        title: result.title,
        discipline: effectiveDiscipline,
        sheetType: result.sheet_type,
        scaleNote: result.scale,
        aiJson: aiJson as object,
        promptVersion: result.promptVersion,
      },
    })
    if (prefixMismatch) {
      const existing = await prisma.validationFlag.findFirst({
        where: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          rule: 'DISCIPLINE_PREFIX_MISMATCH',
          message: { contains: sheet.id },
          resolved: false,
        },
        select: { id: true },
      })
      if (!existing) {
        await prisma.validationFlag.create({
          data: {
            organizationId: job.organizationId,
            projectId: document.projectId,
            rule: 'DISCIPLINE_PREFIX_MISMATCH',
            severity: 'INFO',
            message: `Sheet ${sheet.id} drawing_no=${result.drawing_no ?? '?'} (page ${sheet.pageNo}): AI asserted discipline=${result.discipline} but the drawing-no prefix doesn't match UAE convention (M/E for MEP, S for STR). Downgraded to UNKNOWN.`,
          },
        })
      }
    }
  }

  // Re-read after writes so we work off the now-classified set.
  const classified = await prisma.sheet.findMany({
    where: { documentId: document.id, organizationId: job.organizationId },
    select: { discipline: true },
  })
  const disciplines = new Set(
    classified.map((c) => c.discipline).filter((d): d is string => !!d),
  )

  // Sprint-4: one flag per missing discipline, not one flag for both. Sprint-3
  // collapsed them so a set with MEP but no STR (or vice versa) silently
  // skipped the warning.
  const missingDisciplines: Array<'STR' | 'MEP'> = []
  if (!disciplines.has('STR')) missingDisciplines.push('STR')
  if (!disciplines.has('MEP')) missingDisciplines.push('MEP')
  for (const discipline of missingDisciplines) {
    const message = `No ${discipline} sheets detected — that section will be PROVISIONAL until covered.`
    const existing = await prisma.validationFlag.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        rule: MISSING_DISCIPLINE_RULE,
        takeoffItemId: null,
        message,
        resolved: false,
      },
      select: { id: true },
    })
    if (existing) continue
    await prisma.validationFlag.create({
      data: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        rule: MISSING_DISCIPLINE_RULE,
        severity: 'WARN',
        message,
      },
    })
  }
  const missingDiscipline = missingDisciplines.length > 0

  // Token meter (Anthropic-side cost).
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

  // S7-1: chain handoff no-op guard. Skip if the legend stage already DONE.
  await enqueueIfNotDone({
    client: prisma,
    organizationId: job.organizationId,
    projectId: document.projectId,
    type: 'EXTRACT_FINISH_LEGEND',
    documentId: document.id,
  })

  return {
    ok: true,
    documentId: document.id,
    classified: pendingSheets.length,
    disciplinesSeen: Array.from(disciplines).sort(),
    missingDisciplineFlagFired: missingDiscipline,
    promptVersion: CLASSIFY_PROMPT_VERSION,
    tokensIn,
    tokensOut,
  }
}
