/**
 * VERIFY — run the deterministic auditor pipeline on a BOQ + write
 * verificationStatus back per line + produce an XLSX report.
 *
 *   bun apps/api/scripts/audit-boq.ts <projectId>
 *   bun apps/api/scripts/audit-boq.ts --boq <boqId>
 *
 * No LLM calls — pure structural verification + confidence threshold.
 * Writes BoqLine.verificationStatus ('VERIFIED' | 'FLAGGED' for
 * review/failed) so the SPA review queue reads the cached state
 * without re-running.
 */
import { writeFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { prisma } from '../src/db'
import { auditLineWithModules, summarize, toAuditInput } from '../src/pricing/auditor'

const boqIdx = process.argv.indexOf('--boq')
const explicitBoqId = boqIdx >= 0 ? process.argv[boqIdx + 1] : null
const projectId = process.argv.find((a, i) => i > 1 && !a.startsWith('--') && process.argv[i - 1] !== '--boq')

let boqId = explicitBoqId
let projectLabel = ''
let version = 0

if (!boqId) {
  if (!projectId) {
    console.error('usage: bun audit-boq.ts <projectId>  OR  bun audit-boq.ts --boq <boqId>')
    process.exit(1)
  }
  const latest = await prisma.boq.findFirst({
    where: { projectId, deletedAt: null },
    orderBy: { version: 'desc' },
    include: { project: { select: { name: true } } },
  })
  if (!latest) { console.error('no BOQ found for project ' + projectId); process.exit(1) }
  boqId = latest.id
  projectLabel = latest.project.name
  version = latest.version
} else {
  const b = await prisma.boq.findUnique({
    where: { id: boqId },
    include: { project: { select: { name: true } } },
  })
  if (!b) { console.error('boq not found'); process.exit(1) }
  projectLabel = b.project.name
  version = b.version
}

console.log(`[audit] BOQ ${boqId.slice(-8)} (${projectLabel} v${version})`)

const lines = await prisma.boqLine.findMany({
  where: { boqId },
  include: { section: { select: { code: true, title: true } } },
  orderBy: [{ section: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
})
console.log(`[audit] ${lines.length} lines to audit through ${'AUDIT_MODULES'} pipeline`)

const perLine = lines.map((l) => {
  const input = toAuditInput(l)
  const result = auditLineWithModules(input)
  return { input, sectionCode: l.section.code, sectionTitle: l.section.title, result, raw: l }
})

// Write verificationStatus back on every line — FLAGGED if status
// is anything except 'verified'. (Review and failed both surface
// in the SPA queue as needing the estimator's eyes.)
let updated = 0
for (const r of perLine) {
  const status = r.result.status === 'verified' ? 'VERIFIED' : 'FLAGGED'
  await prisma.boqLine.update({
    where: { id: r.input.id },
    data: {
      verificationStatus: status,
      verificationDetail: {
        status: r.result.status,
        modules: r.result.modules.map((m) => ({
          module: m.module,
          verdict: m.verdict,
          reasons: m.reasons,
        })),
      } as object,
    },
  })
  updated += 1
}
console.log(`[audit] wrote verificationStatus on ${updated} lines`)

const summary = summarize(perLine)

console.log('')
console.log(`=== AUDIT SUMMARY ===`)
console.log(`  TOTAL     ${summary.total}`)
console.log(`  ✓ verified ${summary.verified}`)
console.log(`  ⚠ review   ${summary.review}`)
console.log(`  ✗ failed   ${summary.failed}`)
console.log('')
console.log('  by sourceType:')
for (const [st, c] of Object.entries(summary.bySourceType)) {
  console.log(`    ${st.padEnd(10)} ✓${c.verified.toString().padStart(4)}  ⚠${c.review.toString().padStart(4)}  ✗${c.failed.toString().padStart(4)}`)
}
console.log('')
console.log('  by derivationType:')
for (const [dt, c] of Object.entries(summary.byDerivationType)) {
  console.log(`    ${dt.padEnd(14)} ✓${c.verified.toString().padStart(4)}  ⚠${c.review.toString().padStart(4)}  ✗${c.failed.toString().padStart(4)}`)
}
console.log('')
console.log('  by section:')
for (const [sc, c] of Object.entries(summary.bySection)) {
  console.log(`    ${sc.padEnd(6)} ✓${c.verified.toString().padStart(4)}  ⚠${c.review.toString().padStart(4)}  ✗${c.failed.toString().padStart(4)}`)
}
console.log('')
console.log('  top reasons:')
for (const r of summary.topReasons.slice(0, 8)) {
  console.log(`    × ${r.count.toString().padStart(4)}  [${r.module}] ${r.reason.slice(r.module.length + 2, 120)}`)
}

// ─── XLSX report ────────────────────────────────────────────────
const wb = new ExcelJS.Workbook()

const sum = wb.addWorksheet('Summary')
sum.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 14 }]
sum.addRow([`Verification report — ${projectLabel} v${version}`]).font = { bold: true, size: 14 }
sum.addRow([`Generated`, new Date().toISOString().slice(0, 19)])
sum.addRow([])
sum.addRow(['Status', 'Count', 'Share']).font = { bold: true }
for (const [k, v] of [['verified', summary.verified], ['review', summary.review], ['failed', summary.failed]] as const) {
  const share = summary.total > 0 ? (v / summary.total) * 100 : 0
  sum.addRow([k, v, share.toFixed(1) + '%'])
}
sum.addRow([])
sum.addRow(['By sourceType', 'verified', 'review', 'failed']).font = { bold: true }
for (const [st, c] of Object.entries(summary.bySourceType)) sum.addRow([st, c.verified, c.review, c.failed])
sum.addRow([])
sum.addRow(['By derivationType', 'verified', 'review', 'failed']).font = { bold: true }
for (const [dt, c] of Object.entries(summary.byDerivationType)) sum.addRow([dt, c.verified, c.review, c.failed])
sum.addRow([])
sum.addRow(['By section', 'verified', 'review', 'failed']).font = { bold: true }
for (const [sc, c] of Object.entries(summary.bySection)) sum.addRow([sc, c.verified, c.review, c.failed])
sum.addRow([])
sum.addRow(['Top reasons', 'count', 'module']).font = { bold: true }
for (const r of summary.topReasons) sum.addRow([r.reason.slice(r.module.length + 2), r.count, r.module])

function tab(name: string, rows: typeof perLine) {
  const sh = wb.addWorksheet(name)
  sh.columns = [
    { width: 8 }, { width: 8 }, { width: 48 }, { width: 10 }, { width: 14 },
    { width: 10 }, { width: 9 }, { width: 36 }, { width: 36 }, { width: 36 }, { width: 36 },
    { width: 12 }, { width: 12 },
  ]
  sh.addRow([
    'ItemRef', 'Sec', 'Description', 'SourceType', 'DerivationType',
    'Status', 'Conf', 'Evidence', 'Formula / Rule / Reasoning',
    'Audit reasons (module: detail)', 'StampedBy', 'Amount', 'P/S',
  ]).font = { bold: true }
  for (const r of rows) {
    const p = r.input.provenance
    const evidenceStr = p ? p.evidence.map(describeEvidence).join(' · ') : ''
    const derivStr =
      p?.derivationType === 'formula' ? `f: ${p.formula ?? ''}`
        : p?.derivationType === 'rule' ? `r: ${p.ruleRef ?? ''}`
        : p?.derivationType === 'ai_reasoning' ? `ai: ${p.reasoning ?? ''}`
        : (p?.reasoning ?? '')
    const reasonsStr = r.result.modules
      .flatMap((m) => m.reasons.map((rs) => `[${m.module}] ${rs}`))
      .join(' · ')
    sh.addRow([
      r.input.itemRef,
      r.sectionCode,
      r.input.description.slice(0, 120),
      p?.sourceType ?? '',
      p?.derivationType ?? '',
      r.result.status,
      p?.confidence != null ? p.confidence.toFixed(2) : (r.input.confidence ?? ''),
      evidenceStr,
      derivStr,
      reasonsStr,
      p?.stampedBy ?? '',
      r.raw.amount?.toString() ?? '',
      r.raw.psAmount?.toString() ?? '',
    ])
  }
  sh.eachRow({ includeEmpty: false }, (row, ix) => {
    if (ix === 1) return
    const status = row.getCell(6).value
    let argb: string | null = null
    if (status === 'failed') argb = 'FFFCE4E4'
    else if (status === 'review') argb = 'FFFFF8DC'
    if (argb) row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } } })
  })
}

