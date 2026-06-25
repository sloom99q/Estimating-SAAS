/**
 * VERIFY — run the deterministic auditor on a BOQ and produce an
 * XLSX report. No LLM calls — pure structural verification.
 *
 *   bun apps/api/scripts/audit-boq.ts <projectId>
 *     OR
 *   bun apps/api/scripts/audit-boq.ts --boq <boqId>
 *
 * Output: stdout summary + an .xlsx file in the repo root.
 */
import { writeFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { prisma } from '../src/db'
import { auditLine, summarize, type AuditableLine } from '../src/pricing/auditLine'
import { parseProvenance } from '../src/pricing/lineProvenance'

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
  if (!latest) {
    console.error('no BOQ found for project ' + projectId)
    process.exit(1)
  }
  boqId = latest.id
  projectLabel = latest.project.name
  version = latest.version
} else {
  const b = await prisma.boq.findUnique({ where: { id: boqId }, include: { project: { select: { name: true } } } })
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
console.log(`[audit] ${lines.length} lines to audit`)

const results = lines.map((l) => {
  const auditable: AuditableLine = {
    id: l.id,
    itemRef: l.itemRef,
    description: l.description,
    isProvisional: l.isProvisional,
    confidence: l.confidence,
    takeoffItemId: l.takeoffItemId,
    provenance: parseProvenance(l.provenance),
  }
  return {
    line: auditable,
    sectionCode: l.section.code,
    sectionTitle: l.section.title,
    result: auditLine(auditable),
    raw: l,
  }
})

const summary = summarize(results.map((r) => ({ line: r.line, sectionCode: r.sectionCode, result: r.result })))

console.log('')
console.log(`=== AUDIT SUMMARY ===`)
console.log(`  TOTAL    ${summary.total}`)
console.log(`  ✓ verified ${summary.verified}`)
console.log(`  ⚠ review   ${summary.review}`)
console.log(`  ✗ failed   ${summary.failed}`)
console.log('')
console.log('  by sourceType:')
for (const [st, counts] of Object.entries(summary.bySourceType)) {
  console.log(`    ${st.padEnd(10)} ✓${counts.verified.toString().padStart(4)}  ⚠${counts.review.toString().padStart(4)}  ✗${counts.failed.toString().padStart(4)}`)
}
console.log('')
console.log('  by section:')
for (const [sc, counts] of Object.entries(summary.bySection)) {
  console.log(`    ${sc.padEnd(6)} ✓${counts.verified.toString().padStart(4)}  ⚠${counts.review.toString().padStart(4)}  ✗${counts.failed.toString().padStart(4)}`)
}
console.log('')
console.log('  top issue reasons:')
for (const r of summary.topFailReasons.slice(0, 5)) {
  console.log(`    × ${r.count.toString().padStart(4)}  ${r.reason}`)
}

// ── XLSX report ────────────────────────────────────────────────
const wb = new ExcelJS.Workbook()

const sum = wb.addWorksheet('Summary')
sum.columns = [{ width: 24 }, { width: 18 }, { width: 18 }, { width: 18 }]
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
sum.addRow(['By section', 'verified', 'review', 'failed']).font = { bold: true }
for (const [sc, c] of Object.entries(summary.bySection)) sum.addRow([sc, c.verified, c.review, c.failed])
sum.addRow([])
sum.addRow(['Top issue reasons', 'count']).font = { bold: true }
for (const r of summary.topFailReasons) sum.addRow([r.reason, r.count])

// Per-line tabs
function tab(name: string, rows: typeof results) {
  const sh = wb.addWorksheet(name)
  sh.columns = [
    { width: 8 },        // ItemRef
    { width: 12 },        // Section
    { width: 48 },        // Description
    { width: 10 },        // SourceType
    { width: 9 },         // Status
    { width: 9 },         // Confidence
    { width: 36 },        // Evidence
    { width: 36 },        // Formula
    { width: 36 },        // Reasoning
    { width: 36 },        // Reasons
    { width: 12 },        // Amount
    { width: 12 },        // P/S
  ]
  sh.addRow(['ItemRef','Section','Description','SourceType','Status','Confidence','Evidence','Formula','Reasoning','Audit reasons','Amount','P/S amount']).font = { bold: true }
  for (const r of rows) {
    const p = r.line.provenance
    const evidenceStr = p ? p.evidence.map((e) => describeEvidence(e)).join(' · ') : ''
    const reasonsStr = r.result.reasons.join(' · ')
    sh.addRow([
      r.line.itemRef,
      r.sectionCode,
      r.line.description.slice(0, 120),
      p?.sourceType ?? '',
      r.result.status,
      r.line.confidence ?? p?.confidence ?? '',
      evidenceStr,
      p?.formula ?? '',
      p?.reasoning ?? '',
      reasonsStr,
      r.raw.amount?.toString() ?? '',
      r.raw.psAmount?.toString() ?? '',
    ])
  }
  // Alternating row tint by status
  sh.eachRow({ includeEmpty: false }, (row, ix) => {
    if (ix === 1) return
    const status = row.getCell(5).value
    let argb: string | null = null
    if (status === 'failed') argb = 'FFFCE4E4'
    else if (status === 'review') argb = 'FFFFF8DC'
    if (argb) row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } } })
  })
}

function describeEvidence(e: any): string {
  switch (e.kind) {
    case 'sheet': return `sheet ${e.drawingNo ?? e.sheetId.slice(-6)}` + (e.pageNo ? ` p${e.pageNo}` : '')
    case 'takeoffItem': return `takeoff ${e.tag ?? e.takeoffItemId.slice(-6)} (${e.category})`
    case 'document': return `doc ${e.filename}` + (e.pageNo ? ` p${e.pageNo}` : '')
    case 'rateLibrary': return `rate-lib:${e.scope}:${e.code}`
    case 'assembly': return `assembly:${e.name ?? e.assemblyId.slice(-6)}` + (e.brandName ? ` (${e.brandName})` : '')
    case 'user': return `user:${e.userId.slice(-6)} at ${e.at?.slice(0, 16)}`
    case 'mepRule': return `mep-rule:${e.name ?? e.ruleId.slice(-6)}`
    case 'legacy': return `legacy: ${(e.note ?? '').slice(0, 60)}`
    default: return JSON.stringify(e).slice(0, 60)
  }
}

tab('All lines',  results)
tab('Failed',     results.filter((r) => r.result.status === 'failed'))
tab('Review',     results.filter((r) => r.result.status === 'review'))
tab('Verified',   results.filter((r) => r.result.status === 'verified'))

const filename = `/Users/salemalazzawi/Desktop/Estimating SAAS/audit-${projectLabel.replace(/[^a-z0-9]+/gi, '_')}-v${version}-2026-06-25.xlsx`
const buf = await wb.xlsx.writeBuffer()
writeFileSync(filename, Buffer.from(buf as ArrayBuffer))
console.log('')
console.log('saved: ' + filename)
process.exit(0)
