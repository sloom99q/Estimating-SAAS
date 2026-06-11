/**
 * Sprint-4 S4-3: render a plan/finish_plan sheet at high DPI and tile it
 * into 4 OVERLAPPING quadrants for the rooms vision pass.
 *
 * Why: Plot 4357 pilot finding — A1-size plan tag text is ~1.5mm tall on the
 * source PDF. At the Sprint-2 INGEST DPI of 110, that's ~6 pixels tall,
 * which Sonnet's vision pass cannot reliably read. Bumping to 220 DPI
 * doubles the resolution to ~12 px, which IS readable, but the whole page
 * at 220 DPI exceeds Anthropic's image-size budget. Tiling into 4 quadrants
 * with a small overlap (default 10%) gives the model 4 separate, readable
 * images, each comfortably within the API limit.
 *
 * Returns one base64 jpeg per quadrant in row-major order:
 *   [top-left, top-right, bottom-left, bottom-right]
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

export interface QuadrantOptions {
  /** Rendering resolution in dots per inch. Default 220. */
  dpi?: number
  /** Overlap between quadrants as a fraction of the shortest side. Default 0.10. */
  overlapPct?: number
}

export interface QuadrantImage {
  index: number
  /** 'TL' | 'TR' | 'BL' | 'BR' */
  position: 'TL' | 'TR' | 'BL' | 'BR'
  base64: string
}

const POSITIONS = ['TL', 'TR', 'BL', 'BR'] as const

/**
 * Renders the given PDF page into 4 overlapping quadrant jpegs. Caller is
 * responsible for writing `sourceBytes` to disk somewhere; we stage to a
 * fresh tempdir so concurrent jobs don't trample.
 */
export async function renderPageQuadrants(
  sourceBytes: Buffer,
  pageNo: number,
  options: QuadrantOptions = {},
): Promise<QuadrantImage[]> {
  const dpi = options.dpi ?? 220
  const overlapPct = options.overlapPct ?? 0.1

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `quad-${pageNo}-`))
  try {
    const sourcePath = path.join(workDir, 'source.pdf')
    await fs.writeFile(sourcePath, sourceBytes)

    // 1) Page size in points (72pt = 1 inch).
    const info = await spawn(['pdfinfo', '-f', String(pageNo), '-l', String(pageNo), sourcePath])
    if (info.exitCode !== 0) throw new Error(`pdfinfo failed: ${info.stderr}`)
    const sizeMatch = info.stdout.match(/Page size:\s+(\d+(?:\.\d+)?)\s+x\s+(\d+(?:\.\d+)?)\s+pts/)
    if (!sizeMatch) throw new Error('pdfinfo: could not parse Page size')
    const wPts = Number.parseFloat(sizeMatch[1]!)
    const hPts = Number.parseFloat(sizeMatch[2]!)
    const wPx = Math.round((wPts / 72) * dpi)
    const hPx = Math.round((hPts / 72) * dpi)
    const overlap = Math.round(Math.min(wPx, hPx) * overlapPct)
    const halfW = Math.round(wPx / 2)
    const halfH = Math.round(hPx / 2)

    // 2) Define the 4 quadrants in pixel coordinates. They overlap by `overlap`
    //    pixels along the shared center line so a room straddling the line is
    //    captured by both quadrants — the dedupe step downstream removes the
    //    double-count.
    const quads = [
      { position: 'TL' as const, x: 0, y: 0, w: halfW + overlap, h: halfH + overlap },
      {
        position: 'TR' as const,
        x: halfW - overlap,
        y: 0,
        w: wPx - (halfW - overlap),
        h: halfH + overlap,
      },
      {
        position: 'BL' as const,
        x: 0,
        y: halfH - overlap,
        w: halfW + overlap,
        h: hPx - (halfH - overlap),
      },
      {
        position: 'BR' as const,
        x: halfW - overlap,
        y: halfH - overlap,
        w: wPx - (halfW - overlap),
        h: hPx - (halfH - overlap),
      },
    ]

    const out: QuadrantImage[] = []
    for (let i = 0; i < quads.length; i += 1) {
      const q = quads[i]!
      const prefix = path.join(workDir, `q${i}`)
      const res = await spawn([
        'pdftoppm',
        '-jpeg',
        '-r',
        String(dpi),
        '-x',
        String(q.x),
        '-y',
        String(q.y),
        '-W',
        String(q.w),
        '-H',
        String(q.h),
        '-f',
        String(pageNo),
        '-l',
        String(pageNo),
        sourcePath,
        prefix,
      ])
      if (res.exitCode !== 0) {
        throw new Error(`pdftoppm quadrant ${q.position} failed: ${res.stderr}`)
      }
      // pdftoppm emits prefix-<page>.jpg with padding matching the doc's page count.
      const candidates = [`${prefix}-${pageNo}.jpg`, `${prefix}-1.jpg`]
      let bytes: Buffer | null = null
      for (const candidate of candidates) {
        try {
          bytes = await fs.readFile(candidate)
          break
        } catch {
          // try next
        }
      }
      if (!bytes) throw new Error(`pdftoppm: no jpeg output for quadrant ${q.position}`)
      out.push({
        index: i,
        position: POSITIONS[i]!,
        base64: bytes.toString('base64'),
      })
    }
    return out
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
