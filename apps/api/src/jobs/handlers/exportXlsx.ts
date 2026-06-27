/**
 * EXPORT_XLSX — Sprint 3.
 *
 *   payload = { boqId, includeInternal? }
 *
 * Renders the BOQ to an .xlsx file, writes it under the BlobStore at the
 * canonical key, and stores the key on the Boq's result so the SPA can
 * stream it back. Doesn't mutate the BOQ.
 */
import { getBlobStore } from '../../blob/fs'
import { documentKey } from '../../blob/types'
import { prisma } from '../../db'
import { renderBoqXlsx, type XlsxBoq } from '../../pricing/exportXlsx'
import { toXlsxLine } from '../../pricing/xlsxLineProvenance'
import { auditLineWithModules, toAuditInput } from '../../pricing/auditor'
import type { JobHandler, JobRecord } from '../types'

interface ExportPayload {
  boqId: string
  includeInternal?: boolean
  /** XLSX-3 — see XlsxOptions.placeholderMep. Default 'tab'. */
  placeholderMep?: 'tab' | 'exclude' | 'inline'
}

function decimalString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return v.toString()
  if (typeof v === 'object' && v !== null && 'toString' in v) {
    return (v as { toString(): string }).toString()
  }
  return null
}

export const exportXlsxHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as ExportPayload
  if (!payload.boqId) throw new Error('EXPORT_XLSX: payload.boqId required')

  const boq = await prisma.boq.findFirst({
    where: { id: payload.boqId, organizationId: job.organizationId, deletedAt: null },
    include: {
      project: { select: { id: true, name: true } },
      sections: {
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!boq) throw new Error(`EXPORT_XLSX: boq ${payload.boqId} not found`)

  // XLSX-1 — run the deterministic auditor inline + persist so the
  // export carries fresh verificationStatus per line. Same pattern as
  // the inline GET /export.xlsx route.
  const allLines = boq.sections.flatMap((s) => s.lines)
  const results = allLines.map((l) => ({
    line: l,
    result: auditLineWithModules(toAuditInput(l)),
  }))
  await Promise.all(
    results.map(({ line, result }) => {
      const status = result.status === 'verified' ? 'VERIFIED' : 'FLAGGED'
      const detail = {
        status: result.status,
        quantityVerdict: result.quantityVerdict,
        rateVerdict: result.rateVerdict,
        modules: result.modules.map((m) => ({
          module: m.module,
          axis: m.axis,
          verdict: m.verdict,
          reasons: m.reasons,
          resolutionSteps: m.resolutionSteps,
          tags: m.tags,
        })),
      }
      return prisma.boqLine.update({
        where: { id: line.id },
        data: { verificationStatus: status, verificationDetail: detail as object },
      })
    }),
  )
  const audited = await prisma.boq.findFirst({
    where: { id: payload.boqId, organizationId: job.organizationId, deletedAt: null },
    include: {
      project: { select: { id: true, name: true } },
      sections: {
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!audited) throw new Error(`EXPORT_XLSX: boq ${payload.boqId} disappeared mid-render`)

  const xlsxModel: XlsxBoq = {
    projectName: audited.project.name,
    version: audited.version,
    currency: audited.currency,
    subtotal: decimalString(audited.subtotal),
    totalProvisional: decimalString(audited.totalProvisional),
    auditedAt: new Date().toISOString(),
    sections: audited.sections.map((s) => ({
      code: s.code,
      title: s.title,
      subtotal: decimalString(s.subtotal),
      lines: s.lines.map(toXlsxLine),
    })),
  }

  const buffer = await renderBoqXlsx(xlsxModel, {
    includeInternal: payload.includeInternal === true,
    placeholderMep: payload.placeholderMep ?? 'tab',
  })
  const key = documentKey(
    job.organizationId,
    boq.project.id,
    boq.id,
    `boq-v${boq.version}${payload.includeInternal ? '-internal' : ''}.xlsx`,
  )
  await getBlobStore().put(key, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

  return {
    ok: true,
    boqId: boq.id,
    storageKey: key,
    byteLength: buffer.byteLength,
    includeInternal: payload.includeInternal === true,
  }
}
