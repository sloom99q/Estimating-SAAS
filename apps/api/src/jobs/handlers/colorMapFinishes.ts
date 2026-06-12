/**
 * Sprint-9 S9-2 — color-sampling room → finish-code remap, project level.
 *
 * Walks every I4xx finish-plan sheet of a document, builds the per-sheet
 * palette from the legend tokens' swatches (canonical fallback), then for
 * each ROOM TakeoffItem in the project finds the room name on the sheet
 * and samples the room interior. Highest-confidence assignment across
 * sheets wins. Persisted as meta.finish_code, meta.finishConfidence,
 * meta.finishSource='color-sample'.
 *
 * Zero token cost. Replaces the vision-driven finish_code path on
 * vector-PDF fixtures.
 */
import type { Prisma } from '@prisma/client'
import { renderPageBbox } from '../../ai/bboxRender'
import {
  buildPalette,
  mapRoomsToFinishCodes,
  renderPageRgb,
  type RoomColorAssignment,
} from '../../ai/finishMapColorPass'
import type { BboxWord } from '../../ai/roomsBboxParser'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import { normalizeRoomName } from './extractRooms'

const FINISH_PLAN_ANCHOR_RE = /^I4\d{2}\b/i
/**
 * Sprint-10 S10-2(d) — coordinate-carry. For room names that only
 * appear on the architectural floor plan (A101 / A102) but not on the
 * matching finish plan (I401 / I402), we can still classify by
 * sampling the finish plan AT THE SAME COORDINATES as the floor plan
 * label — provided the two sheets share the same grid. Plot 4357's
 * A101 ↔ I401 are aligned within a few pixels.
 *
 * Map: floor-plan drawingNo → finish-plan drawingNo with shared grid.
 */
const COORDINATE_CARRY_PAIRS: Array<{ from: string; to: string }> = [
  { from: 'A101', to: 'I401' }, // Ground floor plan → ground floor finish plan
  { from: 'A102', to: 'I402' }, // First floor plan → first floor finish plan
]

const CORE_LEGEND_CODES = [
  'ST01',
  'ST02',
  'ST03',
  'PR01',
  'PR03',
  'WD01',
  'FN01',
  'FN02',
  'FN03',
  'FN04',
  'LS01',
  'LS02',
] as const

export interface ColorMapResult {
  sheetsProcessed: number
  roomsConsidered: number
  roomsMapped: number
  roomsUnchanged: number
  newlyMapped: number
  changedCode: number
  paletteSamplesFromDocument: number
  paletteSamplesCanonical: number
  perRoom: Array<{
    roomId: string
    name: string
    before: string | null
    after: string | null
    confidence: number
    source: string
  }>
}

/**
 * Build room-name bboxes from a list of bbox words and a list of target
 * room names. We greedy-merge consecutive-token name candidates so
 * "BOH KITCHEN" / "MAID'S ROOM" pair into a single bbox covering both.
 */
function findRoomBboxes(
  words: BboxWord[],
  roomNames: ReadonlyArray<string>,
): Array<{ name: string; xMin: number; yMin: number; xMax: number; yMax: number }> {
  const targetMap = new Map<string, string>() // normalised key → original
  for (const n of roomNames) {
    const key = normalizeRoomName(n)
    if (key && !targetMap.has(key)) targetMap.set(key, n)
  }
  const out: Array<{ name: string; xMin: number; yMin: number; xMax: number; yMax: number }> = []
  for (let i = 0; i < words.length; i++) {
    // Try increasingly long token windows up to 4 words.
    for (let span = 4; span >= 1; span--) {
      if (i + span > words.length) continue
      const phrase = words
        .slice(i, i + span)
        .map((w) => w.text.trim())
        .join(' ')
      const key = normalizeRoomName(phrase)
      if (!key) continue
      const original = targetMap.get(key)
      if (!original) continue
      const xs = words.slice(i, i + span).flatMap((w) => [w.xMin, w.xMax])
      const ys = words.slice(i, i + span).flatMap((w) => [w.yMin, w.yMax])
      out.push({
        name: original,
        xMin: Math.min(...xs),
        yMin: Math.min(...ys),
        xMax: Math.max(...xs),
        yMax: Math.max(...ys),
      })
      // skip the consumed window
      i += span - 1
      break
    }
  }
  return out
}

