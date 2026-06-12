import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { remapFinishesForProject } from '../jobs/handlers/extractRooms'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

/**
 * Sprint-9 S9-3: closed legend-code vocabulary the SPA dropdown offers
 * for the per-room finish override. Anything outside this set is
 * rejected at the API boundary — the human can only assign a real legend
 * code (or the BATHROOM sentinel), not invent one.
 */
const FINISH_CODE_VOCAB = [
  'ST01',
  'ST02',
  'ST03',
  'PR01',
  'PR03',
  'WD01',
  'FN01',
  'FN02',
  'FN03',
  'FN04',
  'LS01',
  'LS02',
  'BATHROOM',
] as const

const PATCH_BODY = z
  .object({
    qtyFinal: z
      .union([z.number().finite().nonnegative(), z.null()])
      .optional(),
    status: z.enum(['AI', 'EDITED', 'APPROVED']).optional(),
    /** Sprint-9 S9-3 — per-room finish override. Null clears the code. */
    finishCode: z
      .union([z.enum(FINISH_CODE_VOCAB), z.null()])
      .optional(),
  })
  .refine(
    (b) => b.qtyFinal !== undefined || b.status !== undefined || b.finishCode !== undefined,
    'At least one of qtyFinal / status / finishCode is required',
  )

function takeoffDto(row: {
  id: string
  organizationId: string
  projectId: string
  category: string
  tag: string | null
  description: string
  unit: string
  qtyAi: Prisma.Decimal | null
  qtyFinal: Prisma.Decimal | null
  basis: string
  confidence: number
  sourceSheetId: string | null
  sourceNote: string | null
  status: string
  meta: Prisma.JsonValue | null
  promptVersion: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    category: row.category,
    tag: row.tag,
    description: row.description,
    unit: row.unit,
    qtyAi: row.qtyAi === null ? null : row.qtyAi.toString(),
    qtyFinal: row.qtyFinal === null ? null : row.qtyFinal.toString(),
    basis: row.basis,
    confidence: row.confidence,
    sourceSheetId: row.sourceSheetId,
    sourceNote: row.sourceNote,
    status: row.status,
    meta: row.meta,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function flagDto(row: {
  id: string
  projectId: string
  takeoffItemId: string | null
  rule: string
  severity: string
  message: string
  resolved: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    takeoffItemId: row.takeoffItemId,
    rule: row.rule,
    severity: row.severity,
    message: row.message,
    resolved: row.resolved,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function registerTakeoffRoutes(router: Router): void {
  /**
   * POST /api/projects/:id/remap-finishes
   *
   * Sprint-7 S7-3. Re-runs the deterministic finish-code assignment over
   * every ROOM TakeoffItem in the project against the CURRENT legend
   * vocabulary. Zero tokens, zero vision. Useful after a LEGEND re-run or
   * groundtruth refresh.
   */
  router.post(
    '/api/projects/:id/remap-finishes',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const result = await remapFinishesForProject(ctx.organizationId, project.id)
      return jsonResponse(result)
    }),
  )

  /**
   * GET /api/projects/:id/takeoff-items
   *
   * Powers the review table (Sprint 2 S2-6). Returns every TakeoffItem for the
   * project, ordered by category then tag, with the project's ValidationFlags
   * embedded under `flagsByItem` so the SPA can render confidence + flags in
   * one paint without N+1 fetches.
   */
  router.get(
    '/api/projects/:id/takeoff-items',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      const [items, flags] = await Promise.all([
        db.takeoffItem.findMany({
          where: { projectId: project.id, deletedAt: null },
          orderBy: [{ category: 'asc' }, { tag: 'asc' }, { createdAt: 'asc' }],
        }),
        db.validationFlag.findMany({
          where: { projectId: project.id },
          orderBy: { createdAt: 'desc' },
        }),
      ])
      const flagsByItem: Record<string, ReturnType<typeof flagDto>[]> = {}
      const projectFlags: ReturnType<typeof flagDto>[] = []
      for (const f of flags) {
        const d = flagDto(f)
        if (f.takeoffItemId) {
          flagsByItem[f.takeoffItemId] ??= []
          flagsByItem[f.takeoffItemId]!.push(d)
        } else {
          projectFlags.push(d)
        }
      }
      return jsonResponse({
        items: items.map(takeoffDto),
        flagsByItem,
        projectFlags,
      })
    }),
  )

  /**
   * PATCH /api/takeoff-items/:id
   *
   * Inline edit of qtyFinal or status from the review table. If qtyFinal
   * actually changes from the AI's qtyAi, we write a Correction row so the
   * prompt designers can A/B compare later.
   */
  router.patch(
    '/api/takeoff-items/:id',
    requireAuth(async (req, ctx) => {
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const parsed = PATCH_BODY.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(400, 'Invalid payload', parsed.error.format())
      }
      const db = tenantDb(ctx.organizationId)
      const existing = await db.takeoffItem.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      if (!existing) return errorResponse(404, 'Takeoff item not found')

      const qtyChanged =
        parsed.data.qtyFinal !== undefined &&
        String(parsed.data.qtyFinal ?? '') !==
          String(existing.qtyAi === null ? '' : existing.qtyAi.toString())

      // S9-3 finishCode change detection. The current code lives in
      // meta.finish_code from the colour mapper / vision pass.
      const existingMeta = (existing.meta ?? {}) as Record<string, unknown>
      const currentFinish =
        typeof existingMeta.finish_code === 'string' ? existingMeta.finish_code : null
      const finishChanged =
        parsed.data.finishCode !== undefined &&
        (parsed.data.finishCode ?? null) !== currentFinish

      const data: Record<string, unknown> = {}
      if (parsed.data.qtyFinal !== undefined) data.qtyFinal = parsed.data.qtyFinal
      if (parsed.data.status !== undefined) data.status = parsed.data.status
      // Auto-promote AI → EDITED when qty OR finish diverges and the caller
      // did not explicitly send a status. Keeps the review table's "needs
      // review" filter (default AI rows) honest.
      if ((qtyChanged || finishChanged) && parsed.data.status === undefined) data.status = 'EDITED'

      // S9-3 meta write — keep every other key, set the new finish_code.
      if (finishChanged) {
        data.meta = {
          ...existingMeta,
          finish_code: parsed.data.finishCode ?? null,
          // Stamp the override source so QUANTIFY and the BOQ know this
          // came from the reviewer's hand, not the colour mapper.
          finishSource: 'human-override',
        } as Prisma.JsonObject
      }

      const writes: Prisma.PrismaPromise<unknown>[] = []
      writes.push(
        db.takeoffItem.update({
          where: { id: existing.id },
          data,
        }),
      )
      if (qtyChanged) {
        writes.push(
          db.correction.create({
            data: {
              organizationId: ctx.organizationId,
              entity: 'TakeoffItem',
              entityId: existing.id,
              field: 'qtyFinal',
              aiValue: existing.qtyAi === null ? null : existing.qtyAi.toString(),
              humanValue: parsed.data.qtyFinal === null ? null : String(parsed.data.qtyFinal),
              reason: 'Inline edit from review table',
              userId: ctx.user.id,
            },
          }),
        )
      }
      // S9-3 Correction row for finish_code so the data-quality flow can
      // see what the colour mapper got wrong and feed it back into the
      // tuning loop.
      if (finishChanged) {
        writes.push(
          db.correction.create({
            data: {
              organizationId: ctx.organizationId,
              entity: 'TakeoffItem',
              entityId: existing.id,
              field: 'finish_code',
              aiValue: currentFinish,
              humanValue: parsed.data.finishCode ?? null,
              reason: 'Per-room finish dropdown',
              userId: ctx.user.id,
            },
          }),
        )
      }
      const [updated] = await db.$transaction(writes)
      return jsonResponse(
        takeoffDto(updated as Parameters<typeof takeoffDto>[0]),
      )
    }),
  )

  /**
   * GET /api/projects/:id/validation-flags
   *
   * Standalone version for views that don't need the takeoff items themselves.
   * The review table uses the bundled `flagsByItem` from /takeoff-items, so
   * this is mainly for the dashboard "needs review" badge.
   */
  router.get(
    '/api/projects/:id/validation-flags',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      const flags = await db.validationFlag.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
      })
      return jsonResponse(flags.map(flagDto))
    }),
  )
}
