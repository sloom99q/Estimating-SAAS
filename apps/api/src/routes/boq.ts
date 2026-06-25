import type { Prisma, TakeoffStatus } from '@prisma/client'
import { z } from 'zod'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import { renderBoqXlsx, type XlsxBoq } from '../pricing/exportXlsx'
import { upsertValidationFlag } from '../jobs/validationFlagUpsert'
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
  /** AI-est roadmap #1 — skirting is finishes work. */
  SKIRTING: '2.9',
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

      // S7-1 + PB-1: BOQ generation refuses with an ERROR ValidationFlag if
      // duplicate (category, tag) pairs exist in the takeoff. PB-1 adds
      // structured `details` to the 409 so the SPA can render a friendly
      // explanation and link the user to the offending rows — raw
      // "status 409" was the trust leak the gate walkthrough surfaced.
      const seenIds = new Map<string, string[]>()
      for (const item of items) {
        if (!item.tag) continue
        const key = `${item.category}:${item.tag}`
        const list = seenIds.get(key) ?? []
        list.push(item.id)
        seenIds.set(key, list)
      }
      const dupGroups = Array.from(seenIds.entries())
        .filter(([, ids]) => ids.length > 1)
        .map(([key, ids]) => {
          const [category, tag] = key.split(':') as [string, string]
          return { category, tag, count: ids.length, takeoffItemIds: ids }
        })
      if (dupGroups.length > 0) {
        const summary = dupGroups
          .slice(0, 8)
          .map((d) => `${d.category}:${d.tag} (${d.count})`)
        await upsertValidationFlag({
          client: db,
          organizationId: ctx.organizationId,
          projectId,
          rule: 'DUPLICATE_TAG_IN_TAKEOFF',
          severity: 'ERROR',
          message: `BOQ generation refused: ${dupGroups.length} (category, tag) collision(s) in the takeoff: ${summary.join(', ')}${dupGroups.length > 8 ? `, ...(+${dupGroups.length - 8})` : ''}. Dedupe before generating.`,
        })
        return errorResponse(
          409,
          'Duplicate takeoff rows detected — resolve before generating.',
          {
            kind: 'duplicate_takeoff_rows',
            dupGroups,
            totalGroups: dupGroups.length,
          },
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

      // Roadmap #5 — Section 4.0 Provisional Sums always present, even
      // empty, so the SPA's "Add provisional line" button has a section
      // to write into. The estimator carries windows / lighting /
      // cladding / facade / MEP here (architect-side line items the
      // drawing doesn't measure). Empty section is harmless: it renders
      // with zero lines until the user adds something.
      if (!sectionBuckets.has('4.0')) {
        sectionBuckets.set('4.0', [] as typeof items)
      }

      // Next version for this project.
      const latest = await db.boq.findFirst({
        where: { projectId, deletedAt: null },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      // P/S PERSISTENCE (2026-06-24) — manual P/S lines the estimator
      // typed in via AddProvisionalLineCard live on the PRIOR BOQ as
      // BoqLines with `takeoffItemId IS NULL` (the generator below
      // only creates lines where takeoffItemId points back at a
      // TakeoffItem). Without carry-forward, every regenerate creates
      // a fresh empty BOQ and the estimator's ~1.8M of P/S (windows
      // 300k, lighting 70k, cladding 120k, facade 100k, MEP 300k,
      // sanitary 200k, …) silently disappears. Fix: fetch prior
      // manual lines + re-insert into matching new-BOQ sections.
      //
      // Deletion semantics correct by construction: deleting a P/S
      // line on the prior BOQ hard-deletes it (#128); on the next
      // regenerate it's no longer in the prior set, so it doesn't
      // come back.
      const priorManualLines = latest
        ? await db.boqLine.findMany({
            where: { boqId: latest.id, takeoffItemId: null },
            include: { section: { select: { code: true } } },
            orderBy: { sortOrder: 'asc' },
          })
        : []

      // BOQ-500 fix (2026-06-25) — the carry-forward loop used to
      // do sequential per-line tx.boqLine.create + tx.boqLine.count
      // calls inside the transaction. Over Neon's ~50ms round-trip,
      // with a Lami-sized P/S list (~20+ lines), the interactive
      // transaction blew past Prisma's default 5s timeout and threw
      // P2028 "Transaction not found" — surfacing in the SPA as
      // a 500. Two changes:
      //   1. Pre-compute itemRefs + sortOrders in-memory, then ONE
      //      createMany per section (no per-line round-trips).
      //   2. Bump the transaction timeout to 60s + maxWait to 10s,
      //      a comfortable headroom for very large BOQs.
      const boqId = await db.$transaction(
        async (tx) => {
          const boq = await tx.boq.create({
            data: {
              organizationId: ctx.organizationId,
              projectId,
              version: nextVersion,
              status: 'DRAFT',
              currency: 'AED',
            },
          })

          const sectionsByCode = new Map<string, string>()
          // Track how many lines each section already has so the
          // carry-forward pass can extend the itemRef numbering
          // without a per-line tx.boqLine.count round-trip.
          const sectionLineCount = new Map<string, number>()

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
            sectionsByCode.set(def.code, section.id)
            sectionLineCount.set(def.code, sectionItems.length)
            await tx.boqLine.createMany({
              data: sectionItems.map((item, i) => ({
                organizationId: ctx.organizationId,
                boqId: boq.id,
                sectionId: section.id,
                itemRef: `${def.code}/${(i + 1).toString().padStart(3, '0')}`,
                description: item.description,
                unit: item.unit,
                qty: item.qtyFinal ?? item.qtyAi ?? 0,
                isProvisional:
                  item.category === 'STRUCTURE_PROV' || item.category === 'MEP_PROV',
                confidence: item.confidence,
                takeoffItemId: item.id,
                sortOrder: i,
              })),
            })
          }

          // Carry forward manual P/S. A prior section we don't have
          // in the new BOQ (rare — categories changed) gets created
          // on demand so we don't drop the line.
          if (priorManualLines.length > 0) {
            // Group by section code so itemRef numbering continues
            // after the auto-generated lines.
            const linesBySection = new Map<string, typeof priorManualLines>()
            for (const l of priorManualLines) {
              const code = l.section.code
              if (!linesBySection.has(code)) linesBySection.set(code, [])
              linesBySection.get(code)!.push(l)
            }

            let carriedTotal = 0
            let carriedProvisional = 0

            for (const [sectionCode, lines] of linesBySection) {
              let sectionId = sectionsByCode.get(sectionCode)
              if (!sectionId) {
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
                sectionsByCode.set(def.code, section.id)
                sectionLineCount.set(def.code, 0)
                sectionId = section.id
              }
              const existingCount = sectionLineCount.get(sectionCode) ?? 0
              // BATCH the insert — single round-trip per section.
              await tx.boqLine.createMany({
                data: lines.map((l, i) => {
                  const refIndex = existingCount + i + 1
                  const amount = l.amount ? Number(l.amount.toString()) : 0
                  const ps = l.psAmount ? Number(l.psAmount.toString()) : 0
                  carriedTotal += amount
                  carriedProvisional += ps
                  return {
                    organizationId: ctx.organizationId,
                    boqId: boq.id,
                    sectionId: sectionId!,
                    itemRef: `${sectionCode}/${refIndex.toString().padStart(3, '0')}`,
                    description: l.description,
                    brand: l.brand,
                    unit: l.unit,
                    qty: l.qty,
                    rate: l.rate,
                    amount: l.amount,
                    isProvisional: l.isProvisional,
                    psAmount: l.psAmount,
                    confidence: l.confidence,
                    // takeoffItemId stays NULL — marks as "manual" so
                    // the NEXT regenerate carries it forward too.
                    sortOrder: existingCount + i,
                  }
                }),
              })
              sectionLineCount.set(sectionCode, existingCount + lines.length)
            }

            if (carriedTotal !== 0 || carriedProvisional !== 0) {
              await tx.boq.update({
                where: { id: boq.id },
                data: {
                  ...(carriedTotal !== 0 ? { subtotal: { increment: carriedTotal } } : {}),
                  ...(carriedProvisional !== 0
                    ? { totalProvisional: { increment: carriedProvisional } }
                    : {}),
                },
              })
            }
          }

          return boq.id
        },
        { timeout: 60_000, maxWait: 10_000 },
      )

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

  /**
   * Sprint-10 S10-3 — Add a MANUAL BoqLine to a chosen section.
   *
   *   POST /api/boqs/:id/sections/:sectionId/lines
   *
   * Used by the quotation UI's "Add line" button. Free-form line — the
   * caller supplies description, unit, qty, plus EITHER a rate (cost
   * line) OR a P/S flag (carry forward). Recompute happens client-side
   * for the section sum; the PRICE job is the authoritative
   * recomputation when the user clicks Re-price.
   */
  router.post(
    '/api/boqs/:id/sections/:sectionId/lines',
    requireAuth(async (req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true, projectId: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const section = await db.boqSection.findFirst({
        where: { id: ctx.params.sectionId, boqId: boq.id },
        select: { id: true, code: true },
      })
      if (!section) return errorResponse(404, 'BOQ section not found in this BOQ')
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const body = z
        .object({
          description: z.string().min(1).max(500),
          brand: z.string().max(120).optional(),
          unit: z.string().min(1).max(20),
          qty: z.number().finite().nonnegative(),
          // EITHER rate (cost line) OR isProvisional with psAmount.
          rate: z.number().finite().nonnegative().optional(),
          isProvisional: z.boolean().optional(),
          psAmount: z.number().finite().nonnegative().optional(),
        })
        .refine(
          (b) =>
            (b.rate !== undefined && b.isProvisional !== true) ||
            (b.isProvisional === true && b.psAmount !== undefined),
          'Provide rate for a costed line, or isProvisional=true + psAmount for a P/S carry',
        )
        .safeParse(raw)
      if (!body.success) {
        return errorResponse(400, 'Invalid payload', body.error.format())
      }
      const existingLines = await db.boqLine.findMany({
        where: { boqId: boq.id, sectionId: section.id },
        select: { sortOrder: true, itemRef: true },
      })
      const nextSort = existingLines.reduce((max, l) => Math.max(max, l.sortOrder), 0) + 10
      const nextNumber = existingLines.length + 1
      const itemRef = `${section.code}/${String(nextNumber).padStart(3, '0')}`
      const description = body.data.brand
        ? `${body.data.description} (${body.data.brand})`
        : body.data.description
      const amount =
        body.data.rate !== undefined ? body.data.rate * body.data.qty : null
      const created = await db.boqLine.create({
        data: {
          organizationId: ctx.organizationId,
          boqId: boq.id,
          sectionId: section.id,
          itemRef,
          description,
          unit: body.data.unit,
          qty: body.data.qty,
          rate: body.data.rate ?? null,
          rateSource: body.data.rate !== undefined ? 'MANUAL' : null,
          amount,
          isProvisional: body.data.isProvisional ?? false,
          psAmount: body.data.psAmount ?? null,
          sortOrder: nextSort,
        },
      })
      // S10-3 MANUAL provenance — Correction-style audit row so the
      // data-quality flow knows this line is human-supplied.
      await db.correction.create({
        data: {
          organizationId: ctx.organizationId,
          entity: 'BoqLine',
          entityId: created.id,
          field: 'MANUAL',
          aiValue: null,
          humanValue: itemRef,
          reason: 'Add Line from quotation UI',
          userId: ctx.user.id,
        },
      })
      // Bump the BOQ subtotal optimistically; the next PRICE run owns
      // the canonical recompute.
      if (amount !== null) {
        await db.boq.update({
          where: { id: boq.id },
          data: {
            subtotal: { increment: amount },
          },
        })
      } else if (body.data.psAmount !== undefined) {
        await db.boq.update({
          where: { id: boq.id },
          data: {
            totalProvisional: { increment: body.data.psAmount },
          },
        })
      }
      return jsonResponse({ id: created.id, itemRef }, 201)
    }),
  )

  /**
   * #128 — PATCH a BoqLine. Edits description, qty, rate (cost lines
   * only), or psAmount (P/S only). The line stays in its section, the
   * isProvisional flag stays fixed (toggling P/S↔cost is a different
   * semantic; delete + re-add).
   *
   * Adjusts the BOQ.subtotal / totalProvisional by the delta and writes
   * a Correction row capturing which field changed.
   */
  router.patch(
    '/api/boqs/:id/lines/:lineId',
    requireAuth(async (req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const line = await db.boqLine.findFirst({
        where: { id: ctx.params.lineId, boqId: boq.id },
      })
      if (!line) return errorResponse(404, 'BOQ line not found in this BOQ')
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const body = z
        .object({
          description: z.string().min(1).max(500).optional(),
          qty: z.number().finite().nonnegative().optional(),
          rate: z.number().finite().nonnegative().nullable().optional(),
          psAmount: z.number().finite().nonnegative().nullable().optional(),
        })
        .refine(
          (b) =>
            b.description !== undefined ||
            b.qty !== undefined ||
            b.rate !== undefined ||
            b.psAmount !== undefined,
          'At least one of description / qty / rate / psAmount required',
        )
        .safeParse(raw)
      if (!body.success) {
        return errorResponse(400, 'Invalid payload', body.error.format())
      }

      // Compute the new field values + the delta vs. the existing row.
      const oldAmount = line.amount ? Number(line.amount.toString()) : 0
      const oldPs = line.psAmount ? Number(line.psAmount.toString()) : 0

      const nextQty =
        body.data.qty !== undefined ? body.data.qty : line.qty ? Number(line.qty.toString()) : 0
      const nextRate =
        body.data.rate === null
          ? null
          : body.data.rate !== undefined
          ? body.data.rate
          : line.rate
          ? Number(line.rate.toString())
          : null
      const nextPs =
        body.data.psAmount === null
          ? null
          : body.data.psAmount !== undefined
          ? body.data.psAmount
          : line.psAmount
          ? Number(line.psAmount.toString())
          : null

      // Cost lines: amount = qty × rate. P/S lines: amount stays null.
      const newAmount =
        line.isProvisional || nextRate === null ? null : nextQty * nextRate
      const newPs = line.isProvisional ? nextPs : null

      const update: Record<string, unknown> = {}
      if (body.data.description !== undefined) update.description = body.data.description
      if (body.data.qty !== undefined) update.qty = body.data.qty
      if (body.data.rate !== undefined) update.rate = body.data.rate
      if (body.data.psAmount !== undefined) update.psAmount = body.data.psAmount
      update.amount = newAmount
      if (line.isProvisional) update.psAmount = newPs

      const updated = await db.boqLine.update({
        where: { id: line.id },
        data: update,
      })

      // Subtotal / totalProvisional adjustments.
      const amountDelta = (newAmount ?? 0) - oldAmount
      const psDelta = (newPs ?? 0) - oldPs
      if (amountDelta !== 0 || psDelta !== 0) {
        await db.boq.update({
          where: { id: boq.id },
          data: {
            ...(amountDelta !== 0 ? { subtotal: { increment: amountDelta } } : {}),
            ...(psDelta !== 0 ? { totalProvisional: { increment: psDelta } } : {}),
          },
        })
      }

      // Audit: record what changed. One Correction per request — the
      // human-side reason text summarises which fields moved.
      const changes: string[] = []
      if (body.data.description !== undefined) changes.push('description')
      if (body.data.qty !== undefined) changes.push(`qty:${line.qty?.toString() ?? '—'}→${nextQty}`)
      if (body.data.rate !== undefined) changes.push(`rate:${line.rate?.toString() ?? '—'}→${nextRate ?? '—'}`)
      if (body.data.psAmount !== undefined) changes.push(`psAmount:${line.psAmount?.toString() ?? '—'}→${newPs ?? '—'}`)
      await db.correction.create({
        data: {
          organizationId: ctx.organizationId,
          entity: 'BoqLine',
          entityId: line.id,
          field: 'EDIT',
          aiValue: null,
          humanValue: changes.join(' · '),
          reason: 'Edit Line from quotation UI',
          userId: ctx.user.id,
        },
      })
      return jsonResponse({ id: updated.id, itemRef: updated.itemRef })
    }),
  )

  /**
   * #128 — DELETE a BoqLine. Hard delete (no deletedAt column on
   * BoqLine). Subtract the line's amount + psAmount from the BOQ
   * totals, write a Correction row capturing the deletion.
   */
  router.del(
    '/api/boqs/:id/lines/:lineId',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const boq = await db.boq.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!boq) return errorResponse(404, 'BOQ not found')
      const line = await db.boqLine.findFirst({
        where: { id: ctx.params.lineId, boqId: boq.id },
      })
      if (!line) return errorResponse(404, 'BOQ line not found in this BOQ')

      const oldAmount = line.amount ? Number(line.amount.toString()) : 0
      const oldPs = line.psAmount ? Number(line.psAmount.toString()) : 0

      await db.boqLine.delete({ where: { id: line.id } })
      if (oldAmount !== 0 || oldPs !== 0) {
        await db.boq.update({
          where: { id: boq.id },
          data: {
            ...(oldAmount !== 0 ? { subtotal: { decrement: oldAmount } } : {}),
            ...(oldPs !== 0 ? { totalProvisional: { decrement: oldPs } } : {}),
          },
        })
      }
      await db.correction.create({
        data: {
          organizationId: ctx.organizationId,
          entity: 'BoqLine',
          entityId: line.id,
          field: 'DELETE',
          aiValue: line.description,
          humanValue: `deleted (itemRef=${line.itemRef}, amount=${oldAmount}, psAmount=${oldPs})`,
          reason: 'Delete Line from quotation UI',
          userId: ctx.user.id,
        },
      })
      return jsonResponse({ ok: true, deletedId: line.id })
    }),
  )

  /**
   * AI-est roadmap #3 — opt-in ESTIMATE_KITCHEN job. Triggered ONLY by
   * the SPA "Estimate kitchen" button; no automatic chain, no cold-
   * upload billing. Costs ~1.5-2k tokens per click; the suggestions
   * land in JOINERY for the expert to Confirm.
   */
  /**
   * AI-est roadmap #4a — opt-in ESTIMATE_WARDROBES job. One Opus call
   * per bedroom; cost scales with bedroom count (~$0.05 each). Same
   * suggestion-only contract as kitchen.
   */
  router.post(
    '/api/projects/:id/estimate-wardrobes',
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
          type: 'ESTIMATE_WARDROBES',
          payload: { projectId: project.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
    }),
  )

  router.post(
    '/api/projects/:id/estimate-kitchen',
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
          type: 'ESTIMATE_KITCHEN',
          payload: { projectId: project.id } as object,
        },
      })
      return jsonResponse({ jobId: job.id }, 202)
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
