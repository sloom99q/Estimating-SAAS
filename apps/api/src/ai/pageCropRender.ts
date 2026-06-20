/**
 * AI-est roadmap #3 — render a pixel-region crop of a PDF page to JPEG
 * via pdftoppm. Used by the kitchen estimator to feed Sonnet ONLY the
 * crop window over the kitchen, not the whole sheet.
 *
 * pdftoppm's -x/-y/-W/-H crop args take values in PIXELS at the given
 * render DPI. The caller is responsible for computing those (see
 * computeKitchenCrop in estimateKitchenPass.ts).
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface CropRenderRequest {
  pageNo: number
  x: number
  y: number
  width: number
  height: number
  dpi: number
}

export async function renderPageCropJpeg(
  sourceBytes: Buffer,
  req: CropRenderRequest,
): Promise<string> {
  if (req.width <= 0 || req.height <= 0) {
    throw new Error(
      `renderPageCropJpeg: invalid crop dims ${req.width}x${req.height} for page ${req.pageNo}`,
    )
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `kitchen-crop-${req.pageNo}-`))
  try {
    const src = path.join(workDir, 'source.pdf')
    await fs.writeFile(src, sourceBytes)
    const prefix = path.join(workDir, 'crop')
    // @ts-ignore Bun global
    const proc = Bun.spawn(
      [
        'pdftoppm',
        '-jpeg',
        '-r',
        String(req.dpi),
        '-f',
        String(req.pageNo),
        '-l',
        String(req.pageNo),
        '-x',
        String(Math.max(0, Math.round(req.x))),
        '-y',
        String(Math.max(0, Math.round(req.y))),
        '-W',
        String(Math.round(req.width)),
        '-H',
        String(Math.round(req.height)),
        src,
        prefix,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`pdftoppm crop failed (exit ${code}): ${stderr}`)
    }
    // pdftoppm names files prefix-<n>.jpg with no padding when only
    // one page is rendered. Try both common shapes.
    const candidates = [`${prefix}-${req.pageNo}.jpg`, `${prefix}-1.jpg`]
    for (const c of candidates) {
      try {
        const bytes = await fs.readFile(c)
        return bytes.toString('base64')
      } catch {
        // try next
      }
    }
    throw new Error(`pdftoppm produced no output (expected one of ${candidates.join(', ')})`)
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
