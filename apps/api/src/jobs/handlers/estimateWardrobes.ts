/**
 * ESTIMATE_WARDROBES handler — AI-est roadmap #4a.
 *
 *   payload = { projectId }
 *
 * Opt-in only. For each BEDROOM-named ROOM TakeoffItem in the project,
 * locate its label on the A1xx architectural plan, crop generously,
 * and ask Opus for the wardrobe lm count + hatching pattern + explicit
 * uncertainty.
 *
 * Output: ONE TakeoffItem per bedroom, basis='ESTIMATED', status='AI'.
 *   WD-<roomId8>  category=JOINERY  unit='lm'  → null rate → P/S
 *
 * Expert verifies hatching pattern + overrides qtyFinal + types the
 * per-lm rate inline (no guessed joinery price per the hard rule).
 *
 * Crop floor is 1500x1500 (bedrooms larger than kitchens). 1.5 m margin
 * either side, clamped to sheet bounds. Same pdftoppm + bbox tooling
 * as kitchen.
 */
import type { Prisma } from '@prisma/client'
import { estimateWardrobe } from '../../ai/anthropic'
import { renderPageBboxWithDims } from '../../ai/bboxRender'
import {
  composeKitchenReasoning as _unusedComposeKitchen, // kept for symmetry; not used here
  computeKitchenCrop,
  parseScaleDenominator,
} from '../../ai/estimateKitchenPass'
import { composeWardrobeReasoning } from '../../ai/estimateWardrobesPass'
import { renderPageCropJpeg } from '../../ai/pageCropRender'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import type { JobHandler, JobRecord } from '../types'
import { normalizeRoomName } from './extractRooms'

void _unusedComposeKitchen

interface EstimateWardrobesPayload {
  projectId: string
}

/**
 * Bedroom locator — over-suggest + cull per the expert call (2026-06-20).
 * Include MASTER, GUEST, BD prefix, B1/B2/BF basement bedrooms, BED 01
 * style numbered bedrooms, BEDROOM with no qualifier. Expert deletes the
 * false positives.
 */
const BEDROOM_NAME_RE = /\bBEDROOM\b|\bBED\s+ROOM\b|\bBED\s+\d{1,2}\b|\bBD\s+(?:BEDROOM|ROOM)\b/i

/**
 * Drop false-positive contexts where the bedroom keyword is incidental:
 * SKYLIGHT 04 ABOVE BEDROOM, VOID OVER MASTER BEDROOM, etc.
 */
const NON_ROOM_BEDROOM_CONTEXT_RE = /\b(SKYLIGHT|VOID|ABOVE|OVER|UNDER)\b/i

const ARCH_PLAN_DRAWING_RE = /^A1\d{2}\b/i
const WARDROBE_RENDER_DPI = 220
/** Bedrooms are bigger than kitchens; floor the crop generously. */
const BEDROOM_MIN_CROP_PX = 1500

interface BedroomLocation {
  roomId: string
  roomName: string
  pageNo: number
  drawingNo: string | null
  nameBox: { xMin: number; yMin: number; xMax: number; yMax: number }
  pageWidthPt: number
  pageHeightPt: number
  scale: string | null
}

