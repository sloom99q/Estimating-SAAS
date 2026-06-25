/**
 * BOQ → XLSX exporter (Sprint 3 S3-5).
 *
 * Each section has its own collection page; a final Summary sheet aggregates
 * section subtotals + discount + grand total. Every export — client or
 * internal — carries the disclaimer row:
 *
 *   "AI-assisted quantities — verify before contractual use."
 *
 * Internal mode (`includeInternal=true`) adds two extra columns (CONFIDENCE,
 * SOURCE) so reviewers can audit rate provenance. Client mode hides those.
 */
import ExcelJS from 'exceljs'

const DISCLAIMER =
  'AI-assisted quantities — verify before contractual use.'

const AED_FORMAT = '#,##0.00;(#,##0.00);"—"'

export interface XlsxLine {
  itemRef: string
  description: string
  unit: string
  qty: string | null
  rate: string | null
  rateSource: string | null
  amount: string | null
  isProvisional: boolean
  psAmount: string | null
  confidence: number | null
}

export interface XlsxSection {
  code: string
  title: string
  subtotal: string | null
  lines: XlsxLine[]
}

export interface XlsxBoq {
  projectName: string
  version: number
  currency: string
  subtotal: string | null
  totalProvisional: string | null
  sections: XlsxSection[]
}

export interface XlsxOptions {
  includeInternal?: boolean
  /** Optional commercial overrides applied by the Quotation route. */
  discount?: string | null
  vatPct?: string | null
  /** Reference the project name with this client. */
  clientName?: string
  /** Quotation reference (Qo/YYYYMM/serial Rev-NN), shown on the summary. */
  ref?: string
}

