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

      // PIVOT — meta.finish_code is the HUMAN-CONFIRMED code (the only
      // thing PRICE reads). meta.finishSuggestion is what the AI proposed
      // (color-sample or vision-extract). The Correction's aiValue is the
      // suggestion so the data-quality flow sees what the AI got wrong
      // even though finish_code was never auto-populated.
      const existingMeta = (existing.meta ?? {}) as Record<string, unknown>
      const currentFinish =
        typeof existingMeta.finish_code === 'string' ? existingMeta.finish_code : null
      const suggestion = existingMeta.finishSuggestion as
        | { code?: string | null }
        | null
        | undefined
      const suggestedCode = suggestion?.code ?? null
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

      if (finishChanged) {
        const nextFinish = parsed.data.finishCode ?? null
        data.meta = {
          ...existingMeta,
          finish_code: nextFinish,
          finishSource: nextFinish === null ? 'cleared-by-reviewer' : 'human-confirmed',
          finishConfirmedAt: nextFinish === null ? null : new Date().toISOString(),
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
      // PIVOT — the Correction captures the AI's suggestion vs the
      // human's confirmed code. aiValue is meta.finishSuggestion.code
      // (color-sample or vision-extract). humanValue is what the
      // reviewer picked. Identical values (Accept-as-is) still produce
      // a row so the audit trail shows the explicit confirmation.
      if (finishChanged) {
        writes.push(
          db.correction.create({
            data: {
              organizationId: ctx.organizationId,
              entity: 'TakeoffItem',
              entityId: existing.id,
              field: 'finish_code',
              aiValue: suggestedCode,
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
   * POST /api/projects/:id/finishes/accept-suggestions
   *
   * PIVOT: bulk-confirm AI suggested finish codes. For each ROOM in the
   * project that has meta.finishSuggestion.code AND meta.finish_code is
   * still null, set finish_code = suggestion.code, stamp
   * meta.finishSource='human-confirmed', and write a Correction row
   * (aiValue=suggestion, humanValue=suggestion — explicit acceptance
   * counts as a confirmation event for the audit trail).
   *
   * Body (optional): { roomIds: string[] }  → restrict to these rooms.
   *                  { onlyFloorFinishCodes: true }  → skip suggestions
   *                    outside the floor vocab (ST/PR/BATHROOM). Default
   *                    true; bulk-accept never assigns wall codes.
   *
   * Returns the per-room accepted/skipped breakdown so the SPA can
   * render "Accepted 18 of 22 (4 had no suggestion)".
   */
  router.post(
    '/api/projects/:id/finishes/accept-suggestions',
    requireAuth(async (req, ctx) => {
      const projectId = ctx.params.id
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      const body = (await req.json().catch(() => ({}))) as {
        roomIds?: string[]
        onlyFloorFinishCodes?: boolean
      }
      const onlyFloor = body.onlyFloorFinishCodes !== false
      const FLOOR_VOCAB = new Set(['ST01', 'ST02', 'ST03', 'PR01', 'PR03', 'BATHROOM'])

      const rooms = await db.takeoffItem.findMany({
        where: {
          projectId,
          category: 'ROOM',
          deletedAt: null,
          ...(body.roomIds && body.roomIds.length > 0 ? { id: { in: body.roomIds } } : {}),
        },
      })

      const accepted: Array<{ id: string; code: string }> = []
      const skipped: Array<{ id: string; reason: string }> = []
      const now = new Date().toISOString()

      const writes: Prisma.PrismaPromise<unknown>[] = []
      for (const room of rooms) {
        const meta = (room.meta ?? {}) as Record<string, unknown>
        const existingFinish =
          typeof meta.finish_code === 'string' ? meta.finish_code : null
        if (existingFinish) {
          skipped.push({ id: room.id, reason: 'already-confirmed' })
          continue
        }
        const sugg = meta.finishSuggestion as { code?: string | null } | null | undefined
        const code = sugg?.code ?? null
        if (!code) {
          skipped.push({ id: room.id, reason: 'no-suggestion' })
          continue
        }
        if (onlyFloor && !FLOOR_VOCAB.has(code)) {
          skipped.push({ id: room.id, reason: `non-floor-code:${code}` })
          continue
        }
        accepted.push({ id: room.id, code })
        writes.push(
          db.takeoffItem.update({
            where: { id: room.id },
            data: {
              status: 'EDITED',
              meta: {
                ...meta,
                finish_code: code,
                finishSource: 'human-confirmed',
                finishConfirmedAt: now,
                finishConfirmedVia: 'bulk-accept-suggestions',
              } as Prisma.JsonObject,
            },
          }),
        )
        writes.push(
          db.correction.create({
            data: {
              organizationId: ctx.organizationId,
              entity: 'TakeoffItem',
              entityId: room.id,
              field: 'finish_code',
              aiValue: code,
              humanValue: code,
              reason: 'Bulk accept-suggestions',
              userId: ctx.user.id,
            },
          }),
        )
      }
      if (writes.length > 0) await db.$transaction(writes)
      return jsonResponse({
        ok: true,
        roomsScanned: rooms.length,
        accepted: accepted.length,
        skipped: skipped.length,
        acceptedDetails: accepted,
        skippedDetails: skipped,
      })
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
