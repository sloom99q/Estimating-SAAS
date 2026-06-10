import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { emptyResponse, errorResponse, jsonResponse } from '../utils/json'

const PROJECT_TYPES = ['residential', 'commercial', 'luxury'] as const
const PROJECT_STATUSES = ['lead', 'active', 'on_hold', 'completed', 'cancelled'] as const

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  clientName: z.string().trim().min(1),
  location: z.string().trim().min(1),
  type: z.enum(PROJECT_TYPES),
  status: z.enum(PROJECT_STATUSES),
})

const updateBody = createBody.partial()

/** Public projection — server controls the wire shape. */
function project(row: {
  id: string
  organizationId: string
  name: string
  clientName: string
  location: string
  type: string
  status: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    clientName: row.clientName,
    location: row.location,
    type: row.type,
    status: row.status,
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
  if (!parsed.success) {
    return errorResponse(400, 'Invalid payload', parsed.error.format())
  }
  return parsed.data
}

export function registerProjectRoutes(router: Router): void {
  router.get(
    '/api/projects',
    requireAuth(async (_req, ctx) => {
      const includeDeleted = ctx.query.get('includeDeleted') === 'true'
      const rows = await prisma.project.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: { createdAt: 'desc' },
      })
      return jsonResponse(rows.map(project))
    }),
  )

  router.get(
    '/api/projects/:id',
    requireAuth(async (_req, ctx) => {
      const row = await prisma.project.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId, deletedAt: null },
      })
      if (!row) return errorResponse(404, 'Project not found')
      return jsonResponse(project(row))
    }),
  )

  router.post(
    '/api/projects',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, createBody)
      if (parsed instanceof Response) return parsed
      const created = await prisma.project.create({
        data: {
          organizationId: ctx.organizationId,
          name: parsed.name,
          clientName: parsed.clientName,
          location: parsed.location,
          type: parsed.type,
          status: parsed.status,
        },
      })
      return jsonResponse(project(created), 201)
    }),
  )

  router.patch(
    '/api/projects/:id',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, updateBody)
      if (parsed instanceof Response) return parsed

      const existing = await prisma.project.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId },
      })
      if (!existing) return errorResponse(404, 'Project not found')

      const updated = await prisma.project.update({
        where: { id: existing.id },
        data: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.clientName !== undefined ? { clientName: parsed.clientName } : {}),
          ...(parsed.location !== undefined ? { location: parsed.location } : {}),
          ...(parsed.type !== undefined ? { type: parsed.type } : {}),
          ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        },
      })
      return jsonResponse(project(updated))
    }),
  )

  router.del(
    '/api/projects/:id',
    requireAuth(async (_req, ctx) => {
      const existing = await prisma.project.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId, deletedAt: null },
      })
      if (!existing) return emptyResponse()
      const now = new Date()
      await prisma.$transaction([
        prisma.project.update({
          where: { id: existing.id },
          data: { deletedAt: now },
        }),
        prisma.space.updateMany({
          where: { projectId: existing.id, deletedAt: null },
          data: { deletedAt: now },
        }),
      ])
      return emptyResponse()
    }),
  )

  router.post(
    '/api/projects/:id/restore',
    requireAuth(async (_req, ctx) => {
      const existing = await prisma.project.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId },
      })
      if (!existing) return errorResponse(404, 'Project not found')
      const restored = await prisma.project.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      })
      return jsonResponse(project(restored))
    }),
  )
}