function num(v: string | null | undefined): number {
  if (v == null || v === '') return 0
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export async function renderBoqXlsx(boq: XlsxBoq, options: XlsxOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Estimator'
  wb.created = new Date()

  const headers = options.includeInternal
    ? ['ITEM REF', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT', 'CONFIDENCE', 'SOURCE']
    : ['ITEM REF', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT']

  // Per-section "collection" pages.
  for (const section of boq.sections) {
    const sheet = wb.addWorksheet(safeTabName(`${section.code} ${section.title}`))
    sheet.columns = (options.includeInternal
      ? [
          { width: 14 },
          { width: 56 },
          { width: 8 },
          { width: 12 },
          { width: 14 },
          { width: 16 },
          { width: 10 },
          { width: 28 },
        ]
      : [{ width: 14 }, { width: 56 }, { width: 8 }, { width: 12 }, { width: 14 }, { width: 16 }])

    // Title + disclaimer.
    sheet.addRow([`${section.code} ${section.title}`])
    sheet.lastRow!.font = { bold: true, size: 13 }
    sheet.addRow([DISCLAIMER])
    sheet.lastRow!.font = { italic: true, color: { argb: 'FFB00000' } }
    sheet.addRow([])

    const headerRow = sheet.addRow(headers)
    headerRow.font = { bold: true }
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' },
      }
      cell.border = { bottom: { style: 'thin' } }
    })

    for (const line of section.lines) {
      // ADR-014: P/S amount cell prints '—' when psAmount is null. Renders
      // tidy and tells the commercial team explicitly that the carry must
      // be entered. Zero used to look like an answer.
      const amountCell = line.isProvisional
        ? line.psAmount === null
          ? '—'
          : num(line.psAmount)
        : num(line.amount)
      const row = options.includeInternal
        ? [
            line.itemRef,
            line.description,
            line.unit,
            num(line.qty),
            line.isProvisional ? 'P/S' : num(line.rate),
            amountCell,
            line.confidence ?? '',
            line.rateSource ?? '',
          ]
        : [
            line.itemRef,
            line.description,
            line.unit,
            num(line.qty),
            line.isProvisional ? 'P/S' : num(line.rate),
            amountCell,
          ]
      const xlsRow = sheet.addRow(row)
      xlsRow.getCell(4).numFmt = '#,##0.00'
      if (!line.isProvisional) {
        xlsRow.getCell(5).numFmt = AED_FORMAT
      }
      xlsRow.getCell(6).numFmt = AED_FORMAT
    }
    sheet.addRow([])
    // PF-1 — derive the section subtotal from the line data instead of
    // trusting section.subtotal. The pre-gate F1 patch (marking the
    // stair line P/S in-place) decremented boq.subtotal but missed
    // section.subtotal, so the existing v6 had a stale 170,874.70 in
    // the section row that doubled into the GRAND TOTAL. Computing
    // from lines on render keeps the AMOUNT total honest no matter
    // what state the section row is in.
    //
    // BUG-2 fix (2026-06-25) — render three subtotal rows per
    // section so P/S is visible at the section level too:
    //   "Subtotal — priced"     priced lines only (existing)
    //   "Subtotal — P/S"        sum of psAmount on P/S lines
    //   "Section total"         priced + P/S
    // The estimator was reading the prior "Subtotal — priced only"
    // as the section's full total and missing 590k of P/S.
    const sectionPriced = section.lines
      .filter((l) => !l.isProvisional)
      .reduce((sum, l) => sum + num(l.amount), 0)
    const sectionPs = section.lines
      .filter((l) => l.isProvisional)
      .reduce((sum, l) => sum + (l.psAmount === null ? 0 : num(l.psAmount)), 0)
    const sectionTotal = sectionPriced + sectionPs

    const pricedRow = sheet.addRow([
      '', '', '', '',
      `Subtotal — ${section.code} priced`,
      sectionPriced,
    ])
    pricedRow.getCell(5).font = { italic: true }
    pricedRow.getCell(6).numFmt = AED_FORMAT

    if (sectionPs > 0) {
      const psRow = sheet.addRow([
        '', '', '', '',
        `Subtotal — ${section.code} P/S`,
        sectionPs,
      ])
      psRow.getCell(5).font = { italic: true }
      psRow.getCell(6).numFmt = AED_FORMAT
    }

    const totalRow = sheet.addRow([
      '', '', '', '',
      `Section ${section.code} total (priced + P/S)`,
      sectionTotal,
    ])
    totalRow.getCell(5).font = { bold: true }
    totalRow.getCell(6).font = { bold: true }
    totalRow.getCell(6).numFmt = AED_FORMAT
  }

  // Summary sheet.
  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 26 }, { width: 64 }, { width: 18 }]
  summary.addRow([`Bill of Quantities — ${boq.projectName} (v${boq.version})`])
  summary.lastRow!.font = { bold: true, size: 14 }
  if (options.ref) {
    summary.addRow(['Quotation ref', '', options.ref])
  }
  if (options.clientName) {
    summary.addRow(['Client', '', options.clientName])
  }
  summary.addRow(['Currency', '', boq.currency])
  // PF-2 — explicit scope label so a finishes-only export isn't mistaken
  // for a complete quote. We detect "completeness" by looking for the
  // doors/windows section (2.8); if missing, the file is Finishes-only.
  const sectionCodes = new Set(boq.sections.map((s) => s.code))
  const hasDoorsWindows = Array.from(sectionCodes).some((c) => c.startsWith('2.8'))
  if (!hasDoorsWindows) {
    summary.addRow([
      'Scope',
      'FINISHES-ONLY EXPORT — Section 2.8 (Doors / Windows) is missing from this BOQ. ' +
        'This indicates the door / window schedule sheets failed to extract for this ' +
        'document; the file shows the Finishes + General sections only and is NOT a ' +
        'complete quote. Re-upload the source PDF or inspect the EXTRACT_SCHEDULES job ' +
        'output to diagnose.',
      '',
    ])
    summary.lastRow!.font = { bold: true, color: { argb: 'FFB00000' } }
    summary.lastRow!.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
  }
  summary.addRow([DISCLAIMER])
  summary.lastRow!.font = { italic: true, color: { argb: 'FFB00000' } }

  // S6-4 priced / provisional split line. Inserted BEFORE the per-section
  // breakdown so the reader sees the headline ratio first.
  let pricedTotal = 0
  let pricedCount = 0
  let provisionalCount = 0
  for (const section of boq.sections) {
    for (const line of section.lines) {
      if (line.isProvisional) provisionalCount += 1
      else {
        pricedTotal += num(line.amount)
        pricedCount += 1
      }
    }
  }
  summary.addRow([])
  const splitRow = summary.addRow([
    'Priced / Provisional',
    `Priced ${pricedTotal.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED across ${pricedCount} lines · Provisional: ${provisionalCount} lines pending supplier quotes.`,
    '',
  ])
  splitRow.font = { bold: true }
  splitRow.getCell(2).alignment = { wrapText: true, vertical: 'middle' }

  summary.addRow([])
  // SUMMARY-PS (2026-06-25) — the per-section table now shows
  // BOTH priced and P/S columns. Prior versions wrote only the
  // priced subtotal so Section 4.0 appeared as 0 even though its
  // tab clearly had a 1,090,000 P/S total. Estimator reading the
  // Summary as the source of truth got a contradictory roll-up.
  summary.columns = [
    { width: 10 },
    { width: 48 },
    { width: 20 },
    { width: 20 },
  ]
  summary.addRow(['Section', 'Title', 'Priced (AED)', 'P/S (AED)']).font = { bold: true }
  let runningPriced = 0
  let runningProvisional = 0
  for (const section of boq.sections) {
    // PF-1: compute from line state, not from cached section.subtotal —
    // it can drift after manual patches. Same logic the per-section
    // tab uses.
    const pricedSub = section.lines
      .filter((l) => !l.isProvisional)
      .reduce((sum, l) => sum + num(l.amount), 0)
    const psSub = section.lines
      .filter((l) => l.isProvisional)
      .reduce((sum, l) => sum + (l.psAmount === null ? 0 : num(l.psAmount)), 0)
    const row = summary.addRow([
      section.code,
      section.title,
      pricedSub,
      psSub,
    ])
    row.getCell(3).numFmt = AED_FORMAT
    row.getCell(4).numFmt = AED_FORMAT
    runningPriced += pricedSub
    runningProvisional += psSub
  }
  summary.addRow([])

  // Sub-totals split, then GRAND TOTAL = priced (post-disc/VAT) + P/S.
  const measuredRow = summary.addRow(['', 'Measured / priced subtotal', runningPriced, ''])
  measuredRow.getCell(3).numFmt = AED_FORMAT
  measuredRow.font = { italic: true }

  const discount = num(options.discount)
  if (discount > 0) {
    summary.addRow(['', 'Discount (priced only)', -discount, '']).getCell(3).numFmt = AED_FORMAT
  }
  const afterDiscount = runningPriced - discount
  const vatPct = num(options.vatPct)
  let pricedAllIn = afterDiscount
  if (vatPct > 0) {
    const vat = afterDiscount * (vatPct / 100)
    summary.addRow(['', `VAT on priced (${vatPct}%)`, vat, '']).getCell(3).numFmt = AED_FORMAT
    pricedAllIn = afterDiscount + vat
    const pricedAfterRow = summary.addRow(['', 'Priced subtotal (after discount + VAT)', pricedAllIn, ''])
    pricedAfterRow.getCell(3).numFmt = AED_FORMAT
    pricedAfterRow.font = { italic: true }
  }

  // Always show the P/S running total explicitly, even if zero —
  // makes the absence visible rather than implicit.
  const psRow = summary.addRow(['', 'Provisional sums', '', runningProvisional])
  psRow.getCell(4).numFmt = AED_FORMAT
  psRow.font = { italic: true }

  // GRAND TOTAL = priced all-in + P/S. The number an estimator
  // hands to the client as the bid figure.
  const grand = pricedAllIn + runningProvisional
  summary.addRow([])
  const grandRow = summary.addRow(['', 'GRAND TOTAL (priced + P/S)', '', grand])
  grandRow.font = { bold: true, size: 14 }
  grandRow.getCell(4).numFmt = AED_FORMAT
  // Slight emphasis on the priced + P/S cells to make the split readable
  grandRow.getCell(2).font = { bold: true, size: 14 }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer as ArrayBuffer)
}

function safeTabName(name: string): string {
  // ExcelJS max tab name length is 31; certain chars are forbidden.
  return name
    .replace(/[\\/?*[\]:]/g, ' ')
    .slice(0, 31)
    .trim()
}