function describeEvidence(e: any): string {
  switch (e.kind) {
    case 'sheet':
      return `sheet ${e.drawingNo ?? e.sheetId.slice(-6)}` +
        (e.pageNo ? ` p${e.pageNo}` : '') +
        (e.bbox ? ` @[${e.bbox.x.toFixed(0)},${e.bbox.y.toFixed(0)}]` : '') +
        (e.extractedValue ? ` "${e.extractedValue.slice(0, 40)}"` : '')
    case 'takeoffItem': return `takeoff ${e.tag ?? e.takeoffItemId.slice(-6)} (${e.category})`
    case 'document': return `doc ${e.filename}` + (e.pageNo ? ` p${e.pageNo}` : '')
    case 'rateLibrary': return `rate-lib:${e.scope}:${e.code}`
    case 'assembly': return `assembly:${e.name ?? e.assemblyId.slice(-6)}` + (e.brandName ? ` (${e.brandName})` : '')
    case 'user': return `user:${e.userId.slice(-6)} at ${e.at?.slice(0, 16)}`
    case 'mepRule': return `mep-rule:${e.name ?? e.ruleId.slice(-6)}`
    case 'import': return `import:${e.importType} from ${e.sourceLabel}`
    case 'legacy': return `legacy: ${(e.note ?? '').slice(0, 60)}`
    default: return JSON.stringify(e).slice(0, 60)
  }
}

tab('All lines', perLine)
tab('Failed', perLine.filter((r) => r.result.status === 'failed'))
tab('Review', perLine.filter((r) => r.result.status === 'review'))
tab('Verified', perLine.filter((r) => r.result.status === 'verified'))

const filename = `/Users/salemalazzawi/Desktop/Estimating SAAS/audit-${projectLabel.replace(/[^a-z0-9]+/gi, '_')}-v${version}-2026-06-25b.xlsx`
const buf = await wb.xlsx.writeBuffer()
writeFileSync(filename, Buffer.from(buf as ArrayBuffer))
console.log('')
console.log('saved: ' + filename)
process.exit(0)
