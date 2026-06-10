import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { emptyResponse, errorResponse, jsonResponse } from '../utils/json'

const dim = z.number().positive().finite()
const maxHorizontal = 200
const maxHeight = 20

const createBody = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1),
  length: dim.max(maxHorizontal),
  width: dim.max(maxHorizontal),
  height: dim.max(maxHeight),
})

const dimensionsUpdate = z.object({
  name: z.string().trim().min(1).optional(),
  length: dim.max(maxHorizontal).optional(),
  width: dim.max(maxHorizontal).optional(),
  height: dim.max(maxHeight).optional(),
})

const materialsUpdate = z.object({
  floorMaterialId: z.string().nullable().optional(),
  wallMaterialId: z.string().nullable().optional(),
  ceilingMaterialId: z.string().nullable().optional(),
})

const updateBody = dimensionsUpdate.merge(materialsUpdate)

function space(row: {
  id: string
  organizationId: string
  projectId: string
  name: string
  length: number
  width: number
  height: number
  floorMaterialId: string | null
  wallMaterialId: string | null
  ceilingMaterialId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    length: row.length,
    width: row.width,
    height: row.height,
    floorMaterialId: row.floorMaterialId,
    wallMaterialId: row.wallMaterialId,
    ceilingMaterialId: row.ceilingMaterialId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

async function readBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<T | Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return errorResponse(400, 'Invalid JSON body')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return errorResponse(400, 'Invalid payload', parsed.error.format())
  return parsed.data
}

export function registerSpaceRoutes(router: Router): void {
  router.get(
    '/api/spaces',
    requireAuth(async (_req, ctx) => {
      const projectId = ctx.query.get('projectId')
      const includeDeleted = ctx.query.get('includeDeleted') === 'true'
      const rows = await prisma.space.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(projectId ? { projectId } : {}),
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: { createdAt: 'asc' },
      })
      return jsonResponse(rows.map(space))
    }),
  )

  router.get(
    '/api/spaces/:id',
    requireAuth(async (_req, ctx) => {
      const row = await prisma.space.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId, deletedAt: null },
      })
      if (!row) return errorResponse(404, 'Space not found')
      return jsonResponse(space(row))
    }),
  )

  router.post(
    '/api/spaces',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, createBody)
      if (parsed instanceof Response) return parsed

      const parent = await prisma.project.findFirst({
        where: {
          id: parsed.projectId,
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
      })
      if (!parent) return errorResponse(400, 'projectId does not belong to your organization')

      const created = await prisma.space.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: parsed.projectId,
          name: parsed.name,
          length: parsed.length,
          width: parsed.width,
          height: parsed.height,
        },
      })
      return jsonResponse(space(created), 201)
    }),
  )

  router.patch(
    '/api/spaces/:id',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, updateBody)
      if (parsed instanceof Response) return parsed

      const existing = await prisma.space.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId },
      })
      if (!existing) return errorResponse(404, 'Space not found')

      // Verify material assignments belong to this org. Null is allowed (clears
      // the assignment), undefined is skipped (no change).
      for (const materialId of [
        parsed.floorMaterialId,
        parsed.wallMaterialId,
        parsed.ceilingMaterialId,
      ]) {
        if (materialId == null) continue
        const found = await prisma.material.findFirst({
          where: { id: materialId, organizationId: ctx.organizationId, deletedAt: null },
        })
        if (!found) return errorResponse(400, `Material ${materialId} not found in this organization`)
      }

      const updated = await prisma.space.update({
        where: { id: existing.id },
        data: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.length !== undefined ? { length: parsed.length } : {}),
          ...(parsed.width !== undefined ? { width: parsed.width } : {}),
          ...(parsed.height !== undefined ? { height: parsed.height } : {}),
          ...('floorMaterialId' in parsed ? { floorMaterialId: parsed.floorMaterialId ?? null } : {}),
          ...('wallMaterialId' in parsed ? { wallMaterialId: parsed.wallMaterialId ?? null } : {}),
          ...('ceilingMaterialId' in parsed
            ? { ceilingMaterialId: parsed.ceilingMaterialId ?? null }
            : {}),
        },
      })
      return jsonResponse(space(updated))
    }),
  )

  router.del(
    '/api/spaces/:id',
    requireAuth(async (_req, ctx) => {
      const existing = await prisma.space.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId, deletedAt: null },
      })
      if (!existing) return emptyResponse()
      await prisma.space.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      })
      return emptyResponse()
    }),
  )

  router.post(
    '/api/spaces/:id/restore',
    requireAuth(async (_req, ctx) => {
      const existing = await prisma.space.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId },
      })
      if (!existing) return errorResponse(404, 'Space not found')
      const restored = await prisma.space.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      })
      return jsonResponse(space(restored))
    }),
  )
}
