/**
 * ESTIMATE_KITCHEN handler — AI-est roadmap #3.
 *
 *   payload = { projectId }
 *
 * Opt-in only. Triggered by the SPA "Estimate kitchen" button. For each
 * KITCHEN-named ROOM in the project, finds its bbox on A101 via
 * pdftotext, crops the rendered page generously (1.5 m margin or 300 px,
 * whichever is larger; min 1200×1200), and asks Sonnet for base + wall
 * cabinet linear meters with explicit uncertainty.
 *
 * Output: TWO TakeoffItems per kitchen, both at basis='ESTIMATED',
 * status='AI'. Tags:
 *   - KB-<roomId8>  category=JOINERY  unit='lm'  → KIT-BASE  (1200 AED/lm)
 *   - KW-<roomId8>  category=JOINERY  unit='lm'  → KIT-WALL  (1100 AED/lm)
 *
 * Reasoning sub-line shown in the verify UI carries layout, per-wall
 * breakdown, and an explicit UNCERTAINTY statement. Confidence is
 * hard-capped at 60 server-side regardless of the model's self-report.
 */
import type { Prisma } from '@prisma/client'
import { estimateKitchen } from '../../ai/anthropic'
import { renderPageBboxWithDims } from '../../ai/bboxRender'
import {
  composeKitchenReasoning,
  computeKitchenCrop,
  parseScaleDenominator,
} from '../../ai/estimateKitchenPass'
import { renderPageCropJpeg } from '../../ai/pageCropRender'
import { getBlobStore } from '../../blob/fs'
import { prisma } from '../../db'
import type { JobHandler, JobRecord } from '../types'
import { normalizeRoomName } from './extractRooms'

interface EstimateKitchenPayload {
  projectId: string
}

const KITCHEN_NAME_RE = /\bKITCHEN\b/i
const KITCHEN_RENDER_DPI = 220

/**
 * Architectural floor plan drawings (A101/A102/A103). The CABINET
 * LAYOUT lives on these — finish-plan sheets (I101/I401 etc.) show
 * finish codes but not cabinet runs. The handler scans these to find
 * the kitchen label, regardless of which sheet the ROOM was originally
 * extracted from.
 */
const ARCH_PLAN_DRAWING_RE = /^A1\d{2}\b/i

interface KitchenLocation {
  roomId: string
  roomName: string
  pageNo: number
  drawingNo: string | null
  nameBox: { xMin: number; yMin: number; xMax: number; yMax: number }
  pageWidthPt: number
  pageHeightPt: number
  scale: string | null
}

/**
 * Find every KITCHEN-named ROOM TakeoffItem in the project; for each,
 * locate its label bbox on the source sheet by re-running pdftotext
 * -bbox-layout (zero AI cost). Returns the union — multi-kitchen villas
 * get an estimate per kitchen, per the design.
 */