async function locateBedrooms(
  organizationId: string,
  projectId: string,
  documentId: string,
  sourceBytes: Buffer,
): Promise<BedroomLocation[]> {
  const rooms = await prisma.takeoffItem.findMany({
    where: { organizationId, projectId, deletedAt: null, category: 'ROOM' },
    select: { id: true, description: true },
  })
  const bedrooms = rooms.filter(
    (r) => BEDROOM_NAME_RE.test(r.description) && !NON_ROOM_BEDROOM_CONTEXT_RE.test(r.description),
  )
  if (bedrooms.length === 0) return []

  const archSheets = await prisma.sheet.findMany({
    where: { documentId, organizationId, sheetType: 'plan' },
    select: { id: true, pageNo: true, drawingNo: true, aiJson: true },
  })
  const targetSheets = archSheets.filter((s) => ARCH_PLAN_DRAWING_RE.test(s.drawingNo ?? ''))
  if (targetSheets.length === 0) return []

  const out: BedroomLocation[] = []
  for (const r of bedrooms) {
    const wantName = normalizeRoomName(r.description)
    let bestHit: {
      sheet: (typeof targetSheets)[number]
      nameBox: { xMin: number; yMin: number; xMax: number; yMax: number }
      pageWidthPt: number
      pageHeightPt: number
    } | null = null
    for (const sheet of targetSheets) {
      const { words, pageWidthPt, pageHeightPt } = await renderPageBboxWithDims(sourceBytes, sheet.pageNo)
      for (let i = 0; i < words.length; i += 1) {
        const w = words[i]!
        let nameBox: { xMin: number; yMin: number; xMax: number; yMax: number } | null = null
        const single = normalizeRoomName(w.text)
        if (single === wantName) {
          nameBox = { xMin: w.xMin, yMin: w.yMin, xMax: w.xMax, yMax: w.yMax }
        } else {
          const next = words[i + 1]
          if (next) {
            const phrase = normalizeRoomName(`${w.text} ${next.text}`)
            if (phrase === wantName) {
              nameBox = {
                xMin: Math.min(w.xMin, next.xMin),
                yMin: Math.min(w.yMin, next.yMin),
                xMax: Math.max(w.xMax, next.xMax),
                yMax: Math.max(w.yMax, next.yMax),
              }
            }
          }
        }
        if (nameBox) {
          bestHit = { sheet, nameBox, pageWidthPt, pageHeightPt }
          break
        }
      }
      if (bestHit) break
    }
    if (!bestHit) continue
    const aiJson = (bestHit.sheet.aiJson ?? {}) as { scale?: string | null }
    out.push({
      roomId: r.id,
      roomName: r.description.split('—')[0]!.trim(),
      pageNo: bestHit.sheet.pageNo,
      drawingNo: bestHit.sheet.drawingNo,
      nameBox: bestHit.nameBox,
      pageWidthPt: bestHit.pageWidthPt,
      pageHeightPt: bestHit.pageHeightPt,
      scale: aiJson.scale ?? null,
    })
  }
  return out
}

/**
 * Same crop strategy as kitchen but with a larger MIN floor — bedrooms
 * are bigger rooms and the wardrobe wall is often at the back, away
 * from the label.
 */
