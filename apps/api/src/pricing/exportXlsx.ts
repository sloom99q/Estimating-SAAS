/**
 * BOQ → XLSX exporter.
 *
 * XLSX-1 (2026-06-27) — the export is now the trust layer ON PAPER.
 * Every line carries its provenance inline: WHERE the quantity came
 * from (Source), WHAT KIND of number it is (Basis), HOW confident we
 * are (Confidence %), the FORMULA / DERIVATION reasoning, and the
 * VERIFICATION STATUS the deterministic auditor assigned. A
 * "Verification Summary" tab lists the verified / review / failed
 * counts + every flagged line with its reasons + resolution steps,
 * so an engineer opening the file can audit without round-tripping
 * back into the app.
 *
 * Each section has its own collection page; a final Summary sheet
 * aggregates section subtotals + discount + grand total. Internal
 * mode (`includeInternal=true`) still adds a rate-SOURCE column for
 * pricing audit; everything else (basis / confidence / status /
 * derivation) ships in BOTH client + internal exports — that's the
 * whole point of the upgrade.
 */
import ExcelJS from 'exceljs'

const DISCLAIMER =
  'AI-assisted quantities — verify before contractual use.'

const AED_FORMAT = '#,##0.00;(#,##0.00);"—"'
const PCT_FORMAT = '0%;-0%;"—"'

export interface XlsxEvidenceStep {
  type: 'EXTRACTION' | 'MEASUREMENT' | 'DERIVATION' | 'ASSUMPTION' | 'PRIOR'
  confidence: number
  weight: number
  label?: string
  sourceRef?: string
}

export interface XlsxAuditModule {
  module: string
  /// AUDIT-VERDICT — which axis the module judges.
  axis?: 'quantity' | 'rate' | 'shared'
  verdict: 'verified' | 'review' | 'failed'
  reasons: string[]
  resolutionSteps?: string[]
  tags?: string[]
}

export interface XlsxAuditDetail {
  status: 'verified' | 'review' | 'failed' | null
  /// AUDIT-VERDICT — per-axis verdicts persisted alongside the
  /// worst-of `status` so dual-badge rendering doesn't need to
  /// re-aggregate.
  quantityVerdict?: 'verified' | 'review' | 'failed' | null
  rateVerdict?: 'verified' | 'review' | 'failed' | null
  modules: XlsxAuditModule[]
}

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
  /// XLSX-1 — denormalised provenance for the export. Computed by
  /// the route from BoqLine.provenance so the renderer stays
  /// framework-free + schema-aware.
  sourceType: string | null
  derivationType: string | null
  derivationDetail: string | null
  evidenceSummary: string | null
  evidenceChain: XlsxEvidenceStep[]
  /// XLSX-1 — persisted verification state from the auditor (cached
  /// on BoqLine.verificationStatus + verificationDetail by /audit).
  verificationStatus: 'VERIFIED' | 'FLAGGED' | 'PENDING' | null
  verificationDetail: XlsxAuditDetail | null
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
  /// XLSX-1 — when the audit was last persisted on these lines.
  /// Renderer shows it on the Verification Summary tab so reviewers
  /// know if the audit is fresh.
  auditedAt?: string | null
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
  /**
   * XLSX-3 — how to handle BOQ lines whose rate evidence is tagged
   * 'PLACEHOLDER' (the MEP-rule emissions for Elec/Plumb/ELV that
   * ship as guesses pending engineer-takeoff confirmation).
   *
   *   'tab' (default) — pull placeholder lines OUT of their normal
   *     section tabs + subtotals + grand total, and collect them on
   *     a clearly-marked "DRAFT MEP — not for pricing" tab. Engineer
   *     sees what's pending without it contaminating the main BOQ.
   *
   *   'exclude' — drop placeholder lines entirely. Summary tab gets
   *     a banner row listing how many lines + how much AED was
   *     withheld so the absence is visible, not silent.
   *
   *   'inline' — keep placeholder lines in their normal sections
   *     (today's pre-XLSX-3 behavior).
   */
  placeholderMep?: 'tab' | 'exclude' | 'inline'
}

