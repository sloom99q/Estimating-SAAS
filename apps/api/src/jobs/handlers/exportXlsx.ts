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
import type { JobHandler, JobRecord } from '../types'

interface ExportPayload {
  boqId: string
  includeInternal?: boolean
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

  const xlsxModel: XlsxBoq = {
    projectName: boq.project.name,
    version: boq.version,
    currency: boq.currency,
    subtotal: decimalString(boq.subtotal),
    totalProvisional: decimalString(boq.totalProvisional),
    sections: boq.sections.map((s) => ({
      code: s.code,
      title: s.title,
      subtotal: decimalString(s.subtotal),
      lines: s.lines.map((l) => ({
        itemRef: l.itemRef,
        description: l.description,
        unit: l.unit,
        qty: decimalString(l.qty),
        rate: decimalString(l.rate),
        rateSource: l.rateSource,
        amount: decimalString(l.amount),
        isProvisional: l.isProvisional,
        psAmount: decimalString(l.psAmount),
        confidence: l.confidence,
      })),
    })),
  }

  const buffer = await renderBoqXlsx(xlsxModel, {
    includeInternal: payload.includeInternal === true,
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
