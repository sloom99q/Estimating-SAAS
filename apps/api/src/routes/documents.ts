import type { Prisma } from '@prisma/client'
import { getBlobStore } from '../blob/fs'
import { documentKey } from '../blob/types'
import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const PDF_MAGIC = '%PDF'
const PIPELINE_TYPES = ['INGEST', 'CLASSIFY', 'EXTRACT_SCHEDULES', 'EXTRACT_ROOMS'] as const

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
        return errorResponse(413, `File exceeds ${MAX_UPLOAD_BYTES} bytes`)
      }
      // Belt + braces: trust the magic bytes, not just the content-type. Read
      // the whole thing into memory once (we'd need to anyway for the blob put).
      const buf = Buffer.from(await file.arrayBuffer())
      const headStr = buf.slice(0, 4).toString('latin1')
      const looksLikePdf = headStr === PDF_MAGIC
      const contentTypeOk = file.type === 'application/pdf' || file.type === '' || file.type == null
      if (!looksLikePdf || !contentTypeOk) {
        return errorResponse(415, 'Only application/pdf is accepted')
      }

      // Create Document FIRST so we have its cuid for the blob key. If the
      // blob write fails we leave a stub row in UPLOADED — INGEST will mark it
      // FAILED on retry. (Alternative would be tx + rollback but the blob is
      // outside the DB transaction anyway.)
      const filename = file.name || 'document.pdf'
      const created = await db.document.create({
        data: {
          // Compiler-required but extension-overridden — see tenantDb.ts.
          organizationId: ctx.organizationId,
          projectId: project.id,
          filename,
          // Pre-compute the storage key from a known-good seed; we patch it
          // below with the real id (it lines up because cuid).
          storageKey: 'pending',
          status: 'UPLOADED',
        },
      })
      const key = documentKey(ctx.organizationId, project.id, created.id, 'source.pdf')
      await getBlobStore().put(key, buf, 'application/pdf')

      const document = await db.document.update({
        where: { id: created.id },
        data: { storageKey: key },
      })
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
