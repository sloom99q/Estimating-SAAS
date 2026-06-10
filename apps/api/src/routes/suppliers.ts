import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { emptyResponse, errorResponse, jsonResponse } from '../utils/json'

const trimmedNullable = (input: unknown): string | null => {
  if (input == null) return null
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length === 0 ? null : trimmed
}

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  country: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  preferred: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})

const updateBody = createBody.partial()

interface SupplierRow {
  id: string
  organizationId: string
  name: string
  country: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  paymentTerms: string | null
  leadTimeDays: number | null
  rating: number | null
  preferred: boolean
  notes: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function supplier(row: SupplierRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    country: row.country,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    website: row.website,
    paymentTerms: row.paymentTerms,
    leadTimeDays: row.leadTimeDays,
    rating: row.rating,
    preferred: row.preferred,
    notes: row.notes,
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

export function registerSupplierRoutes(router: Router): void {
  router.get(
    '/api/suppliers',
    requireAuth(async (_req, ctx) => {
      const includeDeleted = ctx.query.get('includeDeleted') === 'true'
      const rows = await prisma.supplier.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ preferred: 'desc' }, { name: 'asc' }],
      })
      return jsonResponse(rows.map(supplier))
    }),
  )

  router.get(
    '/api/suppliers/:id',
    requireAuth(async (_req, ctx) => {
      const row = await prisma.supplier.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId, deletedAt: null },
      })
      if (!row) return errorResponse(404, 'Supplier not found')
      return jsonResponse(supplier(row))
    }),
  )

  router.post(
    '/api/suppliers',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, createBody)
      if (parsed instanceof Response) return parsed
      const created = await prisma.supplier.create({
        data: {
          organizationId: ctx.organizationId,
          name: parsed.name,
          country: trimmedNullable(parsed.country),
          contactName: trimmedNullable(parsed.contactName),
          email: trimmedNullable(parsed.email),
          phone: trimmedNullable(parsed.phone),
          website: trimmedNullable(parsed.website),
          paymentTerms: trimmedNullable(parsed.paymentTerms),
          leadTimeDays: parsed.leadTimeDays ?? null,
          rating: parsed.rating ?? null,
          preferred: parsed.preferred ?? false,
          notes: trimmedNullable(parsed.notes),
        },
      })
      return jsonResponse(supplier(created), 201)
    }),
  )

  router.patch(
    '/api/suppliers/:id',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, updateBody)
      if (parsed instanceof Response) return parsed
      const existing = await prisma.supplier.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId },
      })
      if (!existing) return errorResponse(404, 'Supplier not found')

      const updated = await prisma.supplier.update({
        where: { id: existing.id },
        data: {
          ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
          ...('country' in parsed ? { country: trimmedNullable(parsed.country) } : {}),
          ...('contactName' in parsed
            ? { contactName: trimmedNullable(parsed.contactName) }
            : {}),
          ...('email' in parsed ? { email: trimmedNullable(parsed.email) } : {}),
          ...('phone' in parsed ? { phone: trimmedNullable(parsed.phone) } : {}),
          ...('website' in parsed ? { website: trimmedNullable(parsed.website) } : {}),
          ...('paymentTerms' in parsed
            ? { paymentTerms: trimmedNullable(parsed.paymentTerms) }
            : {}),
          ...('leadTimeDays' in parsed ? { leadTimeDays: parsed.leadTimeDays ?? null } : {}),
          ...('rating' in parsed ? { rating: parsed.rating ?? null } : {}),
          ...(parsed.preferred !== undefined ? { preferred: parsed.preferred } : {}),
          ...('notes' in parsed ? { notes: trimmedNullable(parsed.notes) } : {}),
        },
      })
      return jsonResponse(supplier(updated))
    }),
  )

  router.del(
    '/api/suppliers/:id',
    requireAuth(async (_req, ctx) => {
      const existing = await prisma.supplier.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId, deletedAt: null },
      })
      if (!existing) return emptyResponse()
      const now = new Date()
      // Cascade: soft-delete every (material, supplier) link this supplier
      // owns. PriceSnapshots stay (immutable history) — they are NEVER deleted.
      await prisma.$transaction([
        prisma.supplier.update({ where: { id: existing.id }, data: { deletedAt: now } }),
        prisma.materialSupplierPrice.updateMany({
          where: { supplierId: existing.id, deletedAt: null },
          data: { deletedAt: now },
        }),
      ])
      return emptyResponse()
    }),
  )

  router.post(
    '/api/suppliers/:id/restore',
    requireAuth(async (_req, ctx) => {
      const existing = await prisma.supplier.findFirst({
        where: { id: ctx.params.id, organizationId: ctx.organizationId },
      })
      if (!existing) return errorResponse(404, 'Supplier not found')
      const restored = await prisma.supplier.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      })
      return jsonResponse(supplier(restored))
    }),
  )
}
