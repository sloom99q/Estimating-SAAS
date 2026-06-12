import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { remapFinishesForProject } from '../jobs/handlers/extractRooms'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

const PATCH_BODY = z
  .object({
    qtyFinal: z
      .union([z.number().finite().nonnegative(), z.null()])
      .optional(),
    status: z.enum(['AI', 'EDITED', 'APPROVED']).optional(),
  })
  .refine(
    (b) => b.qtyFinal !== undefined || b.status !== undefined,
    'At least one of qtyFinal / status is required',
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

      const data: Record<string, unknown> = {}
      if (parsed.data.qtyFinal !== undefined) data.qtyFinal = parsed.data.qtyFinal
      if (parsed.data.status !== undefined) data.status = parsed.data.status
      // Auto-promote AI → EDITED when qty diverges and the caller did not
      // explicitly send a status. Keeps the review table's "needs review"
      // filter (default AI rows) honest.
      if (qtyChanged && parsed.data.status === undefined) data.status = 'EDITED'

      const writes: Prisma.PrismaPromise<unknown>[] = []
      // Sprint-1 tenant extension scopes db.* — use the same db here.
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