async function locateKitchens(
  organizationId: string,
  projectId: string,
  documentId: string,
  sourceBytes: Buffer,
): Promise<KitchenLocation[]> {
  const rooms = await prisma.takeoffItem.findMany({
    where: { organizationId, projectId, deletedAt: null, category: 'ROOM' },
    select: { id: true, description: true },
  })
  const kitchens = rooms.filter((r) => KITCHEN_NAME_RE.test(r.description))
  if (kitchens.length === 0) return []

  // Search the ARCHITECTURAL FLOOR PLANS (A101/A102/A103) for the
  // kitchen label — that's where the cabinet layout is drawn. The
  // ROOM may have been extracted from a finish-plan sheet (I-series)
  // which shows finish codes but not cabinet detail; cropping there
  // gives the vision pass nothing to count.
  const archSheets = await prisma.sheet.findMany({
    where: { documentId, organizationId, sheetType: 'plan' },
    select: { id: true, pageNo: true, drawingNo: true, aiJson: true },
  })
  const targetSheets = archSheets.filter((s) => ARCH_PLAN_DRAWING_RE.test(s.drawingNo ?? ''))
  if (targetSheets.length === 0) return []

  const out: KitchenLocation[] = []
  for (const k of kitchens) {
    const wantName = normalizeRoomName(k.description)
    let bestHit: {
      sheet: (typeof targetSheets)[number]
      nameBox: { xMin: number; yMin: number; xMax: number; yMax: number }
      pageWidthPt: number
      pageHeightPt: number
    } | null = null
    for (const sheet of targetSheets) {
      const { words, pageWidthPt, pageHeightPt } = await renderPageBboxWithDims(
        sourceBytes,
        sheet.pageNo,
      )
      for (let i = 0; i < words.length; i += 1) {
        const w = words[i]!
        const single = normalizeRoomName(w.text)
        let nameBox: { xMin: number; yMin: number; xMax: number; yMax: number } | null = null
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
      roomId: k.id,
      roomName: k.description.split('—')[0]!.trim(),
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

export const estimateKitchenHandler: JobHandler = async (job: JobRecord) => {
  const payload = (job.payload ?? {}) as EstimateKitchenPayload
  if (!payload.projectId) throw new Error('ESTIMATE_KITCHEN: payload.projectId required')

  // MULTI-DOC #1 (2026-06-21) — iterate ALL READY documents in the
  // project, not just the most recent. The kitchen room's
  // architectural plan might live in any of them. First-hit-wins per
  // roomId: iterate newest doc first so revised drawings take
  // precedence over older revisions.
  const documents = await prisma.document.findMany({
    where: { projectId: payload.projectId, organizationId: job.organizationId, status: 'READY' },
    orderBy: { updatedAt: 'desc' },
  })
  if (documents.length === 0) {
    return { ok: true, message: 'No READY documents; nothing to estimate.', estimates: [] }
  }
  const blob = getBlobStore()
  const blobsByDoc = new Map<string, Buffer>()
  for (const d of documents) {
    blobsByDoc.set(d.id, await blob.get(d.storageKey))
  }
  const seenRoomIds = new Set<string>()
  const kitchens: Array<Awaited<ReturnType<typeof locateKitchens>>[number] & { documentId: string }> = []
  for (const doc of documents) {
    const found = await locateKitchens(
      job.organizationId,
      payload.projectId,
      doc.id,
      blobsByDoc.get(doc.id)!,
    )
    for (const k of found) {
      if (seenRoomIds.has(k.roomId)) continue
      seenRoomIds.add(k.roomId)
      kitchens.push({ ...k, documentId: doc.id })
    }
  }
  if (kitchens.length === 0) {
    return {
      ok: true,
      message:
        'No kitchen room found in extraction OR kitchen label could not be located on any document. Confirm a ROOM with name containing KITCHEN exists.',
      estimates: [],
    }
  }

  let totalTokensIn = 0
  let totalTokensOut = 0
  const results: Array<{
    roomId: string
    roomName: string
    baseLm: number
    wallLm: number
    confidence: number
    layout: string
    hasIsland: boolean
    uncertainty: string
  }> = []

  for (const k of kitchens) {
    const scaleDenominator = parseScaleDenominator(k.scale)
    // Page pixels at our render DPI (used to clamp the crop). 220 DPI on
    // an A1 sheet (~1190 × 842 pt) gives ~3636 × 2572 px.
    const sheetPixelWidth = Math.round((k.pageWidthPt * KITCHEN_RENDER_DPI) / 72)
    const sheetPixelHeight = Math.round((k.pageHeightPt * KITCHEN_RENDER_DPI) / 72)
    const crop = computeKitchenCrop({
      nameBox: k.nameBox,
      scaleDenominator,
      renderDpi: KITCHEN_RENDER_DPI,
      sheetPixelWidth,
      sheetPixelHeight,
      sheetPointWidth: k.pageWidthPt,
      sheetPointHeight: k.pageHeightPt,
    })
    const docBytes = blobsByDoc.get(k.documentId)!
    let jpegBase64: string
    try {
      jpegBase64 = await renderPageCropJpeg(docBytes, {
        pageNo: k.pageNo,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        dpi: KITCHEN_RENDER_DPI,
      })
    } catch (err) {
      console.error(`[estimateKitchen] crop render failed for ${k.roomName}:`, err)
      continue
    }

    const visionRes = await estimateKitchen({
      documentId: k.documentId,
      pageNo: k.pageNo,
      jpegBase64,
      roomName: k.roomName,
    })
    totalTokensIn += visionRes.tokensIn
    totalTokensOut += visionRes.tokensOut
    const est = visionRes.estimate

    const baseTag = `KB-${k.roomId.slice(-8)}`
    const wallTag = `KW-${k.roomId.slice(-8)}`
    const counterTag = `KC-${k.roomId.slice(-8)}`
    const baseReasoning = composeKitchenReasoning('base', est)
    const wallReasoning = composeKitchenReasoning('wall', est)
    const counterReasoning = composeKitchenReasoning('counter', est)
    const sharedMeta = {
      roomId: k.roomId,
      roomName: k.roomName,
      pageNo: k.pageNo,
      drawingNo: k.drawingNo,
      estimationSource: 'vision-kitchen-pass',
      promptVersion: visionRes.promptVersion,
      layout: est.layout,
      hasIsland: est.hasIsland,
      islandLm: est.islandLm,
      visionRawConfidence: est.confidence,
      uncertainty: est.uncertainty,
    }

    // upsert BASE row (status='AI' — never auto-enters BOQ until Confirmed)
    await upsertKitchenItem({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      tag: baseTag,
      description: `Kitchen base unit (HPL) — ${k.roomName}`,
      qtyLm: est.baseLm + (est.hasIsland ? est.islandLm : 0),
      confidence: est.confidence,
      reasoning: baseReasoning,
      meta: { ...sharedMeta, kind: 'base', rateHint: 'KIT-BASE', estimationReasoning: baseReasoning },
    })
    // upsert WALL row
    await upsertKitchenItem({
      organizationId: job.organizationId,
      projectId: payload.projectId,
      tag: wallTag,
      description: `Kitchen wall unit (HPL) — ${k.roomName}`,
      qtyLm: est.wallLm,
      confidence: est.confidence,
      reasoning: wallReasoning,
      meta: { ...sharedMeta, kind: 'wall', rateHint: 'KIT-WALL', estimationReasoning: wallReasoning },
    })
    // AI-est roadmap #4b — COUNTERTOP row. Folded into the same Opus
    // call as base/wall above (no extra token cost). Rate stays NULL —
    // expert types the per-lm cost since stone-top pricing varies a lot
    // (600-1500 AED/lm depending on stone). PRICE waterfall returns
    // null → isProvisional=true → enters BOQ as P/S with the lm count.
    if (est.countertopLm > 0) {
      await upsertKitchenItem({
        organizationId: job.organizationId,
        projectId: payload.projectId,
        tag: counterTag,
        description: `Kitchen countertop — ${k.roomName}`,
        qtyLm: est.countertopLm,
        confidence: est.confidence,
        reasoning: counterReasoning,
        meta: { ...sharedMeta, kind: 'counter', rateHint: 'KIT-COUNTER', estimationReasoning: counterReasoning },
      })
    }

    results.push({
      roomId: k.roomId,
      roomName: k.roomName,
      baseLm: est.baseLm + (est.hasIsland ? est.islandLm : 0),
      wallLm: est.wallLm,
      confidence: est.confidence,
      layout: est.layout,
      hasIsland: est.hasIsland,
      uncertainty: est.uncertainty,
    })
  }

  return {
    ok: true,
    kitchensProcessed: kitchens.length,
    estimates: results,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
  }
}

async function upsertKitchenItem(args: {
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
    // If the reviewer has already promoted this estimate (EDITED/APPROVED),
    // don't demote it back to AI on a re-click. Refresh the qty/reasoning
    // but keep the status.
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
