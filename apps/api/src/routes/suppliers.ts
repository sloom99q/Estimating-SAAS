import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
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
  /** ADR-009 — credit limit in AED, optional. */
  creditLimitAed: z.number().nonnegative().nullable().optional(),
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
  creditLimitAed: unknown
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  // Prisma returns Decimal as a Decimal.js instance with toString().
  if (typeof value === 'object' && 'toString' in (value as object)) {
    const parsed = Number((value as { toString: () => string }).toString())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
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
    creditLimitAed: decimalToNumber(row.creditLimitAed),
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
      const db = tenantDb(ctx.organizationId)
      const includeDeleted = ctx.query.get('includeDeleted') === 'true'
      const rows = await db.supplier.findMany({
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: [{ preferred: 'desc' }, { name: 'asc' }],
      })
      return jsonResponse(rows.map((r) => supplier(r as unknown as SupplierRow)))
    }),
  )

  router.get(
    '/api/suppliers/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const row = await db.supplier.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      if (!row) return errorResponse(404, 'Supplier not found')
      return jsonResponse(supplier(row as unknown as SupplierRow))
    }),
  )

  router.post(
    '/api/suppliers',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, createBody)
      if (parsed instanceof Response) return parsed
      const db = tenantDb(ctx.organizationId)
      const created = await db.supplier.create({
        data: {
          // Compiler-required but extension-overridden — see tenantDb.ts.
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
          creditLimitAed: parsed.creditLimitAed ?? null,
        },
      })
      return jsonResponse(supplier(created as unknown as SupplierRow), 201)
    }),
  )

  router.patch(
    '/api/suppliers/:id',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, updateBody)
      if (parsed instanceof Response) return parsed
      const db = tenantDb(ctx.organizationId)
      const existing = await db.supplier.findFirst({ where: { id: ctx.params.id } })
      if (!existing) return errorResponse(404, 'Supplier not found')

      const updated = await db.supplier.update({
        where: { id: existing.id },
        data: {
          ...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
          ...('country' in parsed ? { country: trimmedNullable(parsed.country) } : {}),
          ...('contactName' in parsed ? { contactName: trimmedNullable(parsed.contactName) } : {}),
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
          ...('creditLimitAed' in parsed
            ? { creditLimitAed: parsed.creditLimitAed ?? null }
            : {}),
        },
      })
      return jsonResponse(supplier(updated as unknown as SupplierRow))
    }),
  )

  router.del(
    '/api/suppliers/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const existing = await db.supplier.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      // ADR-011: DELETE matches PATCH — 404 for missing or cross-tenant.
      if (!existing) return errorResponse(404, 'Supplier not found')
      const now = new Date()
      // Cascade: soft-delete every (material, supplier) link this supplier
      // owns. PriceSnapshots stay (immutable history) — never deleted.
      await db.$transaction([
        db.supplier.update({ where: { id: existing.id }, data: { deletedAt: now } }),
        db.materialSupplierPrice.updateMany({
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
      const db = tenantDb(ctx.organizationId)
      const existing = await db.supplier.findFirst({ where: { id: ctx.params.id } })
      if (!existing) return errorResponse(404, 'Supplier not found')
      const restored = await db.supplier.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      })
      return jsonResponse(supplier(restored as unknown as SupplierRow))
    }),
  )
}