function num(v: string | null | undefined): number {
  if (v == null || v === '') return 0
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function fillRow(row: ExcelJS.Row, argb: string): void {
  row.eachCell({ includeEmpty: false }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  })
}

function statusFill(status: XlsxLine['verificationStatus']): string | null {
  switch (status) {
    case 'VERIFIED':
      return 'FFE9F5EC' // soft green
    case 'FLAGGED':
      return 'FFFFF6E6' // soft amber
    case 'PENDING':
      return 'FFF1F1F1' // light grey
    default:
      return null
  }
}

/// XLSX-3 — true if the line's rate evidence is tagged PLACEHOLDER
/// (the MEP-rule emissions for Elec/Plumb/ELV that ship as guesses
/// pending engineer-takeoff confirmation). Checks the broad text
/// blobs because PLACEHOLDER can land in either the evidenceSummary
/// or the per-step sourceRef depending on the emitter.
function isPlaceholderRate(line: XlsxLine): boolean {
  const RE = /placeholder/i
  if (line.evidenceSummary && RE.test(line.evidenceSummary)) return true
  if (line.rateSource && RE.test(line.rateSource)) return true
  for (const s of line.evidenceChain) {
    if (s.sourceRef && RE.test(s.sourceRef)) return true
    if (s.label && RE.test(s.label)) return true
  }
  return false
}

