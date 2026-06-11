/**
 * EXTRACT_ROOMS — Sprint 2 final pipeline stage.
 *
 *   payload = { documentId }
 *
 * For every sheet classified as plan or finish_plan:
 *   (a) VISION pass: AI extractRooms.v1.
 *   (b) TEXT pass:   independent regex parse of pdftotext output.
 * Reconcile by room name. Same scoring rules as EXTRACT_SCHEDULES.
 *
 * Then sync into Spaces with source='takeoff'. Manual-source Spaces are NEVER
 * touched — humans win. If a manual Space already exists with the same name
 * for the project, we skip creating a takeoff Space for that name. (The
 * takeoff TakeoffItem is still recorded so the review surface has it.)
 *
 * On completion, set Document.status = READY — the pipeline's terminal stage.
 */
import { STUB_SUFFIX, extractRooms } from '../../ai/anthropic'
import { roomsTextPass } from '../../ai/roomsTextPass'
import type { ExtractRoomsRow } from '../../ai/types'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import type { JobHandler, JobRecord } from '../types'

interface ExtractRoomsPayload {
  documentId: string
}

const ROOM_SHEET_TYPES = ['plan', 'finish_plan']
const RULE_ROW_MISMATCH = 'ROW_MISMATCH'

interface ReconciledRoom {
  name: string
  code: string | null
  floor: string | null
  area_m2: number | null
  finish_code: string | null
  basis: 'MEASURED' | 'VISUAL' | 'PARAMETRIC'
  confidence: number
  mismatch: null | { field: string; vision: unknown; text: unknown }
}

function compareNumeric(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b
  // ±2% tolerance per DoD 4. Spec calls room areas as MEASURED at this rate.
  const tolerance = Math.max(Math.abs(a), Math.abs(b)) * 0.02
  return Math.abs(a - b) <= tolerance
}

function reconcile(vision: ExtractRoomsRow[], text: ExtractRoomsRow[]): ReconciledRoom[] {
  const visionMap = new Map(vision.map((r) => [r.name, r]))
  const textMap = new Map(text.map((r) => [r.name, r]))
  const names = new Set<string>([...visionMap.keys(), ...textMap.keys()])
  const out: ReconciledRoom[] = []
  for (const name of names) {
    const v = visionMap.get(name)
    const t = textMap.get(name)
    if (v && t) {
      const mismatch = !compareNumeric(v.area_m2, t.area_m2)
        ? { field: 'area_m2', vision: v.area_m2, text: t.area_m2 }
        : null
      out.push({
        name,
        code: v.code ?? t.code,
        floor: v.floor ?? t.floor,
        area_m2: v.area_m2 ?? t.area_m2,
        finish_code: v.finish_code ?? t.finish_code,
        basis: 'MEASURED',
        confidence: mismatch ? 60 : 90,
        mismatch,
      })
    } else if (v) {
      out.push({
        name,
        code: v.code,
        floor: v.floor,
        area_m2: v.area_m2,
        finish_code: v.finish_code,
        basis: 'VISUAL',
        confidence: 70,
        mismatch: null,
      })
    } else if (t) {
      out.push({
        name,
        code: t.code,
        floor: t.floor,
        area_m2: t.area_m2,
        finish_code: t.finish_code,
        basis: 'PARAMETRIC',
        confidence: 50,
        mismatch: null,
      })
    }
  }
  return out
}

