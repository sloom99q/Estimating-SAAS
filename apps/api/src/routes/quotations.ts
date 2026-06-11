/**
 * Quotation — Sprint 3 (S3-6).
 *
 * Wraps a Boq with commercial fields. Ref shape: `Qo/{YYYYMM}/{serial} Rev-{NN}`.
 * - `serial`  : per-org-per-month auto-increment
 * - `Rev-NN` : starts at 00; increments on PATCH (Sprint 4 will use this; for
 *              now PATCH is not exposed)
 *
 * Total formula:
 *   subtotal       = Σ BoqLine.amount (the PRICE handler already wrote these)
 *   afterDiscount  = subtotal − discount
 *   total          = afterDiscount × (1 + vatPct/100)
 */
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

const createBody = z.object({
  boqId: z.string().min(1),
  clientName: z.string().min(1).max(160),
  discount: z.number().nonnegative().optional(),
  vatPct: z.number().min(0).max(50).optional(),
  validityDays: z.number().int().positive().max(365).optional(),
})

function quotationDto(row: {
  id: string
  organizationId: string
  projectId: string
  boqId: string
  ref: string
  clientName: string
  discount: Prisma.Decimal
  vatPct: Prisma.Decimal
  subtotal: Prisma.Decimal | null
  total: Prisma.Decimal | null
  validityDays: number
  status: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    boqId: row.boqId,
    ref: row.ref,
    clientName: row.clientName,
    discount: row.discount.toString(),
    vatPct: row.vatPct.toString(),
    subtotal: row.subtotal === null ? null : row.subtotal.toString(),
    total: row.total === null ? null : row.total.toString(),
    validityDays: row.validityDays,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Per-org-per-month next serial number. Returns 1, 2, 3, …
 *
 * The `client` is already tenant-scoped (the count below auto-injects
 * organizationId), so we don't need it explicitly here.
 */
async function nextSerial(
  client: ReturnType<typeof tenantDb>,
  yyyymm: string,
): Promise<number> {
  // Count quotations in this org whose ref starts with the Qo/{yyyymm}/ prefix.
  const prefix = `Qo/${yyyymm}/`
  const count = await client.quotation.count({
    where: { ref: { startsWith: prefix } },
  })
  return count + 1
}

export function registerQuotationRoutes(router: Router): void {
  router.post(
    '/api/projects/:id/quotations',
    requireAuth(async (req, ctx) => {
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const parsed = createBody.safeParse(raw)
      if (!parsed.success) return errorResponse(400, 'Invalid payload', parsed.error.format())

      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      const boq = await db.boq.findFirst({
        where: { id: parsed.data.boqId, projectId: project.id, deletedAt: null },
        select: { id: true, subtotal: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')

      const subtotal = boq.subtotal ?? new Prisma.Decimal(0)
      const discount = new Prisma.Decimal(parsed.data.discount ?? 0)
      const vatPct = new Prisma.Decimal(parsed.data.vatPct ?? 5)
      const afterDiscount = subtotal.minus(discount)
      const total = afterDiscount.times(vatPct.dividedBy(100).plus(1))

      const now = new Date()
      const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
      const serial = await nextSerial(db, yyyymm)
      const ref = `Qo/${yyyymm}/${serial} Rev-00`

      const created = await db.quotation.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: project.id,
          boqId: boq.id,
          ref,
          clientName: parsed.data.clientName,
          discount,
          vatPct,
          subtotal,
          total,
          validityDays: parsed.data.validityDays ?? 30,
        },
      })
      return jsonResponse(quotationDto(created), 201)
    }),
  )

  router.get(
    '/api/projects/:id/quotations',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const rows = await db.quotation.findMany({
        where: { projectId: project.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      })
      return jsonResponse(rows.map(quotationDto))
    }),
  )

  router.get(
    '/api/quotations/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const row = await db.quotation.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      if (!row) return errorResponse(404, 'Quotation not found')
      return jsonResponse(quotationDto(row))
    }),
  )
}