export async function renderBoqXlsx(boq: XlsxBoq, options: XlsxOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Estimator'
  wb.created = new Date()

  // XLSX-1 + AUDIT-VERDICT — provenance columns always shown. STATUS
  // is split into two: QTY-STATUS (was the line FAILED on quantity?)
  // and RATE-STATUS (was the rate from a Library / supplier link?).
  // An engineer reading the file sees them as separate concerns —
  // a 0.9 MEASURED door with default rate is "Qty VERIFIED, Rate
  // DEFAULT" not "FLAGGED".
  const baseHeaders = [
    'ITEM REF',
    'DESCRIPTION',
    'UNIT',
    'QTY',
    'RATE',
    'AMOUNT',
    'QTY-STATUS',
    'RATE-STATUS',
    'CONFIDENCE',
    'BASIS',
    'DERIVATION',
    'SOURCE',
  ]
  const headers = options.includeInternal ? [...baseHeaders, 'RATE SOURCE'] : baseHeaders

  const baseWidths = [
    { width: 11 },
    { width: 46 },
    { width: 8 },
    { width: 10 },
    { width: 12 },
    { width: 14 },
    { width: 11 },
    { width: 11 },
    { width: 12 },
    { width: 13 },
    { width: 56 },
    { width: 36 },
  ]
  const widths = options.includeInternal ? [...baseWidths, { width: 26 }] : baseWidths

  const QTY_STATUS_COL = 7
  const RATE_STATUS_COL = 8
  const CONF_COL = 9
  const BASIS_COL = 10
  const DERIV_COL = 11
  const SRC_COL = 12
  const RATE_SRC_COL = 13 // only when includeInternal

  // XLSX-3 — partition placeholder-rate lines out of the main sections
  // per `placeholderMep` mode. Default 'tab' so an engineer reading
  // the workbook never has guesses mixed into the priced numbers.
  const placeholderMode = options.placeholderMep ?? 'tab'
  const draftLines: Array<{ sectionCode: string; sectionTitle: string; line: XlsxLine }> = []
  const renderableSections: XlsxSection[] = boq.sections.map((s) => {
    if (placeholderMode === 'inline') return s
    const kept: XlsxLine[] = []
    for (const l of s.lines) {
      if (isPlaceholderRate(l)) {
        if (placeholderMode === 'tab') {
          draftLines.push({ sectionCode: s.code, sectionTitle: s.title, line: l })
        }
        // 'exclude' drops + 'tab' moves; either way pull out.
        continue
      }
      kept.push(l)
    }
    return { ...s, lines: kept }
  })

  // Shared row renderer — used by main section sheets + the DRAFT MEP
  // tab so the column layout stays identical (and any future provenance
  // column lands in both).
  function pushLineRow(sheet: ExcelJS.Worksheet, line: XlsxLine): void {
    const amountCell = line.isProvisional
      ? line.psAmount === null
        ? '—'
        : num(line.psAmount)
      : num(line.amount)
    const conf01 = line.confidence != null ? line.confidence / 100 : null
    // AUDIT-VERDICT — derive dual labels from verificationDetail.
    // Quantity falls back to the legacy verificationStatus when the
    // line predates AUDIT-VERDICT (no per-axis fields persisted).
    const qty = line.verificationDetail?.quantityVerdict ?? null
    const rate = line.verificationDetail?.rateVerdict ?? null
    const qtyLabel = qty
      ? verdictLabel(qty)
      : line.verificationStatus === 'VERIFIED'
        ? 'VERIFIED'
        : (line.verificationStatus ?? 'PENDING')
    const rateLabel = rate
      ? verdictLabel(rate)
      : line.isProvisional
        ? 'N/A (P/S)'
        : 'PENDING'
    const baseCells: (string | number | null)[] = [
      line.itemRef,
      line.description,
      line.unit,
      num(line.qty),
      line.isProvisional ? 'P/S' : num(line.rate),
      amountCell,
      qtyLabel,
      rateLabel,
      conf01 ?? '',
      line.sourceType ?? '',
      line.derivationDetail ?? '',
      line.evidenceSummary ?? '',
    ]
    const row = options.includeInternal ? [...baseCells, line.rateSource ?? ''] : baseCells
    const xlsRow = sheet.addRow(row)
    xlsRow.getCell(4).numFmt = '#,##0.00'
    if (!line.isProvisional) xlsRow.getCell(5).numFmt = AED_FORMAT
    xlsRow.getCell(6).numFmt = AED_FORMAT
    xlsRow.getCell(CONF_COL).numFmt = PCT_FORMAT
    xlsRow.getCell(DERIV_COL).alignment = { wrapText: true, vertical: 'top' }
    xlsRow.getCell(SRC_COL).alignment = { wrapText: true, vertical: 'top' }
    xlsRow.getCell(BASIS_COL).alignment = { vertical: 'top' }
    xlsRow.getCell(QTY_STATUS_COL).alignment = { vertical: 'top' }
    xlsRow.getCell(RATE_STATUS_COL).alignment = { vertical: 'top' }
    // Row tint = worst-of the two axes (matches the persisted
    // verificationStatus). Cell-level tint also applies per axis
    // so an engineer scanning the file sees Qty/Rate separately.
    const rowFill = statusFill(line.verificationStatus)
    if (rowFill) fillRow(xlsRow, rowFill)
    const qtyCellFill = verdictFill(qty)
    if (qtyCellFill) xlsRow.getCell(QTY_STATUS_COL).fill = qtyCellFill
    const rateCellFill = verdictFill(rate)
    if (rateCellFill) xlsRow.getCell(RATE_STATUS_COL).fill = rateCellFill
  }

  function verdictLabel(v: 'verified' | 'review' | 'failed'): string {
    switch (v) {
      case 'verified':
        return 'VERIFIED'
      case 'review':
        return 'REVIEW'
      case 'failed':
        return 'FAILED'
    }
  }

  function verdictFill(v: 'verified' | 'review' | 'failed' | null): ExcelJS.FillPattern | null {
    if (!v) return null
    let argb: string | null = null
    if (v === 'verified') argb = 'FFE9F5EC'
    else if (v === 'review') argb = 'FFFFF6E6'
    else if (v === 'failed') argb = 'FFFCE4E4'
    if (!argb) return null
    return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  }

  function pushHeaderRow(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.addRow(headers)
    headerRow.font = { bold: true }
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }
      cell.border = { bottom: { style: 'thin' } }
      cell.alignment = { wrapText: true, vertical: 'middle' }
    })
    headerRow.height = 26
  }

  // Per-section "collection" pages.
  for (const section of renderableSections) {
    // XLSX-3 — when placeholder-MEP filtering empties out an entire
    // section (e.g. 2.71 Electrical = all placeholder rules), don't
    // create an empty tab. The DRAFT MEP tab below carries the
    // moved lines + the Summary banner names what was withheld.
    if (section.lines.length === 0) continue

    const sheet = wb.addWorksheet(safeTabName(`${section.code} ${section.title}`))
    sheet.columns = widths

    // Title + disclaimer.
    sheet.addRow([`${section.code} ${section.title}`])
    sheet.lastRow!.font = { bold: true, size: 13 }
    sheet.addRow([DISCLAIMER])
    sheet.lastRow!.font = { italic: true, color: { argb: 'FFB00000' } }
    sheet.addRow([])

    pushHeaderRow(sheet)
    for (const line of section.lines) pushLineRow(sheet, line)
    sheet.addRow([])

    // Subtotals (priced / P/S / total) — same logic as before, just
    // shifted into the new column layout.
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

    // Mute the RATE SOURCE col header alignment quirk if internal.
    if (options.includeInternal) {
      sheet.getColumn(RATE_SRC_COL).alignment = { wrapText: true, vertical: 'top' }
    }
  }

  // XLSX-3 — DRAFT MEP — not for pricing. Lines moved here have rate
  // evidence tagged PLACEHOLDER (the MEP rule emissions for Elec /
  // Plumb / ELV that ship as guesses, plus any future PLACEHOLDER-
  // tagged rate sources). The tab is clearly labelled + the lines
  // do NOT roll into the BOQ grand total. The Summary banner below
  // names what was withheld so the absence is visible.
  if (placeholderMode === 'tab' && draftLines.length > 0) {
    const draft = wb.addWorksheet('DRAFT MEP — not for pricing')
    draft.columns = widths
    draft.addRow(['DRAFT MEP — not for pricing']).font = { bold: true, size: 13 }
    draft.lastRow!.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE6E6' },
    }
    draft.addRow([
      'These lines were emitted by the MEP rule engine with PLACEHOLDER ' +
        'factor/rate confidence — they are best-guess scope, NOT priced ' +
        'numbers. They are deliberately excluded from the main BOQ tabs ' +
        'and the GRAND TOTAL. Confirm the rule factor + rate with the ' +
        'engineer takeoff (or a supplier quote) before promoting any line ' +
        'into a real BOQ section.',
    ]).font = { italic: true, color: { argb: 'FFB00000' } }
    draft.lastRow!.getCell(1).alignment = { wrapText: true, vertical: 'middle' }
    draft.lastRow!.height = 48
    draft.addRow([DISCLAIMER]).font = { italic: true, color: { argb: 'FFB00000' } }
    draft.addRow([])

    // Group by source section so the engineer sees discipline blocks
    // (HVAC / Electrical / Plumbing / ELV) instead of a flat mash.
    const bySection = new Map<string, { title: string; lines: XlsxLine[] }>()
    for (const { sectionCode, sectionTitle, line } of draftLines) {
      const entry = bySection.get(sectionCode) ?? { title: sectionTitle, lines: [] }
      entry.lines.push(line)
      bySection.set(sectionCode, entry)
    }
    let draftTotal = 0
    for (const [code, { title, lines }] of [...bySection.entries()].sort()) {
      draft.addRow([`${code} ${title}`]).font = { bold: true }
      pushHeaderRow(draft)
      for (const l of lines) pushLineRow(draft, l)
      const subtotal = lines
        .filter((l) => !l.isProvisional)
        .reduce((sum, l) => sum + num(l.amount), 0)
      draftTotal += subtotal
      const subtotalRow = draft.addRow([
        '', '', '', '',
        `Subtotal — ${code} DRAFT (not for pricing)`,
        subtotal,
      ])
      subtotalRow.getCell(5).font = { italic: true }
      subtotalRow.getCell(6).numFmt = AED_FORMAT
      draft.addRow([])
    }
    const totalRow = draft.addRow([
      '', '', '', '',
      'DRAFT MEP total (would have been added if confirmed)',
      draftTotal,
    ])
    totalRow.getCell(5).font = { bold: true }
    totalRow.getCell(6).font = { bold: true }
    totalRow.getCell(6).numFmt = AED_FORMAT
  }

  // XLSX-1 — Verification Summary tab. The audit explainer ON PAPER.
  const verify = wb.addWorksheet('Verification Summary')
  verify.columns = [
    { width: 11 }, { width: 36 }, { width: 12 }, { width: 12 }, { width: 13 },
    { width: 12 }, { width: 56 }, { width: 56 },
  ]
  verify.addRow([`Verification Summary — ${boq.projectName} (v${boq.version})`]).font = {
    bold: true,
    size: 14,
  }
  if (boq.auditedAt) {
    verify.addRow([`Audit last run: ${boq.auditedAt.slice(0, 19).replace('T', ' ')} UTC`]).font = {
      italic: true,
      color: { argb: 'FF666666' },
    }
  }
  verify.addRow([DISCLAIMER]).font = { italic: true, color: { argb: 'FFB00000' } }
  verify.addRow([])

  // Headline counts.
  let verified = 0
  let review = 0
  let failed = 0
  let pending = 0
  for (const s of renderableSections) {
    for (const l of s.lines) {
      switch (l.verificationStatus) {
        case 'VERIFIED':
          verified += 1
          break
        case 'FLAGGED':
          // FLAGGED is the persisted union of review + failed; split
          // back out using the detail's status field if present.
          if (l.verificationDetail?.status === 'failed') failed += 1
          else review += 1
          break
        case 'PENDING':
          pending += 1
          break
        default:
          pending += 1
      }
    }
  }
  const total = verified + review + failed + pending
  const headlineRow = verify.addRow([
    'HEADLINE',
    `${verified} verified · ${review} need review · ${failed} failed${pending > 0 ? ` · ${pending} not yet audited` : ''}  (of ${total} BOQ lines)`,
  ])
  headlineRow.font = { bold: true, size: 12 }
  headlineRow.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
  verify.addRow([])

  // Per-section breakdown.
  verify.addRow(['Section', 'Title', 'Verified', 'Review', 'Failed', 'Pending']).font = {
    bold: true,
  }
  for (const s of renderableSections) {
    let v = 0, r = 0, f = 0, p = 0
    for (const l of s.lines) {
      switch (l.verificationStatus) {
        case 'VERIFIED':
          v += 1
          break
        case 'FLAGGED':
          if (l.verificationDetail?.status === 'failed') f += 1
          else r += 1
          break
        default:
          p += 1
      }
    }
    verify.addRow([s.code, s.title, v, r, f, p])
  }
  verify.addRow([])

  // Per-source-type breakdown.
  verify.addRow(['SourceType', '', 'Verified', 'Review', 'Failed']).font = { bold: true }
  const bySource = new Map<string, { v: number; r: number; f: number }>()
  for (const s of renderableSections) {
    for (const l of s.lines) {
      const st = l.sourceType ?? 'UNKNOWN'
      const e = bySource.get(st) ?? { v: 0, r: 0, f: 0 }
      if (l.verificationStatus === 'VERIFIED') e.v += 1
      else if (l.verificationStatus === 'FLAGGED') {
        if (l.verificationDetail?.status === 'failed') e.f += 1
        else e.r += 1
      }
      bySource.set(st, e)
    }
  }
  for (const [st, c] of [...bySource.entries()].sort()) {
    verify.addRow([st, '', c.v, c.r, c.f])
  }
  verify.addRow([])

  // Flagged-lines detail table — the audit explainer for the
  // engineer reading on paper.
  verify
    .addRow(['Ref', 'Description', 'Status', 'Conf', 'Source', 'Basis', 'Why flagged', 'How to resolve'])
    .font = { bold: true }
  verify.lastRow!.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }
    c.border = { bottom: { style: 'thin' } }
    c.alignment = { wrapText: true, vertical: 'middle' }
  })

  const flagged: Array<{
    sectionCode: string
    l: XlsxLine
  }> = []
  for (const s of renderableSections) {
    for (const l of s.lines) {
      if (l.verificationStatus === 'FLAGGED' || l.verificationStatus === 'PENDING') {
        flagged.push({ sectionCode: s.code, l })
      }
    }
  }
  for (const { l } of flagged) {
    const conf01 = l.confidence != null ? l.confidence / 100 : null
    const why = (l.verificationDetail?.modules ?? [])
      .filter((m) => m.reasons.length > 0)
      .flatMap((m) => m.reasons.map((r) => `[${m.module}] ${r}`))
      .join('\n')
    const resolve = (l.verificationDetail?.modules ?? [])
      .flatMap((m) => m.resolutionSteps ?? [])
      .filter((s) => s.length > 0)
      .join('\n')
    const row = verify.addRow([
      l.itemRef,
      l.description,
      l.verificationStatus ?? 'PENDING',
      conf01 ?? '',
      l.evidenceSummary ?? '',
      l.sourceType ?? '',
      why,
      resolve,
    ])
    row.getCell(4).numFmt = PCT_FORMAT
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(7).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(8).alignment = { wrapText: true, vertical: 'top' }
    const fill = statusFill(l.verificationStatus)
    if (fill) fillRow(row, fill)
  }
  if (flagged.length === 0) {
    verify.addRow(['—', 'All BOQ lines passed the deterministic auditor.', '', '', '', '', '', ''])
  }

  // Original Summary sheet — section subtotals + grand total. Kept
  // intact; the Verification Summary is the new tab.
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

  // XLSX-3 — banner row when placeholder-MEP filtering withheld lines
  // from the main BOQ. Visible in both 'tab' and 'exclude' modes so
  // the engineer knows the GRAND TOTAL excludes them.
  if (placeholderMode !== 'inline' && draftLines.length === 0) {
    // exclude mode + no draft tab — need to derive what was removed.
    const droppedByFilter: XlsxLine[] = []
    for (const s of boq.sections) {
      for (const l of s.lines) {
        if (isPlaceholderRate(l)) droppedByFilter.push(l)
      }
    }
    if (droppedByFilter.length > 0) {
      const droppedTotal = droppedByFilter.reduce((sum, l) => sum + num(l.amount), 0)
      summary.addRow([
        'Placeholder MEP',
        `${droppedByFilter.length} line(s) totalling ${droppedTotal.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED were EXCLUDED from this export — rate evidence tagged PLACEHOLDER. Re-export with placeholderMep=inline to see them, or =tab to see them on a separate "DRAFT MEP" sheet.`,
        '',
      ])
      summary.lastRow!.font = { bold: true, color: { argb: 'FFB00000' } }
      summary.lastRow!.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
    }
  }
  if (placeholderMode === 'tab' && draftLines.length > 0) {
    const draftTotal = draftLines.reduce((sum, { line }) => sum + num(line.amount), 0)
    summary.addRow([
      'Placeholder MEP',
      `${draftLines.length} line(s) totalling ${draftTotal.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED were MOVED to the "DRAFT MEP — not for pricing" tab. They are NOT in the GRAND TOTAL below until the rule factor + rate are confirmed.`,
      '',
    ])
    summary.lastRow!.font = { bold: true, color: { argb: 'FFB00000' } }
    summary.lastRow!.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
  }

  let pricedTotal = 0
  let pricedCount = 0
  let provisionalCount = 0
  for (const section of renderableSections) {
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
  summary.columns = [
    { width: 10 },
    { width: 48 },
    { width: 20 },
    { width: 20 },
  ]
  summary.addRow(['Section', 'Title', 'Priced (AED)', 'P/S (AED)']).font = { bold: true }
  let runningPriced = 0
  let runningProvisional = 0
  for (const section of renderableSections) {
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

  const psRow = summary.addRow(['', 'Provisional sums', '', runningProvisional])
  psRow.getCell(4).numFmt = AED_FORMAT
  psRow.font = { italic: true }

  const grand = pricedAllIn + runningProvisional
  summary.addRow([])
  const grandRow = summary.addRow(['', 'GRAND TOTAL (priced + P/S)', '', grand])
  grandRow.font = { bold: true, size: 14 }
  grandRow.getCell(4).numFmt = AED_FORMAT
  grandRow.getCell(2).font = { bold: true, size: 14 }

  const buffer = await wb.xlsx.writeBuffer()
  return Buffer.from(buffer as ArrayBuffer)
}

function safeTabName(name: string): string {
  return name
    .replace(/[\\/?*[\]:]/g, ' ')
    .slice(0, 31)
    .trim()
}
