/**
 * Sprint-7 S7-5 debug: re-run extractFinishLegend on each I4xx sheet of a
 * given document and dump the RAW vision response so we can see what's being
 * dropped by the regex filter.
 *
 *   bun scripts/debug-legend.ts <documentId>
 */
import { extractFinishLegend, STUB_SUFFIX } from '../src/ai/anthropic'
import { getBlobStore } from '../src/blob/fs'
import { prisma } from '../src/db'

const docId = process.argv[2]
if (!docId) {
  console.error('usage: bun scripts/debug-legend.ts <documentId>')
  process.exit(2)
}

const document = await prisma.document.findUnique({ where: { id: docId } })
if (!document) {
  console.error('document not found:', docId)
  process.exit(2)
}

const sheets = await prisma.sheet.findMany({
  where: {
    documentId: docId,
    sheetType: { in: ['finish_plan', 'legend'] },
  },
  orderBy: { pageNo: 'asc' },
})

const blob = getBlobStore()
let totalIn = 0
let totalOut = 0
const LEGEND_CODE_RE = /^[A-Z]{2}\d{2}$/

for (const sheet of sheets) {
  if (!/^I4\d{2}\b/i.test(sheet.drawingNo ?? '')) continue
  const jpegBase64 = sheet.imageKey
    ? await blob.get(sheet.imageKey).then((b) => b.toString('base64')).catch(() => null)
    : null
  const textSnippet = sheet.rawTextKey
    ? (await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')).slice(0, 4000)
    : ''
  const result = await extractFinishLegend({
    documentId: docId,
    pageNo: sheet.pageNo,
    jpegBase64,
    textSnippet,
  })
  totalIn += result.tokensIn
  totalOut += result.tokensOut
  const stub = result.promptVersion.endsWith(STUB_SUFFIX)
  console.log(`\n=== ${sheet.drawingNo} (page ${sheet.pageNo}) ${stub ? '[STUB]' : '[LIVE]'} ===`)
  console.log(`  tokens in=${result.tokensIn} out=${result.tokensOut}`)
  console.log(`  rows returned: ${result.rows.length}`)
  for (const r of result.rows) {
    const code = (r.code ?? '').trim().toUpperCase()
    const pass = code === 'BATHROOM' || LEGEND_CODE_RE.test(code)
    console.log(
      `  ${pass ? '✓' : '✗'} code="${r.code}" name="${r.name ?? ''}" kind=${r.kind ?? ''} material="${(r.material ?? '').slice(0, 50)}"`,
    )
  }
}

console.log(`\n--- total: in=${totalIn} out=${totalOut} cost=$${((totalIn/1e6)*3 + (totalOut/1e6)*15).toFixed(3)}`)
process.exit(0)
