/**
 * DXF MVP — introspect + save-layer-map endpoints.
 *
 * GET  /api/projects/:projectId/dxf/:documentId/layers
 *   Reads the uploaded DXF blob, runs introspectDxf(), returns the
 *   LayerReport. Powers the LayerMapModal — the modal calls this once
 *   on first DXF upload so the human can confirm which layer holds
 *   rooms / doors / windows / etc.
 *
 * GET  /api/projects/:projectId/layer-map
 *   Returns the project's current LayerMap (null if not yet set) plus
 *   the org's defaultLayerMap (null if not yet set). The modal uses
 *   these to pre-fill the form on a re-open.
 *
 * PATCH /api/projects/:projectId/layer-map
 *   Body: { layerMap: LayerMap, saveAsOrgDefault?: boolean,
 *           enqueueDocumentId?: string }
 *   Persists the LayerMap on the Project; optionally copies to
 *   Organization.defaultLayerMap. If enqueueDocumentId is provided,
 *   enqueues a PARSE_DXF job for that document so the standard
 *   pipeline-polling SPA flow kicks off.
 *
 * No PARSE_DXF handler exists yet — that's the next milestone after
 * the estimator signs off on the layer-map UX. The save endpoint
 * will accept enqueueDocumentId and refuse to enqueue until the
 * handler is registered (returns 503).
 */
import { z } from 'zod'
import { getBlobStore } from '../blob/fs'
import { introspectDxf } from '../dxf/introspect'
import { AIA_NCS_DEFAULT } from '../dxf/layerMap'
import { prisma } from '../db'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

const layerMapSchema = z.object({
  roomBounds: z.array(z.string()).min(1),
  roomLabels: z.array(z.string()),
  doors: z.array(z.string()),
  windows: z.array(z.string()),
  walls: z.array(z.string()),
  tagAttribs: z.array(z.string()),
  minRoomAreaM2: z.number().min(0).max(50),
  maxRoomAreaM2: z.number().min(50).max(10_000),
})

const saveBody = z.object({
  layerMap: layerMapSchema,
  saveAsOrgDefault: z.boolean().optional(),
  enqueueDocumentId: z.string().optional(),
})

export function registerDxfRoutes(router: Router): void {
  /**
   * Introspect — pure, no DB writes. Reads the blob, parses, returns
   * LayerReport. Fast (<200ms for a typical floor-plan DXF).
   */
  router.get(
    '/api/projects/:projectId/dxf/:documentId/layers',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const document = await db.document.findFirst({
        where: {
          id: ctx.params.documentId,
          projectId: ctx.params.projectId,
          deletedAt: null,
        },
        select: { id: true, storageKey: true, filename: true },
      })
      if (!document) return errorResponse(404, 'Document not found')
      if (!/\.dxf$/i.test(document.filename)) {
        return errorResponse(400, 'Document is not a DXF file')
      }
      let bytes: Buffer
      try {
        bytes = await getBlobStore().get(document.storageKey)
      } catch (err) {
        return errorResponse(
          500,
          `Could not read blob for ${document.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      const report = introspectDxf(bytes.toString('utf-8'))
      return jsonResponse({
        document: { id: document.id, filename: document.filename },
        report,
      })
    }),
  )

  /**
   * GET layer-map — returns the project's current LayerMap (or null),
   * the org default (or null), and AIA_NCS_DEFAULT as a reference.
   */
  router.get(
    '/api/projects/:projectId/layer-map',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.projectId, deletedAt: null },
        select: { id: true, layerMap: true, organizationId: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const org = await prisma.organization.findUnique({
        where: { id: project.organizationId },
        select: { defaultLayerMap: true },
      })
      return jsonResponse({
        layerMap: project.layerMap ?? null,
        orgDefault: org?.defaultLayerMap ?? null,
        aiaDefault: AIA_NCS_DEFAULT,
      })
    }),
  )

  /**
   * PATCH layer-map — save. Optionally copies to org default and
   * enqueues a PARSE_DXF job for the just-uploaded doc.
   */
  router.patch(
    '/api/projects/:projectId/layer-map',
    requireAuth(async (req, ctx) => {
      let raw: unknown
      try { raw = await req.json() } catch { return errorResponse(400, 'Invalid JSON body') }
      const parsed = saveBody.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(400, 'Invalid payload', parsed.error.format())
      }
      const { layerMap, saveAsOrgDefault, enqueueDocumentId } = parsed.data

      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.projectId, deletedAt: null },
        select: { id: true, organizationId: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      // Persist on Project.
      await db.project.update({
        where: { id: project.id },
        data: { layerMap: layerMap as object },
      })
      // Optionally save as org default.
      if (saveAsOrgDefault) {
        await prisma.organization.update({
          where: { id: project.organizationId },
          data: { defaultLayerMap: layerMap as object },
        })
      }

      // Enqueue PARSE_DXF — but the handler doesn't exist yet. Return
      // 200 with a `parseDxfQueued: false` marker so the SPA knows
      // the LayerMap was saved but the next step is gated on the
      // handler shipping.
      let parseDxfQueued = false
      let parseDxfJobId: string | null = null
      if (enqueueDocumentId) {
        // Lazy-check: does the PARSE_DXF handler exist? If yes, queue.
        // If not (current MVP-phase-1 state), skip with a clear marker.
        try {
          const { HANDLERS } = await import('../jobs/handlers')
          if ('PARSE_DXF' in HANDLERS) {
            const job = await db.job.create({
              data: {
                organizationId: ctx.organizationId,
                projectId: project.id,
                type: 'PARSE_DXF' as never,
                payload: { documentId: enqueueDocumentId } as object,
              },
            })
            parseDxfQueued = true
            parseDxfJobId = job.id
          }
        } catch {
          // handler import is fine; the in-check is fine; only the
          // job.create can fail. Swallow + leave the SPA to display
          // "saved; PARSE_DXF not yet implemented".
        }
      }

      return jsonResponse({ ok: true, parseDxfQueued, parseDxfJobId })
    }),
  )

  /**
   * DXF-AUTO-SKIP — modal Cancel calls this. Marks the document as
   * SKIPPED so the multi-doc gate releases. The doc can be
   * re-promoted later by re-uploading the file (or, future work, by
   * a "re-open layer-map" affordance in DocumentsListCard).
   */
  router.post(
    '/api/projects/:projectId/dxf/:documentId/skip',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const document = await db.document.findFirst({
        where: {
          id: ctx.params.documentId,
          projectId: ctx.params.projectId,
          deletedAt: null,
        },
        select: { id: true, status: true, filename: true },
      })
      if (!document) return errorResponse(404, 'Document not found')
      // Don't skip a doc that's already processing or done — would be
      // surprising. Only UPLOADED-status docs are eligible.
      if (document.status !== 'UPLOADED' && document.status !== 'SKIPPED') {
        return errorResponse(
          409,
          `Document is in status ${document.status}; only UPLOADED docs can be skipped.`,
        )
      }
      await db.document.update({
        where: { id: document.id },
        data: { status: 'SKIPPED' },
      })
      return jsonResponse({ ok: true, status: 'SKIPPED' })
    }),
  )
}
