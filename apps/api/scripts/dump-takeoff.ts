/**
 * dump-takeoff — write one human-readable .txt with every extraction
 * artefact for a project. The thin BOQ summary hides most of what the
 * pipeline produced; this dump is the diff-able full picture.
 *
 *   bun apps/api/scripts/dump-takeoff.ts <projectId> [--out=<path>]
 *
 * Default output:
 *   apps/api/data/takeoff-dump-<projectId>-<utc>.txt
 *
 * Layout (top → bottom):
 *   1. PROJECT  (id, name, created, org)
 *   2. DOCUMENTS  (id, status, uploaded at)
 *   3. SHEETS  (page, drawingNo, sheetType, text/img/ai flags, aiJson)
 *   4. JOBS  (one row per pipeline stage with timings + result tail)
 *   5. LEGEND  (codes + material/usage from meta)
 *   6. ROOMS / AREA_STATEMENTS  (name, area, finish_code, evidence, sheet)
 *   7. DOORS · WINDOWS · OTHER FINISHES  (tag, count, w/h, basis, conf)
 *   8. VALIDATION FLAGS  (project-level then per-item)
 *   9. CORRECTIONS  (aiValue → humanValue per human edit)
 *  10. BOQ  (latest version: sections + lines + rates)
 *
 * Read-only — no DB writes. Run after every fresh upload; paste the
 * .txt back into the conversation when something looks wrong.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../src/db'

const DATA_DIR = join(process.cwd(), 'apps/api/data')

function rule(width = 75): string {
  return '='.repeat(width)
}
function sub(width = 75): string {
  return '-'.repeat(width)
}
function pad(s: string, n: number): string {
  if (s.length >= n) return s
  return s + ' '.repeat(n - s.length)
}
function fmtNum(v: unknown, digits = 2): string {
  if (v === null || v === undefined) return '—'
  const n = typeof v === 'string' ? Number.parseFloat(v) : (v as number)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-AE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function fmtDuration(startedAt: Date | null, finishedAt: Date | null): string {
  if (!startedAt) return '—'
  const end = finishedAt ?? new Date()
  const ms = end.getTime() - startedAt.getTime()
  if (ms < 1000) return `${ms} ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sr = s % 60
  return `${m}m${sr.toString().padStart(2, '0')}`
}
function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + `… (+${s.length - n} chars)`
}
function jsonish(v: unknown, maxChars = 2000): string {
  try {
    const j = JSON.stringify(v, null, 2)
    return truncate(j, maxChars)
  } catch {
    return String(v).slice(0, maxChars)
  }
}

async function gather(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { organization: { select: { id: true, name: true, slug: true } } },
  })
  if (!project) throw new Error(`Project ${projectId} not found.`)

  const [documents, sheets, jobs, items, flags, corrections, boqs] = await Promise.all([
    prisma.document.findMany({
      where: { projectId, organizationId: project.organizationId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.sheet.findMany({
      where: { organizationId: project.organizationId, document: { projectId } },
      orderBy: { pageNo: 'asc' },
    }),
    prisma.job.findMany({
      where: { organizationId: project.organizationId, projectId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.takeoffItem.findMany({
      where: { organizationId: project.organizationId, projectId, deletedAt: null },
      orderBy: [{ category: 'asc' }, { tag: 'asc' }, { description: 'asc' }],
    }),
    prisma.validationFlag.findMany({
      where: { organizationId: project.organizationId, projectId },
      orderBy: [{ resolved: 'asc' }, { severity: 'desc' }, { createdAt: 'asc' }],
    }),
    prisma.correction.findMany({
      where: { organizationId: project.organizationId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.boq.findMany({
      where: { organizationId: project.organizationId, projectId, deletedAt: null },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: { lines: { orderBy: { sortOrder: 'asc' } } },
        },
      },
      orderBy: { version: 'desc' },
    }),
  ])
  return { project, documents, sheets, jobs, items, flags, corrections, boqs }
}

function renderHeader(project: { id: string; name: string; createdAt: Date; organization: { id: string; name: string; slug: string } }): string {
  return [
    rule(),
    `TAKEOFF DUMP — ${project.name}`,
    `project_id   ${project.id}`,
    `org          ${project.organization.name}  (slug=${project.organization.slug}, id=${project.organization.id})`,
    `created      ${project.createdAt.toISOString()}`,
    `dumped at    ${new Date().toISOString()}`,
    rule(),
    '',
  ].join('\n')
}

function renderDocuments(documents: Array<{ id: string; status: string; storageKey: string; createdAt: Date; mimeType: string | null }>): string {
  const lines: string[] = [`DOCUMENTS (${documents.length})`, sub()]
  for (const d of documents) {
    lines.push(
      `  ${d.id}  status=${d.status}  ${d.createdAt.toISOString()}`,
      `    storageKey: ${d.storageKey}`,
      `    mimeType:   ${d.mimeType ?? '—'}`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

function renderSheets(sheets: Array<{
  id: string
  pageNo: number
  drawingNo: string | null
  title: string | null
  discipline: string | null
  sheetType: string | null
  hasTextLayer: boolean
  rawTextKey: string | null
  imageKey: string | null
  aiJson: unknown
  promptVersion: string | null
}>): string {
  const lines: string[] = [`SHEETS (${sheets.length})`, sub()]
  for (const s of sheets) {
    const flags = `text=${s.hasTextLayer ? 'y' : 'n'} img=${s.imageKey ? 'y' : 'n'} ai=${s.aiJson ? 'y' : 'n'}`
    lines.push(
      `  page ${s.pageNo.toString().padStart(2, '0')}  ${pad(s.drawingNo ?? '-', 8)}  ${pad(s.sheetType ?? '-', 12)}  ${pad(s.discipline ?? '-', 6)}  ${flags}`,
      `    title:        ${s.title ?? '—'}`,
      `    promptVer:    ${s.promptVersion ?? '—'}`,
    )
    if (s.aiJson) {
      lines.push(`    aiJson:       ${truncate(JSON.stringify(s.aiJson), 600)}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function renderJobs(jobs: Array<{
  id: string
  type: string
  status: string
  startedAt: Date | null
  finishedAt: Date | null
  attempts: number
  aiMode: string | null
  aiModel: string | null
  error: string | null
  result: unknown
}>): string {
  const lines: string[] = [`JOBS (${jobs.length})`, sub()]
  for (const j of jobs) {
    const dur = fmtDuration(j.startedAt, j.finishedAt)
    lines.push(
      `  ${pad(j.type, 22)}  ${pad(j.status, 7)}  ${pad(dur, 8)}  att=${j.attempts}  mode=${j.aiMode ?? '—'}  model=${j.aiModel ?? '—'}`,
    )
    if (j.error) lines.push(`    ERROR: ${truncate(j.error, 800)}`)
    if (j.result) lines.push(`    result: ${jsonish(j.result, 1800)}`)
  }
  lines.push('')
  return lines.join('\n')
}

interface ItemMeta {
  kind?: string
  finish_code?: string | null
  finishConfidence?: number | null
  finish_evidence?: string | null
  area_m2?: number | null
  floor?: string | null
  floorNormalized?: string | null
  count?: number | null
  width_mm?: number | null
  height_mm?: number | null
  rawFinishObservation?: { visionCode?: string | null; evidence?: string | null }
  material?: string | null
  usage?: string | null
  name?: string | null
  stub?: boolean
}

interface ItemRow {
  id: string
  category: string
  tag: string | null
  description: string
  unit: string
  qtyAi: unknown
  qtyFinal: unknown
  basis: string
  confidence: number
  status: string
  sourceNote: string | null
  meta: ItemMeta | null
}

function renderLegend(items: ItemRow[]): string {
  const legend = items.filter((i) => (i.meta?.kind ?? '') === 'LEGEND' || i.category === 'OTHER' && i.tag && (i.meta?.kind ?? '') === 'LEGEND')
  const lines: string[] = [`LEGEND (${legend.length} codes)`, sub()]
  for (const l of legend) {
    const m = l.meta ?? {}
    lines.push(`  ${pad(l.tag ?? '-', 6)}  material=${m.material ?? '—'}  usage=${m.usage ?? '—'}  name=${m.name ?? l.description}`)
  }
  lines.push('')
  return lines.join('\n')
}

function renderRooms(items: ItemRow[]): string {
  const rooms = items.filter((i) => i.category === 'ROOM')
  const stmts = items.filter((i) => i.category === 'AREA_STATEMENT')
  const lines: string[] = [`ROOMS  (${rooms.length} billable) + AREA_STATEMENTS (${stmts.length})`, sub()]
  lines.push(`-- ROOM --`)
  for (const r of rooms) {
    const m = r.meta ?? {}
    const area = m.area_m2 != null ? fmtNum(m.area_m2) + ' m²' : '—'
    lines.push(
      `  ${pad(r.description, 48)}  ${pad(area, 12)}  finish=${pad(m.finish_code ?? '—', 6)}  conf=${pad(String(r.confidence), 3)}  basis=${r.basis}`,
    )
    if (m.rawFinishObservation?.visionCode || m.rawFinishObservation?.evidence) {
      const ev = (m.rawFinishObservation.evidence ?? '').replace(/\s+/g, ' ').trim()
      lines.push(`        vision=${m.rawFinishObservation.visionCode ?? '—'}  evidence="${truncate(ev, 160)}"`)
    }
    if (r.sourceNote) lines.push(`        source: ${r.sourceNote}`)
  }
  if (stmts.length > 0) {
    lines.push('')
    lines.push(`-- AREA_STATEMENT (excluded from BOQ) --`)
    for (const s of stmts) {
      const m = s.meta ?? {}
      const area = m.area_m2 != null ? fmtNum(m.area_m2) + ' m²' : '—'
      lines.push(`  ${pad(s.description, 48)}  ${pad(area, 12)}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

function renderSchedules(items: ItemRow[]): string {
  const doors = items.filter((i) => i.category === 'DOOR')
  const windows = items.filter((i) => i.category === 'WINDOW')
  const lines: string[] = [`DOORS (${doors.length}) + WINDOWS (${windows.length})`, sub()]
  if (doors.length > 0) lines.push(`-- DOORS --`)
  for (const d of doors) {
    const m = d.meta ?? {}
    lines.push(
      `  ${pad(d.tag ?? '-', 6)}  count=${pad(String(m.count ?? '-'), 3)}  ${pad(String(m.width_mm ?? '-'), 6)}×${pad(String(m.height_mm ?? '-'), 6)}  basis=${pad(d.basis, 10)}  conf=${d.confidence}`,
    )
  }
  if (windows.length > 0) {
    lines.push('')
    lines.push(`-- WINDOWS --`)
  }
  for (const w of windows) {
    const m = w.meta ?? {}
    lines.push(
      `  ${pad(w.tag ?? '-', 6)}  count=${pad(String(m.count ?? '-'), 3)}  ${pad(String(m.width_mm ?? '-'), 6)}×${pad(String(m.height_mm ?? '-'), 6)}  basis=${pad(w.basis, 10)}  conf=${w.confidence}`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

function renderOther(items: ItemRow[]): string {
  const other = items.filter(
    (i) => !['ROOM', 'AREA_STATEMENT', 'DOOR', 'WINDOW'].includes(i.category) &&
            (i.meta?.kind ?? '') !== 'LEGEND',
  )
  const lines: string[] = [`OTHER ITEMS (${other.length})  — derived finishes, ceilings, etc.`, sub()]
  // Group by category
  const byCat = new Map<string, ItemRow[]>()
  for (const i of other) {
    const list = byCat.get(i.category) ?? []
    list.push(i)
    byCat.set(i.category, list)
  }
  for (const [cat, list] of byCat) {
    lines.push(`-- ${cat} (${list.length}) --`)
    for (const it of list) {
      const qty = it.qtyAi != null ? fmtNum(it.qtyAi as string, 2) : '—'
      lines.push(
        `  ${pad(it.tag ?? '-', 12)}  qty=${pad(qty, 10)} ${it.unit}  conf=${it.confidence}  basis=${it.basis}`,
      )
      if (it.description) lines.push(`        ${truncate(it.description, 200)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

interface FlagRow {
  id: string
  takeoffItemId: string | null
  rule: string
  severity: string
  message: string
  resolved: boolean
  createdAt: Date
}

function renderFlags(flags: FlagRow[]): string {
  const lines: string[] = [`VALIDATION FLAGS (${flags.length}; ${flags.filter((f) => !f.resolved).length} unresolved)`, sub()]
  const unresolved = flags.filter((f) => !f.resolved)
  const projectLevel = unresolved.filter((f) => !f.takeoffItemId)
  const itemLevel = unresolved.filter((f) => !!f.takeoffItemId)
  if (projectLevel.length > 0) lines.push('-- project-level --')
  for (const f of projectLevel) {
    lines.push(`  [${f.severity}] ${pad(f.rule, 24)} ${truncate(f.message.replace(/\s+/g, ' '), 220)}`)
  }
  if (itemLevel.length > 0) lines.push('-- per-item --')
  for (const f of itemLevel) {
    lines.push(`  [${f.severity}] ${pad(f.rule, 24)} item=${f.takeoffItemId?.slice(-8)} ${truncate(f.message.replace(/\s+/g, ' '), 200)}`)
  }
  lines.push('')
  return lines.join('\n')
}

interface CorrectionRow {
  entity: string
  entityId: string
  field: string
  aiValue: string | null
  humanValue: string | null
  reason: string | null
  createdAt: Date
}

function renderCorrections(rows: CorrectionRow[]): string {
  const lines: string[] = [`CORRECTIONS (${rows.length}, org-wide)`, sub()]
  for (const c of rows) {
    lines.push(
      `  ${c.createdAt.toISOString()}  ${pad(c.entity, 12)}.${pad(c.field, 16)}  ai=${truncate(c.aiValue ?? '—', 24)}  →  human=${truncate(c.humanValue ?? '—', 24)}`,
    )
    if (c.reason) lines.push(`        reason: ${truncate(c.reason, 200)}`)
  }
  lines.push('')
  return lines.join('\n')
}

interface BoqRow {
  id: string
  version: number
  status: string
  currency: string
  subtotal: unknown
  totalProvisional: unknown
  sections: Array<{
    code: string
    title: string
    subtotal: unknown
    lines: Array<{
      itemRef: string
      description: string
      unit: string
      qty: unknown
      rate: unknown
      rateSource: string | null
      amount: unknown
      isProvisional: boolean
      psAmount: unknown
      confidence: number | null
    }>
  }>
}

function renderBoqs(boqs: BoqRow[]): string {
  const lines: string[] = [`BOQs (${boqs.length}; latest first)`, sub()]
  for (const boq of boqs) {
    lines.push(`-- v${boq.version}  status=${boq.status}  currency=${boq.currency}  subtotal=${fmtNum(boq.subtotal)}  P/S=${fmtNum(boq.totalProvisional)}`)
    for (const sec of boq.sections) {
      lines.push(`  ${sec.code}  ${sec.title}   (section subtotal: ${fmtNum(sec.subtotal)})`)
      for (const ln of sec.lines) {
        const qty = ln.qty != null ? fmtNum(ln.qty, 2) : '—'
        const rate = ln.isProvisional ? 'P/S' : (ln.rate != null ? fmtNum(ln.rate, 2) : '—')
        const amt = ln.isProvisional
          ? (ln.psAmount != null ? fmtNum(ln.psAmount, 2) + ' (P/S)' : 'P/S')
          : (ln.amount != null ? fmtNum(ln.amount, 2) : '—')
        lines.push(
          `    ${pad(ln.itemRef, 10)} ${pad(ln.unit, 4)}  qty=${pad(qty, 9)}  rate=${pad(rate, 12)}  amount=${pad(amt, 18)}  rateSrc=${ln.rateSource ?? '—'}  conf=${ln.confidence ?? '—'}`,
        )
        lines.push(`        ${truncate(ln.description, 220)}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const projectId = args.find((a) => !a.startsWith('--'))
  if (!projectId) {
    console.error('Usage: bun apps/api/scripts/dump-takeoff.ts <projectId> [--out=<path>]')
    process.exit(2)
  }
  const outFlag = args.find((a) => a.startsWith('--out='))
  const outPath = outFlag
    ? outFlag.slice('--out='.length)
    : join(DATA_DIR, `takeoff-dump-${projectId}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.txt`)

  const data = await gather(projectId)
  const body = [
    renderHeader(data.project as never),
    renderDocuments(data.documents as never),
    renderSheets(data.sheets as never),
    renderJobs(data.jobs as never),
    renderLegend(data.items as never),
    renderRooms(data.items as never),
    renderSchedules(data.items as never),
    renderOther(data.items as never),
    renderFlags(data.flags as never),
    renderCorrections(data.corrections as never),
    renderBoqs(data.boqs as never),
  ].join('\n')

  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(outPath, body, 'utf-8')
  console.log(`Wrote ${body.length.toLocaleString()} chars to ${outPath}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
