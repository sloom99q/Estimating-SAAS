import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import { computeAssemblyUnitCost } from '../pricing/assemblyEngine'
import type { Router } from './router'
import { emptyResponse, errorResponse, jsonResponse } from '../utils/json'

const componentKind = z.enum(['MATERIAL', 'LABOR', 'TOOL_FIXED'])

const componentSchema = z.object({
  kind: componentKind,
  label: z.string().min(1).max(200),
  unitPrice: z.union([z.number().nonnegative(), z.null()]).optional(),
  coverage: z.union([z.number().positive(), z.null()]).optional(),
  coats: z.number().int().positive().optional(),
  wastagePct: z.number().min(0).max(100).optional(),
  fixedCost: z.union([z.number().nonnegative(), z.null()]).optional(),
  materialId: z.string().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})

const createBody = z.object({
  name: z.string().min(1).max(160),
  appliesTo: z.enum(['WALL', 'FLOOR', 'CEILING', 'GENERIC']),
  outputUnit: z.string().min(1).max(8),
  notes: z.string().nullable().optional(),
  components: z.array(componentSchema).min(1),
})

const patchBody = z.object({
  name: z.string().min(1).max(160).optional(),
  appliesTo: z.enum(['WALL', 'FLOOR', 'CEILING', 'GENERIC']).optional(),
  outputUnit: z.string().min(1).max(8).optional(),
  notes: z.string().nullable().optional(),
  components: z.array(componentSchema).optional(),
})

function componentDto(row: {
  id: string
  assemblyId: string
  kind: string
  label: string
  unitPrice: Prisma.Decimal | null
  coverage: Prisma.Decimal | null
  coats: number
  wastagePct: Prisma.Decimal
  fixedCost: Prisma.Decimal | null
  materialId: string | null
  sortOrder: number
}) {
  return {
    id: row.id,
    assemblyId: row.assemblyId,
    kind: row.kind,
    label: row.label,
    unitPrice: row.unitPrice === null ? null : row.unitPrice.toString(),
    coverage: row.coverage === null ? null : row.coverage.toString(),
    coats: row.coats,
    wastagePct: row.wastagePct.toString(),
    fixedCost: row.fixedCost === null ? null : row.fixedCost.toString(),
    materialId: row.materialId,
    sortOrder: row.sortOrder,
  }
}

function assemblyDto(
  row: {
    id: string
    organizationId: string
    name: string
    appliesTo: string
    outputUnit: string
    notes: string | null
    createdAt: Date
    updatedAt: Date
    components: Parameters<typeof componentDto>[0][]
  },
) {
  const result = computeAssemblyUnitCost(
    row.components.map((c) => ({
      kind: c.kind as 'MATERIAL' | 'LABOR' | 'TOOL_FIXED',
      label: c.label,
      unitPrice: c.unitPrice,
      coverage: c.coverage,
      coats: c.coats,
      wastagePct: c.wastagePct,
      fixedCost: c.fixedCost,
    })),
  )
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    appliesTo: row.appliesTo,
    outputUnit: row.outputUnit,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    components: row.components.map(componentDto),
    /** Snapshot of the catalogue-view unit cost (tools skipped). */
    unitCost: result.unitCost.toString(),
    toolsSkipped: result.toolsSkipped,
  }
}

export function registerAssemblyRoutes(router: Router): void {
  router.get(
    '/api/assemblies',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const rows = await db.assembly.findMany({
        where: { deletedAt: null },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ appliesTo: 'asc' }, { name: 'asc' }],
      })
      return jsonResponse(rows.map(assemblyDto))
    }),
  )

  router.get(
    '/api/assemblies/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const row = await db.assembly.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        include: { components: { orderBy: { sortOrder: 'asc' } } },
      })
      if (!row) return errorResponse(404, 'Assembly not found')
      return jsonResponse(assemblyDto(row))
    }),
  )

  router.post(
    '/api/assemblies',
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
      // Architect ban on nested writes: parent + children in an explicit
      // transaction, scoped by the tenant extension.
      const created = await db.$transaction(async (tx) => {
        const parent = await tx.assembly.create({
          data: {
            organizationId: ctx.organizationId,
            name: parsed.data.name,
            appliesTo: parsed.data.appliesTo,
            outputUnit: parsed.data.outputUnit,
            notes: parsed.data.notes ?? null,
          },
        })
        if (parsed.data.components.length > 0) {
          await tx.assemblyComponent.createMany({
            data: parsed.data.components.map((c, i) => ({
              organizationId: ctx.organizationId,
              assemblyId: parent.id,
              kind: c.kind,
              label: c.label,
              unitPrice: c.unitPrice ?? null,
              coverage: c.coverage ?? null,
              coats: c.coats ?? 1,
              wastagePct: c.wastagePct ?? 0,
              fixedCost: c.fixedCost ?? null,
              materialId: c.materialId ?? null,
              sortOrder: c.sortOrder ?? i,
            })),
          })
        }
        return tx.assembly.findFirstOrThrow({
          where: { id: parent.id },
          include: { components: { orderBy: { sortOrder: 'asc' } } },
        })
      })
      return jsonResponse(assemblyDto(created), 201)
    }),
  )

  router.patch(
    '/api/assemblies/:id',
    requireAuth(async (req, ctx) => {
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const parsed = patchBody.safeParse(raw)
      if (!parsed.success) return errorResponse(400, 'Invalid payload', parsed.error.format())

      const db = tenantDb(ctx.organizationId)
      const existing = await db.assembly.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!existing) return errorResponse(404, 'Assembly not found')

      const updated = await db.$transaction(async (tx) => {
        const data: Record<string, unknown> = {}
        if (parsed.data.name !== undefined) data.name = parsed.data.name
        if (parsed.data.appliesTo !== undefined) data.appliesTo = parsed.data.appliesTo
        if (parsed.data.outputUnit !== undefined) data.outputUnit = parsed.data.outputUnit
        if (parsed.data.notes !== undefined) data.notes = parsed.data.notes
        if (Object.keys(data).length > 0) {
          await tx.assembly.update({ where: { id: existing.id }, data })
        }
        if (parsed.data.components !== undefined) {
          // Replace-all semantics for components: delete then create.
          await tx.assemblyComponent.deleteMany({ where: { assemblyId: existing.id } })
          if (parsed.data.components.length > 0) {
            await tx.assemblyComponent.createMany({
              data: parsed.data.components.map((c, i) => ({
                organizationId: ctx.organizationId,
                assemblyId: existing.id,
                kind: c.kind,
                label: c.label,
                unitPrice: c.unitPrice ?? null,
                coverage: c.coverage ?? null,
                coats: c.coats ?? 1,
                wastagePct: c.wastagePct ?? 0,
                fixedCost: c.fixedCost ?? null,
                materialId: c.materialId ?? null,
                sortOrder: c.sortOrder ?? i,
              })),
            })
          }
        }
        return tx.assembly.findFirstOrThrow({
          where: { id: existing.id },
          include: { components: { orderBy: { sortOrder: 'asc' } } },
        })
      })
      return jsonResponse(assemblyDto(updated))
    }),
  )

  router.del(
    '/api/assemblies/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const existing = await db.assembly.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      // ADR-011: 404 for missing or cross-tenant.
      if (!existing) return errorResponse(404, 'Assembly not found')
      await db.assembly.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      })
      return emptyResponse()
    }),
  )
}
