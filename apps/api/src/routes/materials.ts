import { z } from 'zod'
import { prisma } from '../db'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { emptyResponse, errorResponse, jsonResponse } from '../utils/json'

const CATEGORIES = [
  'tiles',
  'marble',
  'paint',
  'gypsum',
  'glue',
  'grout',
  'cladding',
  'other',
] as const
const UNITS = ['m2', 'kg', 'bag', 'piece'] as const

const trimmedNullable = (input: unknown) => {
  if (input === undefined || input === null) return null
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length === 0 ? null : trimmed
}

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES),
  unit: z.enum(UNITS),
  unitPrice: z.number().positive().finite(),
  coverage: z.number().positive().finite(),
  wastePct: z.number().min(0).max(100).finite(),
  supplier: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  imageUrl: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => v == null || v.length === 0 || /^https?:\/\//i.test(v),
      'imageUrl must be an http(s) URL',
    ),
  active: z.boolean(),
})

const updateBody = createBody.partial()

function material(row: {
  id: string
  organizationId: string
  name: string
  category: string
  unit: string
  unitPrice: number
  coverage: number
  wastePct: number
  currency: string
  supplier: string | null
  notes: string | null
  imageUrl: string | null
  active: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    category: row.category,
    unit: row.unit,
    unitPrice: row.unitPrice,
    coverage: row.coverage,
    wastePct: row.wastePct,
    currency: row.currency,
    supplier: row.supplier,
    notes: row.notes,
    imageUrl: row.imageUrl,
    active: row.active,
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

export function registerMaterialRoutes(router: Router): void {
  router.get(
    '/api/materials',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const includeDeleted = ctx.query.get('includeDeleted') === 'true'
      const rows = await db.material.findMany({
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: { name: 'asc' },
      })
      return jsonResponse(rows.map(material))
    }),
  )

  router.get(
    '/api/materials/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const row = await db.material.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      if (!row) return errorResponse(404, 'Material not found')
      return jsonResponse(material(row))
    }),
  )

  router.post(
    '/api/materials',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, createBody)
      if (parsed instanceof Response) return parsed
      const db = tenantDb(ctx.organizationId)
      // Organization is non-tenant; read it via the raw client.
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { defaultCurrency: true },
      })
      const created = await db.material.create({
        data: {
          // The tenant extension overrides this at runtime, but Prisma's
          // generated types insist on it being present. Same value either way.
          organizationId: ctx.organizationId,
          name: parsed.name,
          category: parsed.category,
          unit: parsed.unit,
          unitPrice: parsed.unitPrice,
          coverage: parsed.coverage,
          wastePct: parsed.wastePct,
          currency: org?.defaultCurrency ?? 'AED',
          supplier: trimmedNullable(parsed.supplier),
          notes: trimmedNullable(parsed.notes),
          imageUrl: trimmedNullable(parsed.imageUrl),
          active: parsed.active,
        },
      })
      return jsonResponse(material(created), 201)
    }),
  )

  router.patch(
    '/api/materials/:id',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, updateBody)
      if (parsed instanceof Response) return parsed
      const db = tenantDb(ctx.organizationId)
      const existing = await db.material.findFirst({ where: { id: ctx.params.id } })
      if (!existing) return errorResponse(404, 'Material not found')

      const updated = await db.material.update({
        where: { id: existing.id },
        data: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.category !== undefined ? { category: parsed.category } : {}),
          ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
          ...(parsed.unitPrice !== undefined ? { unitPrice: parsed.unitPrice } : {}),
          ...(parsed.coverage !== undefined ? { coverage: parsed.coverage } : {}),
          ...(parsed.wastePct !== undefined ? { wastePct: parsed.wastePct } : {}),
          ...('supplier' in parsed ? { supplier: trimmedNullable(parsed.supplier) } : {}),
          ...('notes' in parsed ? { notes: trimmedNullable(parsed.notes) } : {}),
          ...('imageUrl' in parsed ? { imageUrl: trimmedNullable(parsed.imageUrl) } : {}),
          ...(parsed.active !== undefined ? { active: parsed.active } : {}),
        },
      })
      return jsonResponse(material(updated))
    }),
  )

  router.del(
    '/api/materials/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const existing = await db.material.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      // ADR-011: DELETE matches PATCH — 404 for missing or cross-tenant.
      if (!existing) return errorResponse(404, 'Material not found')
      await db.material.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      })
      return emptyResponse()
    }),
  )

  router.post(
    '/api/materials/:id/restore',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const existing = await db.material.findFirst({ where: { id: ctx.params.id } })
      if (!existing) return errorResponse(404, 'Material not found')
      const restored = await db.material.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      })
      return jsonResponse(material(restored))
    }),
  )
}
