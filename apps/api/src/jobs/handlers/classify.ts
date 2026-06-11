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
 * Chains into EXTRACT_SCHEDULES on success.
 */
import { STUB_SUFFIX, classifySheet } from '../../ai/anthropic'
import { CLASSIFY_PROMPT_VERSION } from '../../ai/prompts/classify.v1'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import type { JobHandler, JobRecord } from '../types'

const isStubResult = (promptVersion: string): boolean => promptVersion.endsWith(STUB_SUFFIX)

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
  const pendingSheets = sheets.filter((s) => s.aiJson === null)

  for (const sheet of pendingSheets) {
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

    // Sprint-3 A1: stub outputs carry an unmistakable marker so fabricated
    // data is recognisable forever — both via promptVersion (`...-stub`) and
    // via aiJson.stub=true.
    const aiJson: Record<string, unknown> = {
      ...(result as unknown as Record<string, unknown>),
    }
    if (isStubResult(result.promptVersion)) aiJson.stub = true
    await prisma.sheet.update({
      where: { id: sheet.id },
      data: {
        drawingNo: result.drawing_no,
        title: result.title,
        discipline: result.discipline,
        sheetType: result.sheet_type,
        scaleNote: result.scale,
        aiJson: aiJson as object,
        promptVersion: result.promptVersion,
      },
    })
  }

  // Re-read after writes so we work off the now-classified set.
  const classified = await prisma.sheet.findMany({
    where: { documentId: document.id, organizationId: job.organizationId },
    select: { discipline: true },
  })
  const disciplines = new Set(
    classified.map((c) => c.discipline).filter((d): d is string => !!d),
  )

  const missingDiscipline = !disciplines.has('STR') && !disciplines.has('MEP')
  if (missingDiscipline) {
    // Idempotent: skip if we already flagged this project for the same rule.
    const existing = await prisma.validationFlag.findFirst({
      where: {
        organizationId: job.organizationId,
        projectId: document.projectId,
        rule: MISSING_DISCIPLINE_RULE,
        takeoffItemId: null,
        resolved: false,
      },
    })
    if (!existing) {
      await prisma.validationFlag.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          rule: MISSING_DISCIPLINE_RULE,
          severity: 'WARN',
          message:
            'No STR or MEP sheets detected — those sections will be PROVISIONAL until covered.',
        },
      })
    }
  }

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

  // Chain → EXTRACT_SCHEDULES.
  await prisma.job.create({
    data: {
      organizationId: job.organizationId,
      projectId: document.projectId,
      type: 'EXTRACT_SCHEDULES',
      payload: { documentId: document.id } as object,
    },
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
