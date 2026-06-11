import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { emptyResponse, errorResponse, jsonResponse } from '../utils/json'

const trimmedNullable = (input: unknown): string | null => {
  if (input == null) return null
  if (typeof input !== 'string') return null
  const t = input.trim()
  return t.length === 0 ? null : t
}

/**
 * POST /api/material-supplier-prices is the heart of Phase 8B — every call
 * upserts the live link AND writes a new PriceSnapshot in the same
 * transaction so price history can never be overwritten.
 */

const setPriceBody = z.object({
  materialId: z.string().min(1),
  supplierId: z.string().min(1),
  unitPrice: z.number().positive().finite(),
  currency: z.string().length(3).optional(),
  minimumOrderQuantity: z.number().nonnegative().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  effectiveDate: z.string().datetime().optional(),
  isPreferred: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})

const patchLinkBody = z.object({
  minimumOrderQuantity: z.number().nonnegative().nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  isPreferred: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})

interface PriceLinkRow {
  id: string
  organizationId: string
  materialId: string
  supplierId: string
  unitPrice: number
  currency: string
  minimumOrderQuantity: number | null
  leadTimeDays: number | null
  effectiveDate: Date
  isPreferred: boolean
  notes: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

function priceLink(row: PriceLinkRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    materialId: row.materialId,
    supplierId: row.supplierId,
    unitPrice: row.unitPrice,
    currency: row.currency,
    minimumOrderQuantity: row.minimumOrderQuantity,
    leadTimeDays: row.leadTimeDays,
    effectiveDate: row.effectiveDate.toISOString(),
    isPreferred: row.isPreferred,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

function snapshot(row: {
  id: string
  organizationId: string
  materialId: string
  supplierId: string
  price: number
  currency: string
  effectiveDate: Date
  createdAt: Date
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    materialId: row.materialId,
    supplierId: row.supplierId,
    price: row.price,
    currency: row.currency,
    effectiveDate: row.effectiveDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
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

export function registerPriceRoutes(router: Router): void {
  // ----- LIVE price links ---------------------------------------------------

  router.get(
    '/api/material-supplier-prices',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const materialId = ctx.query.get('materialId')
      const supplierId = ctx.query.get('supplierId')
      const includeDeleted = ctx.query.get('includeDeleted') === 'true'

      const rows = await db.materialSupplierPrice.findMany({
        where: {
          ...(materialId ? { materialId } : {}),
          ...(supplierId ? { supplierId } : {}),
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ isPreferred: 'desc' }, { unitPrice: 'asc' }],
      })
      return jsonResponse(rows.map(priceLink))
    }),
  )

  router.post(
    '/api/material-supplier-prices',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, setPriceBody)
      if (parsed instanceof Response) return parsed
      const db = tenantDb(ctx.organizationId)

      // Resolve org-scoped material + supplier (security boundary). A request
      // is rejected if either references something the caller's org doesn't own.
      const [material, supplier] = await Promise.all([
        db.material.findFirst({
          where: { id: parsed.materialId, deletedAt: null },
          select: { id: true, currency: true },
        }),
        db.supplier.findFirst({
          where: { id: parsed.supplierId, deletedAt: null },
          select: { id: true },
        }),
      ])
      if (!material) return errorResponse(400, 'materialId does not belong to your organization')
      if (!supplier) return errorResponse(400, 'supplierId does not belong to your organization')

      const currency = parsed.currency ?? material.currency
      const effectiveDate = parsed.effectiveDate ? new Date(parsed.effectiveDate) : new Date()

      const writes: Prisma.PrismaPromise<unknown>[] = []

      // Invariant: at most one preferred per (org, material). Clear competing
      // preferred flags in the SAME transaction as the upsert + snapshot.
      if (parsed.isPreferred === true) {
        writes.push(
          db.materialSupplierPrice.updateMany({
            where: {
              materialId: material.id,
              supplierId: { not: supplier.id },
              isPreferred: true,
              deletedAt: null,
            },
            data: { isPreferred: false },
          }),
        )
      }

      // The tenant extension scopes `where` and create-data; for `upsert` we
      // still pass the composite unique selector explicitly because the
      // generated name encodes `organizationId_materialId_supplierId`.
      const upsert = db.materialSupplierPrice.upsert({
        where: {
          organizationId_materialId_supplierId: {
            organizationId: ctx.organizationId,
            materialId: material.id,
            supplierId: supplier.id,
          },
        },
        create: {
          // Compiler-required but extension-overridden — see tenantDb.ts.
          organizationId: ctx.organizationId,
          materialId: material.id,
          supplierId: supplier.id,
          unitPrice: parsed.unitPrice,
          currency,
          minimumOrderQuantity: parsed.minimumOrderQuantity ?? null,
          leadTimeDays: parsed.leadTimeDays ?? null,
          effectiveDate,
          isPreferred: parsed.isPreferred ?? false,
          notes: trimmedNullable(parsed.notes),
        },
        update: {
          unitPrice: parsed.unitPrice,
          currency,
          ...('minimumOrderQuantity' in parsed
            ? { minimumOrderQuantity: parsed.minimumOrderQuantity ?? null }
            : {}),
          ...('leadTimeDays' in parsed ? { leadTimeDays: parsed.leadTimeDays ?? null } : {}),
          effectiveDate,
          ...(parsed.isPreferred !== undefined ? { isPreferred: parsed.isPreferred } : {}),
          ...('notes' in parsed ? { notes: trimmedNullable(parsed.notes) } : {}),
          deletedAt: null,
        },
      })

      const snap = db.priceSnapshot.create({
        data: {
          // Compiler-required but extension-overridden — see tenantDb.ts.
          organizationId: ctx.organizationId,
          materialId: material.id,
          supplierId: supplier.id,
          price: parsed.unitPrice,
          currency,
          effectiveDate,
        },
      })

      writes.push(upsert, snap)
      const results = await db.$transaction(writes)
      const linkRow = results.find(
        (r): r is PriceLinkRow =>
          (r as PriceLinkRow).materialId !== undefined &&
          (r as PriceLinkRow).unitPrice !== undefined,
      )
      if (!linkRow) return errorResponse(500, 'Price upsert failed')
      return jsonResponse(priceLink(linkRow), 201)
    }),
  )

  router.patch(
    '/api/material-supplier-prices/:id',
    requireAuth(async (req, ctx) => {
      const parsed = await readBody(req, patchLinkBody)
      if (parsed instanceof Response) return parsed
      const db = tenantDb(ctx.organizationId)
      const existing = await db.materialSupplierPrice.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      if (!existing) return errorResponse(404, 'Price link not found')

      // Patch ONLY metadata. Price changes have to go through POST so a
      // snapshot is always written.
      const writes: Prisma.PrismaPromise<unknown>[] = []
      if (parsed.isPreferred === true) {
        writes.push(
          db.materialSupplierPrice.updateMany({
            where: {
              materialId: existing.materialId,
              supplierId: { not: existing.supplierId },
              isPreferred: true,
              deletedAt: null,
            },
            data: { isPreferred: false },
          }),
        )
      }
      writes.push(
        db.materialSupplierPrice.update({
          where: { id: existing.id },
          data: {
            ...('minimumOrderQuantity' in parsed
              ? { minimumOrderQuantity: parsed.minimumOrderQuantity ?? null }
              : {}),
            ...('leadTimeDays' in parsed ? { leadTimeDays: parsed.leadTimeDays ?? null } : {}),
            ...(parsed.isPreferred !== undefined ? { isPreferred: parsed.isPreferred } : {}),
            ...('notes' in parsed ? { notes: trimmedNullable(parsed.notes) } : {}),
          },
        }),
      )
      const results = await db.$transaction(writes)
      const last = results[results.length - 1] as PriceLinkRow
      return jsonResponse(priceLink(last))
    }),
  )

  router.del(
    '/api/material-supplier-prices/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const existing = await db.materialSupplierPrice.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      // ADR-011: DELETE matches PATCH — 404 for missing or cross-tenant.
      if (!existing) return errorResponse(404, 'Price link not found')
      await db.materialSupplierPrice.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      })
      return emptyResponse()
    }),
  )

  // ----- Immutable price history --------------------------------------------

  router.get(
    '/api/price-snapshots',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const materialId = ctx.query.get('materialId')
      const supplierId = ctx.query.get('supplierId')
      const sinceParam = ctx.query.get('since')
      const since = sinceParam ? new Date(sinceParam) : null

      const rows = await db.priceSnapshot.findMany({
        where: {
          ...(materialId ? { materialId } : {}),
          ...(supplierId ? { supplierId } : {}),
          ...(since && !Number.isNaN(since.getTime())
            ? { effectiveDate: { gte: since } }
            : {}),
        },
        orderBy: { effectiveDate: 'asc' },
      })
      return jsonResponse(rows.map(snapshot))
    }),
  )
}
