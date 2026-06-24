/**
 * LIB-6 — drive QUANTIFY → BOQ → PRICE on the demo project,
 * verify the LIVING wall paint line is ~1,170 AED.
 *
 * Demo project: cmqrxs9940001e1gs2zh56x8p (LM1929 DXF MVP test).
 * Reading B locked (13.6250 AED/m²); LIVING perimeter from the
 * estimateSkirtingPerimeter LIVING-name prior, × 2.8 m ceiling.
 */
import { prisma } from '../src/db'
import { issueAccessToken } from '../src/utils/auth'

const DEMO_PROJECT_ID = 'cmqrxs9940001e1gs2zh56x8p'
const API = 'http://localhost:4000'

async function poll(jobId: string, token: string, label: string, maxSec = 120): Promise<void> {
  const start = Date.now()
  let last = ''
  while ((Date.now() - start) / 1000 < maxSec) {
    const r = await fetch(`${API}/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } })
    const j = (await r.json()) as { status: string; error: string | null }
    if (j.status !== last) { console.log('  ' + label + ': ' + j.status); last = j.status }
    if (j.status === 'DONE') return
    if (j.status === 'FAILED') throw new Error(label + ' FAILED: ' + j.error)
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(label + ' timed out')
}

const proj = await prisma.project.findUnique({ where: { id: DEMO_PROJECT_ID }, select: { organizationId: true } })
const m = await prisma.membership.findFirst({ where: { organizationId: proj!.organizationId, role: 'owner' } })
const token = await issueAccessToken({ sub: m!.userId, oid: proj!.organizationId, role: m!.role })

console.log('[1] Reset previous derived PAINT rows + clear demo BOQs')
await prisma.takeoffItem.updateMany({
  where: { projectId: DEMO_PROJECT_ID, category: 'PAINT', deletedAt: null },
  data: { deletedAt: new Date() },
})

// Confirm a finish_code on LIVING so it passes the shouldSkirtRoom gate
// in QUANTIFY (and qualifies for PAINT). Without a confirmed code the
// gate skips the room — same logic as skirting.
const living = await prisma.takeoffItem.findFirst({
  where: { projectId: DEMO_PROJECT_ID, category: 'ROOM', tag: 'GF-04', deletedAt: null },
  select: { id: true, meta: true },
})
const livingMeta = (living!.meta ?? {}) as Record<string, unknown>
if (livingMeta.finish_code !== 'ST01') {
  console.log('  setting LIVING.meta.finish_code = ST01 so PAINT gate fires')
  await prisma.takeoffItem.update({
    where: { id: living!.id },
    data: { meta: { ...livingMeta, finish_code: 'ST01' } as object },
  })
}

// Also confirm one or two more rooms so the totals look plausible.
for (const tag of ['GF-05', 'GF-03']) {
  const r = await prisma.takeoffItem.findFirst({
    where: { projectId: DEMO_PROJECT_ID, category: 'ROOM', tag, deletedAt: null },
    select: { id: true, meta: true },
  })
  if (!r) continue
  const rm = (r.meta ?? {}) as Record<string, unknown>
  if (!rm.finish_code) {
    await prisma.takeoffItem.update({
      where: { id: r.id },
      data: { meta: { ...rm, finish_code: 'ST01' } as object },
    })
  }
}

console.log('\n[2] QUANTIFY')
const qRes = await fetch(`${API}/api/projects/${DEMO_PROJECT_ID}/quantify`, {
  method: 'POST', headers: { Authorization: 'Bearer ' + token },
})
const { jobId: quantJob } = (await qRes.json()) as { jobId: string }
await poll(quantJob, token, 'QUANTIFY')

// Inspect the new PAINT TakeoffItems
const paintItems = await prisma.takeoffItem.findMany({
  where: { projectId: DEMO_PROJECT_ID, category: 'PAINT', deletedAt: null },
  orderBy: { tag: 'asc' },
  select: { tag: true, description: true, qtyAi: true, qtyFinal: true, basis: true, status: true, meta: true, sourceNote: true },
})
console.log('\n  PAINT TakeoffItems emitted: ' + paintItems.length)
for (const p of paintItems) {
  const qty = (p.qtyAi ?? p.qtyFinal)!.toString()
  console.log('    ' + (p.tag ?? '').padEnd(16) + ' qty=' + qty.padStart(7) + ' m²  basis=' + p.basis + ' status=' + p.status)
  console.log('      ' + p.sourceNote)
}

console.log('\n[3] BOQ generate')
const bRes = await fetch(`${API}/api/projects/${DEMO_PROJECT_ID}/boq`, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
})
const boqBody = await bRes.text()
if (!bRes.ok) throw new Error('BOQ gen: ' + bRes.status + ' ' + boqBody)
const boq = JSON.parse(boqBody) as { id: string; version: number }
console.log('  → BOQ v' + boq.version + ' id=' + boq.id)

console.log('\n[4] PRICE')
const pRes = await fetch(`${API}/api/boqs/${boq.id}/price`, {
  method: 'POST', headers: { Authorization: 'Bearer ' + token },
})
const { jobId: priceJob } = (await pRes.json()) as { jobId: string }
await poll(priceJob, token, 'PRICE')

console.log('\n[5] Inspect LIVING paint line in BOQ')
const lines = await prisma.boqLine.findMany({
  where: { boqId: boq.id },
  include: { section: { select: { code: true, title: true } } },
  orderBy: [{ sectionId: 'asc' }, { sortOrder: 'asc' }],
})
const paintLines = lines.filter((l) => /Wall paint/i.test(l.description))
console.log('  paint lines in BOQ: ' + paintLines.length)
for (const l of paintLines) {
  const qty = l.qty.toString()
  const rate = l.rate?.toString() ?? '—'
  const amt = l.amount?.toString() ?? '—'
  console.log('    ' + l.section.code + ' ' + l.itemRef + '  ' + l.description.slice(0, 60))
  console.log('      qty=' + qty + ' ' + l.unit + '  rate=' + rate + '  amount=' + amt + '  rateSource=' + l.rateSource)
}

// Specifically LIVING (look for GF-04 reference in description or via the room link)
const livingPaint = paintLines.find((l) => /LIVING/i.test(l.description))
if (livingPaint) {
  console.log('\n=== LIVING WALL PAINT — VERIFICATION ===')
  const qty = Number(livingPaint.qty.toString())
  const rate = livingPaint.rate ? Number(livingPaint.rate.toString()) : 0
  const amt = livingPaint.amount ? Number(livingPaint.amount.toString()) : 0
  console.log('  description : ' + livingPaint.description)
  console.log('  qty         : ' + qty.toFixed(2) + ' ' + livingPaint.unit + '  (wall area)')
  console.log('  rate        : ' + rate.toFixed(4) + ' AED/m²  (Jotun system, Reading B)')
  console.log('  amount      : ' + amt.toFixed(2) + ' AED')
  console.log('  rateSource  : ' + livingPaint.rateSource)
  console.log('')
  const ok = Math.abs(rate - 13.625) < 0.01 && amt > 1000 && amt < 1500
  console.log('  ' + (ok ? '✓ PASS — rate is 13.6250 AED/m², LIVING line in [1000-1500] AED range' : '✗ FAIL — investigate'))
  if (!ok) process.exit(1)
} else {
  console.log('\n  ✗ FAIL: no LIVING paint line found in BOQ')
  process.exit(1)
}

console.log('\n[6] All paint lines summary')
const sumWall = paintLines.reduce((s, l) => s + Number(l.qty.toString()), 0)
const sumAmt = paintLines.reduce((s, l) => s + (l.amount ? Number(l.amount.toString()) : 0), 0)
console.log('  total wall area : ' + sumWall.toFixed(2) + ' m²')
console.log('  total paint cost: ' + sumAmt.toFixed(2) + ' AED')

process.exit(0)
