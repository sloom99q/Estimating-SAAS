import type { Prisma, TakeoffStatus } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import { renderBoqXlsx, type XlsxBoq } from '../pricing/exportXlsx'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

/**
 * Triple-A section structure for the BOQ. Each TakeoffItem category falls
 * into exactly one section. ROOM is informational only — it goes into
 * General so the BOQ can be cross-referenced against the extracted rooms,
 * but the rooms themselves carry no rate.
 */
interface SectionDef {
  code: string
  title: string
  sortOrder: number
}

const SECTIONS: Record<string, SectionDef> = {
  '1.0': { code: '1.0', title: 'General', sortOrder: 10 },
  '2.5': { code: '2.5', title: 'Metal', sortOrder: 25 },
  '2.6': { code: '2.6', title: 'Wood', sortOrder: 26 },
  '2.8': { code: '2.8', title: 'Doors / Windows / Glazing', sortOrder: 28 },
  '2.9': { code: '2.9', title: 'Finishes', sortOrder: 29 },
  '3.1': { code: '3.1', title: 'External', sortOrder: 31 },
  '4.0': { code: '4.0', title: 'Provisional Sums', sortOrder: 40 },
}

/**
 * Sprint-4 S4-4: ROOM is INTENTIONALLY ABSENT. Rooms are inputs to QUANTIFY,
 * not BOQ line items. The Sprint-3 live run contaminated the BOQ with 154
 * "1.0 General" room-as-line entries that priced as Provisional Sums and
 * confused the export.
 */
const CATEGORY_TO_SECTION: Record<string, string> = {
  OTHER: '1.0',
  METAL: '2.5',
  GRC: '2.5',
  JOINERY: '2.6',
  DOOR: '2.8',
  WINDOW: '2.8',
  FLOOR_FINISH: '2.9',
  WALL_FINISH: '2.9',
  CEILING: '2.9',
  SCREED: '2.9',
  PAINT: '2.9',
  PLASTER: '2.9',
  BLOCKWORK: '2.9',
  WATERPROOFING: '2.9',
  SANITARY: '2.9',
  EXTERNAL: '3.1',
  STRUCTURE_PROV: '4.0',
  MEP_PROV: '4.0',
}

/** Categories explicitly excluded from BOQ generation. */
const NEVER_BOQ = new Set(['ROOM'])

const generateBody = z
  .object({
    onlyApproved: z.boolean().optional(),
  })
  .optional()

function boqDto(row: {
  id: string
  organizationId: string
  projectId: string
  version: number
  status: string
  currency: string
  subtotal: Prisma.Decimal | null
  totalProvisional: Prisma.Decimal | null
  createdAt: Date
  updatedAt: Date
  sections: Array<{
    id: string
    code: string
    title: string
    sortOrder: number
    subtotal: Prisma.Decimal | null
    lines: Array<{
      id: string
      itemRef: string
      description: string
      unit: string
      qty: Prisma.Decimal | null
      rate: Prisma.Decimal | null
      rateSource: string | null
      amount: Prisma.Decimal | null
      isProvisional: boolean
      psAmount: Prisma.Decimal | null
      confidence: number | null
      takeoffItemId: string | null
      assemblyId: string | null
      sortOrder: number
    }>
  }>
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    version: row.version,
    status: row.status,
    currency: row.currency,
    subtotal: row.subtotal === null ? null : row.subtotal.toString(),
    totalProvisional: row.totalProvisional === null ? null : row.totalProvisional.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sections: row.sections.map((s) => ({
      id: s.id,
      code: s.code,
      title: s.title,
      sortOrder: s.sortOrder,
      subtotal: s.subtotal === null ? null : s.subtotal.toString(),
      lines: s.lines.map((l) => ({
        id: l.id,
        itemRef: l.itemRef,
        description: l.description,
        unit: l.unit,
        qty: l.qty === null ? null : l.qty.toString(),
        rate: l.rate === null ? null : l.rate.toString(),
        rateSource: l.rateSource,
        amount: l.amount === null ? null : l.amount.toString(),
        isProvisional: l.isProvisional,
        psAmount: l.psAmount === null ? null : l.psAmount.toString(),
        confidence: l.confidence,
        takeoffItemId: l.takeoffItemId,
        assemblyId: l.assemblyId,
        sortOrder: l.sortOrder,
      })),
    })),
  }
}