export const extractRoomsHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as ExtractRoomsPayload
  if (!payload.documentId) throw new Error('EXTRACT_ROOMS: payload.documentId required')

  const document = await prisma.document.findFirst({
    where: { id: payload.documentId, organizationId: job.organizationId },
  })
  if (!document) throw new Error(`EXTRACT_ROOMS: document ${payload.documentId} not found`)

  const sheets = await prisma.sheet.findMany({
    where: {
      documentId: document.id,
      organizationId: job.organizationId,
      sheetType: { in: ROOM_SHEET_TYPES },
    },
    orderBy: { pageNo: 'asc' },
  })

  const blob = getBlobStore()
  let tokensIn = 0
  let tokensOut = 0
  let itemsCreated = 0
  let spacesUpserted = 0
  let manualSkipped = 0
  let mismatches = 0

  for (const sheet of sheets) {
    const jpegBase64 = sheet.imageKey
      ? await blob.get(sheet.imageKey).then((b) => b.toString('base64')).catch(() => null)
      : null
    const textSnippet = sheet.rawTextKey
      ? (await blob.get(sheet.rawTextKey).then((b) => b.toString('utf-8')).catch(() => '')).slice(0, 4000)
      : ''

    const vision = await extractRooms({
      documentId: document.id,
      pageNo: sheet.pageNo,
      jpegBase64,
      textSnippet,
    })
    tokensIn += vision.tokensIn
    tokensOut += vision.tokensOut

    const text = roomsTextPass(textSnippet, sheet.pageNo)
    const reconciled = reconcile(vision.rows, text)
    const visionFromStub = vision.promptVersion.endsWith(STUB_SUFFIX)

    for (const room of reconciled) {
      const meta: Record<string, unknown> = {
        code: room.code,
        floor: room.floor,
        area_m2: room.area_m2,
        finish_code: room.finish_code,
      }
      // Sprint-3 A1: stub vision → mark the row.
      if (visionFromStub) meta.stub = true
      const takeoff = await prisma.takeoffItem.create({
        data: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          category: 'ROOM',
          tag: room.code,
          description: `${room.name}${room.floor ? ` — ${room.floor}` : ''}`,
          unit: 'm²',
          qtyAi: room.area_m2 ?? undefined,
          basis: room.basis,
          confidence: room.confidence,
          sourceSheetId: sheet.id,
          sourceNote: sheet.drawingNo ?? `page ${sheet.pageNo}`,
          meta: meta as object,
          promptVersion: vision.promptVersion,
        },
      })
      itemsCreated += 1

      if (room.mismatch) {
        mismatches += 1
        await prisma.validationFlag.create({
          data: {
            organizationId: job.organizationId,
            projectId: document.projectId,
            takeoffItemId: takeoff.id,
            rule: RULE_ROW_MISMATCH,
            severity: 'ERROR',
            message: `ROOM ${room.name}: ${room.mismatch.field} disagrees (vision=${room.mismatch.vision}, text=${room.mismatch.text}).`,
          },
        })
      }

      // Spaces sync. Manual-source spaces win — never touch them. We dedupe
      // by name within the project; ARMM-style multi-instance same-name rooms
      // would need a richer key (out of scope for Sprint 2).
      const manual = await prisma.space.findFirst({
        where: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          name: room.name,
          source: 'manual',
          deletedAt: null,
        },
      })
      if (manual) {
        manualSkipped += 1
        continue
      }
      const side = Math.max(0.1, Math.sqrt(room.area_m2 ?? 1))
      const existing = await prisma.space.findFirst({
        where: {
          organizationId: job.organizationId,
          projectId: document.projectId,
          name: room.name,
          source: 'takeoff',
          deletedAt: null,
        },
      })
      if (existing) {
        await prisma.space.update({
          where: { id: existing.id },
          data: {
            code: room.code,
            floor: room.floor,
            areaM2: room.area_m2 ?? null,
            confidence: room.confidence,
            // length / width / height are required by 8A. For takeoff rooms
            // the areaM2 column is authoritative; we keep a square stand-in
            // so the wire shape doesn't break the SPA.
            length: side,
            width: side,
          },
        })
      } else {
        await prisma.space.create({
          data: {
            organizationId: job.organizationId,
            projectId: document.projectId,
            name: room.name,
            length: side,
            width: side,
            height: 3,
            code: room.code,
            floor: room.floor,
            areaM2: room.area_m2 ?? null,
            source: 'takeoff',
            confidence: room.confidence,
          },
        })
      }
      spacesUpserted += 1
    }
  }

  if (tokensIn > 0 || tokensOut > 0) {
    await prisma.usage.upsert({
      where: { organizationId: job.organizationId },
      create: { organizationId: job.organizationId, tokensIn, tokensOut },
      update: {
        tokensIn: { increment: tokensIn },
        tokensOut: { increment: tokensOut },
      },
    })
  }

  // Terminal stage of the pipeline — mark the document READY.
  await prisma.document.update({
    where: { id: document.id },
    data: { status: 'READY' },
  })

  return {
    ok: true,
    documentId: document.id,
    roomsProcessed: itemsCreated,
    spacesUpserted,
    manualSpacesSkipped: manualSkipped,
    rowMismatches: mismatches,
    tokensIn,
    tokensOut,
  }
}
