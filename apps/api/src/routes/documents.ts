import type { Prisma } from '@prisma/client'
import { getBlobStore } from '../blob/fs'
import { documentKey } from '../blob/types'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

/**
 * Per-file upload ceiling. Bumped 50 MB → 200 MB (2026-06-21) — real
 * finishes packs (full I400 set on a complete villa) routinely hit
 * 60-100 MB, larger drawing sets with embedded renderings push past
 * 150 MB. 200 MB keeps us under the practical limit of in-memory blob
 * processing on the worker (Bun handles ~1 GB buffers but 200 MB is
 * a sane single-file cap; users with bigger sets should split docs).
 *
 * Override via env: UPLOAD_MAX_BYTES (raw bytes). Useful for
 * temporary lifts on a known-big project.
 */
const MAX_UPLOAD_BYTES = (() => {
  const raw = process.env.UPLOAD_MAX_BYTES
  if (raw) {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 200 * 1024 * 1024
})()
const PDF_MAGIC = '%PDF'
const PIPELINE_TYPES = ['INGEST', 'CLASSIFY', 'EXTRACT_SCHEDULES', 'EXTRACT_ROOMS'] as const

/**
 * DXF MVP — fuzzy DXF detection.
 *
 * DXF is plain text. The R12+ ASCII DXF format always opens with the
 * group code `0` on the first line, then `SECTION`, then `2`, then
 * `HEADER`. Whitespace handling varies by exporter (some emit leading
 * spaces or CRLF). We:
 *   1. Sniff the first ~256 bytes for the literal `SECTION` and the
 *      group-code-`0` pattern.
 *   2. Require the filename to end `.dxf` (case-insensitive) OR the
 *      content-type to be one of the dxf MIME variants.
 * Both checks must pass — magic alone false-positives on any text
 * file that happens to contain "SECTION".
 */
function detectDxf(buf: Buffer, filename: string, contentType: string | null | undefined): boolean {
  const head = buf.slice(0, 512).toString('utf-8').trimStart()
  const looksLikeDxfMagic =
    /^0\s+SECTION\s+2\s+HEADER/i.test(head) ||
    /^999/.test(head) || // some exporters write a leading 999 comment line
    head.includes('AutoCAD')
  if (!looksLikeDxfMagic) return false
  const filenameOk = /\.dxf$/i.test(filename)
  const contentTypeOk =
    !contentType ||
    contentType === '' ||
    contentType === 'application/dxf' ||
    contentType === 'image/vnd.dxf' ||
    contentType === 'application/octet-stream' ||
    contentType === 'text/plain'
  return filenameOk && contentTypeOk
}

function documentDto(row: {
  id: string
  organizationId: string
  projectId: string
  filename: string
  storageKey: string
  pageCount: number | null
  status: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    filename: row.filename,
    storageKey: row.storageKey,
    pageCount: row.pageCount,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function sheetDto(row: {
  id: string
  documentId: string
  pageNo: number
  drawingNo: string | null
  title: string | null
  discipline: string | null
  sheetType: string | null
  scaleNote: string | null
  hasTextLayer: boolean
  rawTextKey: string | null
  imageKey: string | null
  aiJson: Prisma.JsonValue | null
  promptVersion: string | null
}) {
  return {
    id: row.id,
    documentId: row.documentId,
    pageNo: row.pageNo,
    drawingNo: row.drawingNo,
    title: row.title,
    discipline: row.discipline,
    sheetType: row.sheetType,
    scaleNote: row.scaleNote,
    hasTextLayer: row.hasTextLayer,
    rawTextKey: row.rawTextKey,
    imageKey: row.imageKey,
    aiJson: row.aiJson,
    promptVersion: row.promptVersion,
  }
}

function jobDto(row: {
  id: string
  type: string
  status: string
  attempts: number
  error: string | null
  result: Prisma.JsonValue
  aiMode: string | null
  aiModel: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    result: row.result,
    // Sprint-8 S8-6: surface the resolved AI mode the worker used for this
    // job so the SPA can flag a stub-banner per pipeline run.
    aiMode: row.aiMode,
    // Sprint-8 S8-8 R1: per-stage model the worker resolved for this job.
    aiModel: row.aiModel,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }
}

export function registerDocumentRoutes(router: Router): void {
  /**
   * POST /api/projects/:id/documents
   *
   * Multipart upload. Stores the PDF under the canonical BlobStore key, creates
   * a Document row in UPLOADED status, and enqueues the INGEST job that drives
   * the rest of the pipeline (INGEST → CLASSIFY → EXTRACT_SCHEDULES →
   * EXTRACT_ROOMS → READY). Sprint 2 entry point.
   */
  router.post(
    '/api/projects/:id/documents',
    requireAuth(async (req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')

      // Bun's `req.formData()` returns the Web-API FormData. Cast to `any`
      // because the workspace's TS typings pull in undici's variant which
      // doesn't structurally match.
      let form: FormData
      try {
        form = (await (req as unknown as { formData(): Promise<FormData> }).formData())
      } catch {
        return errorResponse(400, 'Expected multipart/form-data with a `file` field')
      }
      const fileEntry = form.get('file') as unknown
      if (
        !fileEntry ||
        typeof (fileEntry as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
      ) {
        return errorResponse(400, 'Missing `file` field')
      }
      const file = fileEntry as { name?: string; type?: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
      if (file.size === 0) return errorResponse(400, 'Empty file')
      if (file.size > MAX_UPLOAD_BYTES) {
        const fileMb = Math.ceil(file.size / 1024 / 1024)
        const limitMb = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)
        return errorResponse(
          413,
          `File is ${fileMb} MB; per-file cap is ${limitMb} MB. Split the document or raise UPLOAD_MAX_BYTES on the server.`,
        )
      }
      // Belt + braces: trust the magic bytes, not just the content-type. Read
      // the whole thing into memory once (we'd need to anyway for the blob put).
      //
      // DXF MVP (2026-06-24) — accept .dxf as a second valid kind.
      // DXF is plain text; magic detection is fuzzy. We require the
      // first non-whitespace lines to look like `0\n SECTION` AND the
      // filename to end .dxf as a tiebreaker. PDF detection unchanged.
      const buf = Buffer.from(await file.arrayBuffer())
      const headStr = buf.slice(0, 4).toString('latin1')
      const filename = file.name || 'document'
      const isPdf =
        headStr === PDF_MAGIC &&
        (file.type === 'application/pdf' || file.type === '' || file.type == null)
      const isDxf = detectDxf(buf, filename, file.type)
      if (!isPdf && !isDxf) {
        return errorResponse(
          415,
          'Only application/pdf or DXF (.dxf) files are accepted',
        )
      }

      // Create Document FIRST so we have its cuid for the blob key. If the
      // blob write fails we leave a stub row in UPLOADED — INGEST will mark it
      // FAILED on retry. (Alternative would be tx + rollback but the blob is
      // outside the DB transaction anyway.)
      const fileExt = isDxf ? 'source.dxf' : 'source.pdf'
      const contentType = isDxf ? 'application/dxf' : 'application/pdf'
      const safeFilename = file.name || (isDxf ? 'document.dxf' : 'document.pdf')
      const created = await db.document.create({
        data: {
          // Compiler-required but extension-overridden — see tenantDb.ts.
          organizationId: ctx.organizationId,
          projectId: project.id,
          filename: safeFilename,
          // Pre-compute the storage key from a known-good seed; we patch it
          // below with the real id (it lines up because cuid).
          storageKey: 'pending',
          status: 'UPLOADED',
        },
      })
      const key = documentKey(ctx.organizationId, project.id, created.id, fileExt)
      await getBlobStore().put(key, buf, contentType)

      const document = await db.document.update({
        where: { id: created.id },
        data: { storageKey: key },
      })

      // DXF MVP — DXF uploads do NOT auto-enqueue PARSE_DXF. The SPA
      // first calls the layer-introspect route, shows the
      // LayerMapModal, the user confirms, the modal PATCHes
      // Project.layerMap, then enqueues PARSE_DXF.
      //
      // DXF-AUTO-SKIP (2026-06-24) — real drawing sets are 20-50
      // files. Most are not plan sheets (elevations, sections,
      // details, RCPs, finish keys). We do NOT want to open the
      // layer-map modal 50 times. Run the introspector inline; if
      // it finds zero CODE-AREA MTEXT labels we know there are no
      // rooms to extract and auto-mark the doc SKIPPED so the gate
      // releases without estimator interaction. The user can still
      // upload finishes/elevation PDFs separately (vision pipeline)
      // for finish-mapping; PARSE_DXF only cares about room geometry.
      if (isDxf) {
        const { introspectDxf } = await import('../dxf/introspect')
        let report: ReturnType<typeof introspectDxf>
        try {
          report = introspectDxf(buf.toString('utf-8'))
        } catch (err) {
          // Parse failure — surface as FAILED so the gate releases
          // and DocumentsListCard shows the error to the operator.
          await db.document.update({
            where: { id: document.id },
            data: { status: 'FAILED' },
          })
          return jsonResponse(
            {
              document: { ...documentDto({ ...document, status: 'FAILED' }), sourceFormat: 'DXF' },
              needsLayerMap: false,
              autoSkipped: false,
              parseError: err instanceof Error ? err.message : String(err),
            },
            202,
          )
        }

        const isPlanSheet = report.ok && report.plausibleRoomLabelCount >= 1

        if (!isPlanSheet) {
          // Auto-skip: not a plan sheet, nothing to extract.
          await db.document.update({
            where: { id: document.id },
            data: { status: 'SKIPPED' },
          })
          return jsonResponse(
            {
              document: { ...documentDto({ ...document, status: 'SKIPPED' }), sourceFormat: 'DXF' },
              needsLayerMap: false,
              autoSkipped: true,
              autoSkipReason: report.ok
                ? 'no_room_labels'
                : 'parse_error',
              plausibleRoomLabelCount: report.plausibleRoomLabelCount,
            },
            202,
          )
        }

        // Plan sheet — surface to the SPA so the modal opens (or skips
        // straight to enqueue if the project's LayerMap already exists).
        const proj = await db.project.findUnique({
          where: { id: project.id },
          select: { layerMap: true },
        })
        return jsonResponse(
          {
            document: { ...documentDto(document), sourceFormat: 'DXF' },
            needsLayerMap: !proj?.layerMap,
            autoSkipped: false,
            plausibleRoomLabelCount: report.plausibleRoomLabelCount,
          },
          202,
        )
      }

      const ingestJob = await db.job.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: project.id,
          type: 'INGEST',
          payload: { documentId: document.id } as object,
        },
      })

      return jsonResponse({ document: documentDto(document), ingestJobId: ingestJob.id }, 202)
    }),
  )

  /**
   * GET /api/documents/:id
   *
   * Document + its sheets + the latest pipeline job per type. SPA polls this
   * while INGEST..EXTRACT_* run; we keep the response shape stable so the
   * polling client can diff cheaply.
   */
  /**
   * Sprint-10 PA-4 — Documents list per project. FAILED runs need to be
   * findable without archaeology: this returns every Document with a
   * cheap aggregate of its pipeline jobs so the SPA can flag the
   * problem at the LIST level.
   */
  router.get(
    '/api/projects/:id/documents',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const project = await db.project.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
        select: { id: true },
      })
      if (!project) return errorResponse(404, 'Project not found')
      const docs = await db.document.findMany({
        where: { projectId: project.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      })
      const jobs = await db.job.findMany({
        where: {
          projectId: project.id,
          type: { in: [...PIPELINE_TYPES] },
        },
        orderBy: { createdAt: 'desc' },
      })
      const summary = docs.map((d) => {
        const docJobs = jobs.filter((j) => {
          const payload = (j.payload ?? {}) as Record<string, unknown>
          return payload.documentId === d.id
        })
        const failed = docJobs.filter((j) => j.status === 'FAILED')
        const running = docJobs.filter((j) => j.status === 'RUNNING')
        const queued = docJobs.filter((j) => j.status === 'QUEUED')
        return {
          ...documentDto(d),
          jobs: { failed: failed.length, running: running.length, queued: queued.length, total: docJobs.length },
          firstFailedJob: failed[0]
            ? { id: failed[0].id, type: failed[0].type, error: (failed[0].error ?? '').slice(0, 280) }
            : null,
        }
      })
      return jsonResponse({ documents: summary })
    }),
  )

  router.get(
    '/api/documents/:id',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const document = await db.document.findFirst({
        where: { id: ctx.params.id, deletedAt: null },
      })
      if (!document) return errorResponse(404, 'Document not found')

      const sheets = await db.sheet.findMany({
        where: { documentId: document.id },
        orderBy: { pageNo: 'asc' },
      })

      // Pipeline jobs for THIS document. We filter by JSON payload.documentId
      // so the response stays tight even if other documents in the project are
      // also in flight.
      const jobs = await db.job.findMany({
        where: {
          projectId: document.projectId,
          type: { in: [...PIPELINE_TYPES] },
          payload: { path: ['documentId'], equals: document.id },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      })

      return jsonResponse({
        document: documentDto(document),
        sheets: sheets.map(sheetDto),
        jobs: jobs.map(jobDto),
      })
    }),
  )
}