function computeBedroomCrop(args: Parameters<typeof computeKitchenCrop>[0]) {
  const crop = computeKitchenCrop(args)
  const minPx = BEDROOM_MIN_CROP_PX
  let { x, y, width, height } = crop
  if (width < minPx) {
    const cx = x + width / 2
    width = Math.min(args.sheetPixelWidth, minPx)
    x = Math.max(0, Math.min(args.sheetPixelWidth - width, cx - width / 2))
  }
  if (height < minPx) {
    const cy = y + height / 2
    height = Math.min(args.sheetPixelHeight, minPx)
    y = Math.max(0, Math.min(args.sheetPixelHeight - height, cy - height / 2))
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export const estimateWardrobesHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as EstimateWardrobesPayload
  if (!payload.projectId) throw new Error('ESTIMATE_WARDROBES: payload.projectId required')

  const document = await prisma.document.findFirst({
    where: { projectId: payload.projectId, organizationId: job.organizationId, status: 'READY' },
    orderBy: { updatedAt: 'desc' },
  })
  if (!document) {
    return { ok: true, message: 'No READY document; nothing to estimate.', estimates: [] }
  }
  const blob = getBlobStore()
  const sourceBytes = await blob.get(document.storageKey)

  const bedrooms = await locateBedrooms(
    job.organizationId,
    payload.projectId,
    document.id,
    sourceBytes,
  )
  if (bedrooms.length === 0) {
    return {
      ok: true,
      message:
        'No bedroom rooms found in extraction OR bedroom labels could not be located on the A1xx plans.',
      estimates: [],
    }
  }

  let totalTokensIn = 0
  let totalTokensOut = 0
  const results: Array<{
    roomId: string
    roomName: string
    wardrobeLm: number
    hatchingPattern: string
    layoutKind: string
    confidence: number
    uncertainty: string
  }> = []

  for (const b of bedrooms) {
    const scaleDenominator = parseScaleDenominator(b.scale)
    const sheetPixelWidth = Math.round((b.pageWidthPt * WARDROBE_RENDER_DPI) / 72)
    const sheetPixelHeight = Math.round((b.pageHeightPt * WARDROBE_RENDER_DPI) / 72)
    const crop = computeBedroomCrop({
      nameBox: b.nameBox,
      scaleDenominator,
      renderDpi: WARDROBE_RENDER_DPI,
      sheetPixelWidth,
      sheetPixelHeight,
      sheetPointWidth: b.pageWidthPt,
      sheetPointHeight: b.pageHeightPt,
    })
    let jpegBase64: string
    try {
      jpegBase64 = await renderPageCropJpeg(sourceBytes, {
        pageNo: b.pageNo,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        dpi: WARDROBE_RENDER_DPI,
      })
    } catch (err) {
      console.error(`[estimateWardrobes] crop render failed for ${b.roomName}:`, err)
      continue
    }

    const visionRes = await estimateWardrobe({
      documentId: document.id,
      pageNo: b.pageNo,
      jpegBase64,
      roomName: b.roomName,
    })
    totalTokensIn += visionRes.tokensIn
    totalTokensOut += visionRes.tokensOut
    const est = visionRes.estimate

    const tag = `WD-${b.roomId.slice(-8)}`
    const reasoning = composeWardrobeReasoning(est)

    await upsertWardrobeItem({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      tag,
      description: `Built-in wardrobes (HPL) — ${b.roomName}`,
      qtyLm: est.totalLm,
      confidence: est.confidence,
      reasoning,
      meta: {
        roomId: b.roomId,
        roomName: b.roomName,
        pageNo: b.pageNo,
        drawingNo: b.drawingNo,
        estimationSource: 'vision-wardrobe-pass',
        promptVersion: visionRes.promptVersion,
        hatchingPattern: est.hatchingPattern,
        layoutKind: est.layoutKind,
        wallsWithWardrobes: est.wallsWithWardrobes,
        uncertainty: est.uncertainty,
        rateHint: 'WD-HPL-LM',
        estimationReasoning: reasoning,
      },
    })

    results.push({
      roomId: b.roomId,
      roomName: b.roomName,
      wardrobeLm: est.totalLm,
      hatchingPattern: est.hatchingPattern,
      layoutKind: est.layoutKind,
      confidence: est.confidence,
      uncertainty: est.uncertainty,
    })
  }

  return {
    ok: true,
    bedroomsProcessed: bedrooms.length,
    estimates: results,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
  }
}

async function upsertWardrobeItem(args: {
  organizationId: string
  projectId: string
  tag: string
  description: string
  qtyLm: number
  confidence: number
  reasoning: string
  meta: Record<string, unknown>
}): Promise<void> {
  const existing = await prisma.takeoffItem.findFirst({
    where: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      tag: args.tag,
      deletedAt: null,
    },
    select: { id: true, status: true },
  })
  if (existing) {
    const nextStatus = existing.status === 'AI' ? 'AI' : existing.status
    await prisma.takeoffItem.update({
      where: { id: existing.id },
      data: {
        description: args.description,
        unit: 'lm',
        qtyAi: args.qtyLm,
        qtyFinal: args.qtyLm,
        basis: 'ESTIMATED',
        confidence: args.confidence,
        sourceNote: args.reasoning,
        meta: args.meta as Prisma.JsonObject,
        status: nextStatus,
      },
    })
    return
  }
  await prisma.takeoffItem.create({
    data: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      category: 'JOINERY',
      tag: args.tag,
      description: args.description,
      unit: 'lm',
      qtyAi: args.qtyLm,
      qtyFinal: args.qtyLm,
      basis: 'ESTIMATED',
      confidence: args.confidence,
      sourceNote: args.reasoning,
      meta: args.meta as Prisma.JsonObject,
      status: 'AI',
    },
  })
}
