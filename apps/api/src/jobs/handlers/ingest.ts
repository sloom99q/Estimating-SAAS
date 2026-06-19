/**
 * INGEST — Sprint 2 entry point of the takeoff pipeline.
 *
 * Reads the uploaded PDF from BlobStore, shells out to poppler to extract
 * per-page text + a 110 DPI jpeg, persists both back into BlobStore under
 * canonical keys, and upserts one Sheet row per page. Idempotent on retry:
 * blob writes skip if the destination already exists; Sheet rows use
 * `upsert([documentId, pageNo])`. Chains into CLASSIFY at the end.
 *
 *   {
 *     documentId: 'cmq...'      // required
 *   }
 *
 * Bumps `Usage.pagesProcessed` by the page count when it finishes.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prisma } from '../../db'
import { getBlobStore } from '../../blob/fs'
import { documentKey } from '../../blob/types'
import { enqueueIfNotDone } from '../chainGuard'
import type { JobHandler, JobRecord } from '../types'

interface IngestPayload {
  documentId: string
}

interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

async function spawn(cmd: string[]): Promise<SpawnResult> {
  // @ts-ignore Bun global
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  return { stdout, stderr, exitCode }
}

function parsePageCount(pdfInfoStdout: string): number {
  const m = pdfInfoStdout.match(/^Pages:\s+(\d+)/m)
  if (!m) throw new Error('pdfinfo: Pages: line not found')
  return Number.parseInt(m[1]!, 10)
}

/**
 * Empty pdffonts output (just the header) ⇒ no embedded fonts anywhere in the
 * document ⇒ the PDF is a scanned set. Per-page hasTextLayer is derived in the
 * pdftotext loop below; this is the document-level flag we surface.
 */
function detectGlobalTextLayer(pdfFontsStdout: string): boolean {
  // pdffonts output:
  //   name                                 type              encoding ...
  //   ------------------------------------ ----------------- -------- ...
  //   ABCDEF+CourierNew                   TrueType          WinAnsi  ...
  // 2 header lines + 0 data lines ⇒ no text.
  const lines = pdfFontsStdout.trim().split('\n').filter((l) => l.trim().length > 0)
  return lines.length > 2
}

export const ingestHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as IngestPayload
  if (!payload.documentId) throw new Error('INGEST: payload.documentId required')

  const document = await prisma.document.findFirst({
    where: { id: payload.documentId, organizationId: job.organizationId },
  })
  if (!document) throw new Error(`INGEST: document ${payload.documentId} not found in org`)

  await prisma.document.update({
    where: { id: document.id },
    data: { status: 'PROCESSING' },
  })

  const blob = getBlobStore()
  const sourceBytes = await blob.get(document.storageKey)

  // Poppler needs a real filesystem path. Stage to a unique temp dir so
  // concurrent jobs can't trample each other.
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `ingest-${document.id}-`))
  const sourcePath = path.join(workDir, 'source.pdf')
  await fs.writeFile(sourcePath, sourceBytes)

  try {
    const info = await spawn(['pdfinfo', sourcePath])
    if (info.exitCode !== 0) throw new Error(`pdfinfo failed: ${info.stderr}`)
    const pageCount = parsePageCount(info.stdout)

    const fonts = await spawn(['pdffonts', sourcePath])
    if (fonts.exitCode !== 0) throw new Error(`pdffonts failed: ${fonts.stderr}`)
    const globalHasText = detectGlobalTextLayer(fonts.stdout)

    // Whole-document text dump split by formfeed = per-page text in one shot.
    const text = await spawn(['pdftotext', '-layout', sourcePath, '-'])
    if (text.exitCode !== 0) throw new Error(`pdftotext failed: ${text.stderr}`)
    const perPageText = text.stdout.split('\f')
    // pdftotext appends a trailing \f; drop the empty tail if present.
    while (perPageText.length > pageCount) perPageText.pop()
    while (perPageText.length < pageCount) perPageText.push('')

    // Render every page to jpeg in one pdftoppm call. Output files are named
    // `page-1.jpg`, `page-2.jpg`, ... — pdftoppm pads to fit the page count.
    const ppmPrefix = path.join(workDir, 'page')
    const render = await spawn(['pdftoppm', '-jpeg', '-r', '110', sourcePath, ppmPrefix])
    if (render.exitCode !== 0) throw new Error(`pdftoppm failed: ${render.stderr}`)

    await prisma.document.update({
      where: { id: document.id },
      data: { pageCount },
    })

    // Walk pages 1..pageCount. Save text + jpeg blobs; upsert the Sheet row.
    for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
      const pageText = perPageText[pageNo - 1] ?? ''
      const hasTextLayer = globalHasText && pageText.trim().length > 0

      const textKey = documentKey(
        job.organizationId,
        document.projectId,
        document.id,
        `pages/${pageNo}.txt`,
      )
      const imageKey = documentKey(
        job.organizationId,
        document.projectId,
        document.id,
        `pages/${pageNo}.jpg`,
      )

      // Idempotent: only write if the destination does not already exist.
      if (hasTextLayer && !(await blob.exists(textKey))) {
        await blob.put(textKey, Buffer.from(pageText, 'utf-8'), 'text/plain')
      }
      const jpgPath = await findRenderedJpeg(ppmPrefix, pageNo, pageCount)
      if (jpgPath && !(await blob.exists(imageKey))) {
        const jpegBytes = await fs.readFile(jpgPath)
        await blob.put(imageKey, jpegBytes, 'image/jpeg')
      }

      await prisma.sheet.upsert({
        where: { documentId_pageNo: { documentId: document.id, pageNo } },
        create: {
          organizationId: job.organizationId,
          documentId: document.id,
          pageNo,
          hasTextLayer,
          rawTextKey: hasTextLayer ? textKey : null,
          imageKey: jpgPath ? imageKey : null,
        },
        update: {
          hasTextLayer,
          rawTextKey: hasTextLayer ? textKey : null,
          imageKey: jpgPath ? imageKey : null,
        },
      })
    }

    // Meter pages once at the end, not per-loop, so retries don't double-count.
    await prisma.usage.upsert({
      where: { organizationId: job.organizationId },
      create: { organizationId: job.organizationId, pagesProcessed: pageCount },
      update: { pagesProcessed: { increment: pageCount } },
    })

    // S7-1: chain handoff no-op guard. If CLASSIFY already DONE for this
    // doc (re-run of INGEST), don't re-enqueue. The operator can force a
    // re-classify by enqueueing CLASSIFY with payload.force=true directly.
    await enqueueIfNotDone({
      client: prisma,
      organizationId: job.organizationId,
      projectId: document.projectId,
      type: 'CLASSIFY',
      documentId: document.id,
    })

    return {
      ok: true,
      documentId: document.id,
      pageCount,
      hasGlobalTextLayer: globalHasText,
    }
  } finally {
    // Always sweep the staging dir, even on failure.
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * pdftoppm pads the page-number suffix to the digit count of `pageCount` (so
 * a 58-page set produces page-01.jpg through page-58.jpg). We probe the two
 * common shapes — plain and padded — without forcing a directory listing.
 */
async function findRenderedJpeg(
  prefix: string,
  pageNo: number,
  pageCount: number,
): Promise<string | null> {
  const padLen = String(pageCount).length
  const candidates = [
    `${prefix}-${pageNo}.jpg`,
    `${prefix}-${String(pageNo).padStart(padLen, '0')}.jpg`,
    `${prefix}-${String(pageNo).padStart(2, '0')}.jpg`,
  ]
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // try the next shape
    }
  }
  return null
}