export async function colorMapFinishesForProject(
  organizationId: string,
  projectId: string,
): Promise<ColorMapResult> {
  const rooms = await prisma.takeoffItem.findMany({
    where: { organizationId, projectId, category: 'ROOM', deletedAt: null },
    select: { id: true, description: true, meta: true },
  })
  const result: ColorMapResult = {
    sheetsProcessed: 0,
    roomsConsidered: rooms.length,
    roomsMapped: 0,
    roomsUnchanged: 0,
    newlyMapped: 0,
    changedCode: 0,
    paletteSamplesFromDocument: 0,
    paletteSamplesCanonical: 0,
    perRoom: [],
  }
  if (rooms.length === 0) return result

  const roomNames = rooms.map((r) => r.description.split('—')[0]!.trim())
  // Aggregate the best assignment across all finish-plan sheets.
  const best = new Map<string, RoomColorAssignment>()

  // The handler is project-scoped, but a project usually has a single
  // active document; pick the most recent READY one.
  const document = await prisma.document.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { updatedAt: 'desc' },
  })
  if (!document) return result
  const sheets = await prisma.sheet.findMany({
    where: { documentId: document.id, sheetType: { in: ['finish_plan', 'legend'] } },
    orderBy: { pageNo: 'asc' },
  })
  const anchored = sheets.filter((s) => FINISH_PLAN_ANCHOR_RE.test(s.drawingNo ?? ''))
  if (anchored.length === 0) return result

  const blob = getBlobStore()
  const sourceBytes = await blob.get(document.storageKey)

  for (const sheet of anchored) {
    const image = await renderPageRgb(sourceBytes, sheet.pageNo, { dpi: 220 })
    const bbox = await renderPageBbox(sourceBytes, sheet.pageNo)
    const palette = buildPalette(image, bbox.words, CORE_LEGEND_CODES)
    for (const [, p] of palette) {
      if (p.fromDocument) result.paletteSamplesFromDocument += 1
      else result.paletteSamplesCanonical += 1
    }
    const roomBboxes = findRoomBboxes(bbox.words, roomNames)
    // S10-2(d) coordinate-carry: union the bboxes we can read from the
    // matching FLOOR plan (A101 ↔ I401, A102 ↔ I402) for room names
    // missing on the finish plan. Architectural and finish plans share
    // the same paper grid for ground/first floors on Plot 4357.
    const carry = COORDINATE_CARRY_PAIRS.find((pair) => pair.to === sheet.drawingNo)
    if (carry) {
      const partner = await prisma.sheet.findFirst({
        where: { documentId: document.id, drawingNo: carry.from },
      })
      if (partner) {
        const partnerBbox = await renderPageBbox(sourceBytes, partner.pageNo)
        const partnerRoomBboxes = findRoomBboxes(partnerBbox.words, roomNames)
        const knownNames = new Set(roomBboxes.map((b) => normalizeRoomName(b.name)))
        for (const candidate of partnerRoomBboxes) {
          const key = normalizeRoomName(candidate.name)
          if (knownNames.has(key)) continue
          roomBboxes.push(candidate)
          knownNames.add(key)
        }
      }
    }
    if (roomBboxes.length === 0) continue
    const assignments = mapRoomsToFinishCodes(image, roomBboxes, palette)
    for (const a of assignments) {
      if (a.finishCode === null) continue
      const key = normalizeRoomName(a.roomName)
      const existing = best.get(key)
      if (!existing || a.confidence > existing.confidence) best.set(key, a)
    }
    result.sheetsProcessed += 1
  }

  for (const room of rooms) {
    const meta = (room.meta ?? {}) as Record<string, unknown>
    const before = typeof meta.finish_code === 'string' ? meta.finish_code : null
    const name = room.description.split('—')[0]!.trim()
    const assignment = best.get(normalizeRoomName(name))
    if (!assignment) {
      if (before === null) continue
      // no new evidence — leave existing alone
      result.roomsUnchanged += 1
      continue
    }
    const after = assignment.finishCode
    if (after === before) {
      result.roomsUnchanged += 1
      continue
    }
    result.roomsMapped += 1
    if (before === null && after !== null) result.newlyMapped += 1
    if (before !== null && after !== null) result.changedCode += 1
    await prisma.takeoffItem.update({
      where: { id: room.id },
      data: {
        meta: {
          ...meta,
          finish_code: after,
          finishConfidence: assignment.confidence,
          finishSource: 'color-sample',
          finishReason: assignment.reason,
          sampledColor: assignment.sampledColor,
        } as Prisma.JsonObject,
      },
    })
    result.perRoom.push({
      roomId: room.id,
      name,
      before,
      after,
      confidence: assignment.confidence,
      source: assignment.reason,
    })
  }
  return result
}
