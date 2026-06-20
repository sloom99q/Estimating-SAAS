/**
 * Sprint-7 S7-4 — produces a bbox-layout JSON for a single PDF page using
 * `pdftotext -bbox-layout`. Caller passes the source PDF bytes; we write
 * to a temp dir, shell out, and parse the HTML into the bbox-word shape
 * the spatial parser consumes.
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BboxWord } from './roomsBboxParser'

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

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#178;/g, '²')
    .replace(/&#xb2;/gi, '²')
    .replace(/&#x2009;/gi, ' ')
    .replace(/&#x202f;/gi, ' ')
    .replace(/&nbsp;/g, ' ')
}

const WORD_RE =
  /<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)">(.*?)<\/word>/g

/**
 * Read the page width + height (in points) from the `<page width="..."
 * height="...">` element pdftotext -bbox-layout emits. Used by the
 * kitchen-crop renderer to translate the bbox computation into pixel
 * coordinates pdftoppm understands.
 */
const PAGE_DIM_RE = /<page\s+width="([\d.]+)"\s+height="([\d.]+)"/

export async function renderPageBboxWithDims(
  sourceBytes: Buffer,
  pageNo: number,
): Promise<{ words: BboxWord[]; pageWidthPt: number; pageHeightPt: number }> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `bbox-${pageNo}-`))
  try {
    const src = path.join(workDir, 'source.pdf')
    const out = path.join(workDir, `bbox-${pageNo}.html`)
    await fs.writeFile(src, sourceBytes)
    const res = await spawn([
      'pdftotext',
      '-bbox-layout',
      '-f',
      String(pageNo),
      '-l',
      String(pageNo),
      src,
      out,
    ])
    if (res.exitCode !== 0) {
      throw new Error(`pdftotext -bbox-layout failed: ${res.stderr}`)
    }
    const html = await fs.readFile(out, 'utf-8')
    const dim = PAGE_DIM_RE.exec(html)
    const pageWidthPt = dim ? Number.parseFloat(dim[1]!) : 0
    const pageHeightPt = dim ? Number.parseFloat(dim[2]!) : 0
    const words: BboxWord[] = []
    WORD_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = WORD_RE.exec(html)) !== null) {
      const [, xMin, yMin, xMax, yMax, raw] = match
      words.push({
        text: decodeXmlEntities(raw ?? ''),
        xMin: Number.parseFloat(xMin!),
        yMin: Number.parseFloat(yMin!),
        xMax: Number.parseFloat(xMax!),
        yMax: Number.parseFloat(yMax!),
      })
    }
    return { words, pageWidthPt, pageHeightPt }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function renderPageBbox(
  sourceBytes: Buffer,
  pageNo: number,
): Promise<{ words: BboxWord[] }> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `bbox-${pageNo}-`))
  try {
    const src = path.join(workDir, 'source.pdf')
    const out = path.join(workDir, `bbox-${pageNo}.html`)
    await fs.writeFile(src, sourceBytes)
    const res = await spawn([
      'pdftotext',
      '-bbox-layout',
      '-f',
      String(pageNo),
      '-l',
      String(pageNo),
      src,
      out,
    ])
    if (res.exitCode !== 0) {
      throw new Error(`pdftotext -bbox-layout failed: ${res.stderr}`)
    }
    const html = await fs.readFile(out, 'utf-8')
    const words: BboxWord[] = []
    WORD_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = WORD_RE.exec(html)) !== null) {
      const [, xMin, yMin, xMax, yMax, raw] = match
      words.push({
        text: decodeXmlEntities(raw ?? ''),
        xMin: Number.parseFloat(xMin!),
        yMin: Number.parseFloat(yMin!),
        xMax: Number.parseFloat(xMax!),
        yMax: Number.parseFloat(yMax!),
      })
    }
    return { words }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
