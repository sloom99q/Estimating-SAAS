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
      const row = options.includeInternal
        ? [
            line.itemRef,
            line.description,
            line.unit,
            num(line.qty),
            line.isProvisional ? 'P/S' : num(line.rate),
            line.isProvisional ? num(line.psAmount) : num(line.amount),
            line.confidence ?? '',
            line.rateSource ?? '',
          ]
        : [
            line.itemRef,
            line.description,
            line.unit,
            num(line.qty),
            line.isProvisional ? 'P/S' : num(line.rate),
            line.isProvisional ? num(line.psAmount) : num(line.amount),
          ]
      const xlsRow = sheet.addRow(row)
      xlsRow.getCell(4).numFmt = '#,##0.00'
      if (!line.isProvisional) {
        xlsRow.getCell(5).numFmt = AED_FORMAT
      }
      xlsRow.getCell(6).numFmt = AED_FORMAT
    }
    sheet.addRow([])
    const subtotalRow = sheet.addRow([
      '',
      '',
      '',
      '',
      `Subtotal — ${section.code}`,
      num(section.subtotal),
    ])
    subtotalRow.getCell(5).font = { bold: true }
    subtotalRow.getCell(6).font = { bold: true }
    subtotalRow.getCell(6).numFmt = AED_FORMAT
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
  summary.addRow([DISCLAIMER])
  summary.lastRow!.font = { italic: true, color: { argb: 'FFB00000' } }
  summary.addRow([])
  summary.addRow(['Section', 'Title', 'Subtotal (AED)']).font = { bold: true }
  let runningSubtotal = 0
  for (const section of boq.sections) {
    const sub = num(section.subtotal)
    summary.addRow([section.code, section.title, sub]).getCell(3).numFmt = AED_FORMAT
    runningSubtotal += sub
  }
  summary.addRow([])
  summary.addRow(['', 'Subtotal', runningSubtotal]).getCell(3).numFmt = AED_FORMAT
  const discount = num(options.discount)
  if (discount > 0) {
    summary.addRow(['', 'Discount', -discount]).getCell(3).numFmt = AED_FORMAT
  }
  const afterDiscount = runningSubtotal - discount
  const vatPct = num(options.vatPct)
  if (vatPct > 0) {
    const vat = afterDiscount * (vatPct / 100)
    summary.addRow(['', `VAT (${vatPct}%)`, vat]).getCell(3).numFmt = AED_FORMAT
    summary.addRow(['', 'GRAND TOTAL', afterDiscount + vat]).font = { bold: true, size: 12 }
  } else {
    summary.addRow(['', 'GRAND TOTAL', afterDiscount]).font = { bold: true, size: 12 }
  }
  summary.lastRow!.getCell(3).numFmt = AED_FORMAT

  if (num(boq.totalProvisional) > 0) {
    summary.addRow([])
    summary.addRow(['', 'Of which Provisional Sums', num(boq.totalProvisional)]).getCell(3).numFmt = AED_FORMAT
  }

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