export function registerBoqRoutes(router: Router): void {
  /**
   * POST /api/projects/:id/boq
   *
   * Generate a new DRAFT Boq for the project. Default is to include only
   * APPROVED + EDITED TakeoffItems (the architect's brief). Pass
   * `{ onlyApproved: false }` in stub-mode dev to include AI-status items too.
   * Always creates a new version — existing BOQs are kept for history.
   */
  router.post(
    '/api/projects/:id/boq',
    requireAuth(async (req, ctx) => {
      const projectId = ctx.params.id
      let raw: unknown = null
      try {
        raw = await req.json()
      } catch {
        // body is optional; ignore parse errors here
      }
      const parsed = generateBody.safeParse(raw ?? {})
      if (!parsed.success) return errorResponse(400, 'Invalid payload', parsed.error.format())
      const onlyApproved = parsed.data?.onlyApproved ?? true

      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      const statusFilter: { status?: { in: TakeoffStatus[] } } = onlyApproved
        ? { status: { in: ['APPROVED', 'EDITED'] as TakeoffStatus[] } }
        : {}

      const items = await db.takeoffItem.findMany({
        where: { projectId, deletedAt: null, ...statusFilter },
        orderBy: [{ category: 'asc' }, { tag: 'asc' }, { createdAt: 'asc' }],
      })

      if (items.length === 0) {
        return errorResponse(
          400,
          onlyApproved
            ? 'No APPROVED or EDITED takeoff items for this project. Approve some first or set onlyApproved=false.'
            : 'No takeoff items to BOQ.',
        )
      }

      // Group by section. S4-4: skip the categories in NEVER_BOQ (today only
      // ROOM) — they're QUANTIFY inputs, not bill items.
      // Sprint-6: also skip items with meta.kind='LEGEND'. Those are MATERIAL
      // DEFINITIONS that the EXTRACT_FINISH_LEGEND stage planted as
      // reference rows; they have null qty and would pollute the BOQ.
      const sectionBuckets = new Map<string, typeof items>()
      let skippedRoomItems = 0
      let skippedLegendItems = 0
      for (const item of items) {
        if (NEVER_BOQ.has(item.category)) {
          skippedRoomItems += 1
          continue
        }
        const meta = (item.meta ?? {}) as Record<string, unknown>
        if (meta.kind === 'LEGEND') {
          skippedLegendItems += 1
          continue
        }
        const sectionCode = CATEGORY_TO_SECTION[item.category] ?? '1.0'
        const bucket = sectionBuckets.get(sectionCode)
        if (bucket) bucket.push(item)
        else sectionBuckets.set(sectionCode, [item])
      }
      if (sectionBuckets.size === 0) {
        return errorResponse(
          400,
          skippedRoomItems > 0
            ? `Only ROOM items present (${skippedRoomItems}); run QUANTIFY first to derive billable items.`
            : 'No billable takeoff items.',
        )
      }

      // Next version for this project.
      const latest = await db.boq.findFirst({
        where: { projectId, deletedAt: null },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      const boqId = await db.$transaction(async (tx) => {
        const boq = await tx.boq.create({
          data: {
            organizationId: ctx.organizationId,
            projectId,
            version: nextVersion,
            status: 'DRAFT',
            currency: 'AED',
          },
        })

        for (const [sectionCode, sectionItems] of sectionBuckets) {
          const def = SECTIONS[sectionCode]
          if (!def) continue
          const section = await tx.boqSection.create({
            data: {
              organizationId: ctx.organizationId,
              boqId: boq.id,
              code: def.code,
              title: def.title,
              sortOrder: def.sortOrder,
            },
          })
          await tx.boqLine.createMany({
            data: sectionItems.map((item, i) => ({
              organizationId: ctx.organizationId,
              boqId: boq.id,
              sectionId: section.id,
              itemRef: `${def.code}/${(i + 1).toString().padStart(3, '0')}`,
              description: item.description,
              unit: item.unit,
              qty: item.qtyFinal ?? item.qtyAi ?? 0,
              isProvisional: item.category === 'STRUCTURE_PROV' || item.category === 'MEP_PROV',
              confidence: item.confidence,
              takeoffItemId: item.id,
              sortOrder: i,
            })),
          })
        }
        return boq.id
      })

      const full = await db.boq.findFirstOrThrow({
        where: { id: boqId },
        include: {
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      return jsonResponse(boqDto(full), 201)
    }),
  )

  router.get(
    '/api/projects/:id/boq',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const versionParam = ctx.query.get('version')
      const where: { projectId: string; deletedAt: null; version?: number } = {
        projectId: ctx.params.id,
        deletedAt: null,
      }
      if (versionParam) where.version = Number.parseInt(versionParam, 10)
      const boq = await db.boq.findFirst({
        where,
        orderBy: { version: 'desc' },
        include: {
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      return jsonResponse(boqDto(boq))
    }),
  )

  router.get(
    '/api/boqs/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        include: {
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      return jsonResponse(boqDto(boq))
    }),
  )

  /** Enqueue a PRICE job for the BOQ. Returns 202 + jobId. */
  router.post(
    '/api/boqs/:id/price',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true, projectId: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const job = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: boq.projectId,
          type: 'PRICE',
          payload: { boqId: boq.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
    }),
  )

  /**
   * Inline XLSX export. Renders + writes to the BlobStore + returns the bytes
   * in one response. `?internal=1` enables the CONFIDENCE + SOURCE columns.
   * For larger BOQs the EXPORT_XLSX job exists (handlers/exportXlsx.ts) and
   * follows the same render path; this route is the fast-path for Sprint 3.
   */
  router.get(
    '/api/boqs/:id/export.xlsx',
    requireAuth(async (_req, ctx) => {
      const includeInternal = ctx.query.get('internal') === '1'
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        include: {
          project: { select: { name: true } },
          sections: {
            include: { lines: { orderBy: { sortOrder: 'asc' } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')

      const xlsxModel: XlsxBoq = {
        projectName: boq.project.name,
        version: boq.version,
        currency: boq.currency,
        subtotal: boq.subtotal === null ? null : boq.subtotal.toString(),
        totalProvisional:
          boq.totalProvisional === null ? null : boq.totalProvisional.toString(),
        sections: boq.sections.map((s) => ({
          code: s.code,
          title: s.title,
          subtotal: s.subtotal === null ? null : s.subtotal.toString(),
          lines: s.lines.map((l) => ({
            itemRef: l.itemRef,
            description: l.description,
            unit: l.unit,
            qty: l.qty === null ? null : l.qty.toString(),
            rate: l.rate === null ? null : l.rate.toString(),
            rateSource: l.rateSource,
            amount: l.amount === null ? null : l.amount.toString(),
            isProvisional: l.isProvisional,
            psAmount: l.psAmount === null ? null : l.psAmount.toString(),
            confidence: l.confidence,
          })),
        })),
      }
      const buffer = await renderBoqXlsx(xlsxModel, { includeInternal })
      const filename = `boq-${boq.project.name.replace(/[^a-zA-Z0-9]+/g, '_')}-v${boq.version}${includeInternal ? '-internal' : ''}.xlsx`
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Access-Control-Allow-Origin': '*',
        },
      })
    }),
  )

  /** Enqueue a QUANTIFY job. Stops short of automatic chain — user-triggered. */
  router.post(
    '/api/projects/:id/quantify',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const job = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: project.id,
          type: 'QUANTIFY',
          payload: { projectId: project.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
    }),
  )
}
