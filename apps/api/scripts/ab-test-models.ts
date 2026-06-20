/**
 * Salem's A/B — Sonnet vs Opus on the hardest tasks.
 *
 * Goal: are we hitting a MODEL STRENGTH ceiling, or a TASK/DRAWING ceiling?
 * Answers per-test by running the EXACT same input through both models.
 *
 *   bun apps/api/scripts/ab-test-models.ts <projectId> [--sonnet-only|--opus-only]
 *
 * Costs nothing in stub mode; ~$0.06 per full run live (one kitchen call
 * + one finish call on each of two models).
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '../src/config'
import { renderPageBboxWithDims } from '../src/ai/bboxRender'
import {
  KITCHEN_PROMPT_VERSION,
  KITCHEN_SYSTEM_PROMPT,
  KITCHEN_TOOL,
  composeKitchenReasoning,
  computeKitchenCrop,
  normalizeKitchenVision,
  parseScaleDenominator,
  type KitchenVisionRaw,
} from '../src/ai/estimateKitchenPass'
import { renderPageCropJpeg } from '../src/ai/pageCropRender'
import { getBlobStore } from '../src/blob/fs'
import { prisma } from '../src/db'
import { normalizeRoomName } from '../src/jobs/handlers/extractRooms'

const SONNET = 'claude-sonnet-4-6'
const OPUS = 'claude-opus-4-7'

// Pricing per million tokens (in USD). Numbers from Anthropic's public list
// as of 2026-06. Update when their rate card moves.
const PRICING: Record<string, { input: number; output: number }> = {
  [SONNET]: { input: 3, output: 15 },
  [OPUS]: { input: 15, output: 75 },
}
function costUsd(model: string, tokensIn: number, tokensOut: number): string {
  const p = PRICING[model]
  if (!p) return '?'
  const cents = (p.input * tokensIn + p.output * tokensOut) / 1_000_000
  return `$${cents.toFixed(4)}`
}

// ─────────────────────────────────────────────────────────────────────
// Low-level Claude call — bypasses anthropic.ts so we can pick model.
// Tool-call response, same as production estimators.
// ─────────────────────────────────────────────────────────────────────
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'

interface MessagesResponse {
  content: Array<{ type: string; name?: string; input?: unknown; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

// Opus 4-7 + every later Opus rejects `temperature`. Match 4-7 / 4-8 /
// 4-9 / any 4-NN with NN >= 7 / opus-5+ etc.
const NO_TEMPERATURE_RE = /^claude-opus-(4-([7-9]|\d{2,})|[5-9]|\d{2,})/i

async function callClaude(model: string, body: Record<string, unknown>): Promise<MessagesResponse> {
  const noTemp = NO_TEMPERATURE_RE.test(model)
  const payload = noTemp
    ? Object.fromEntries(Object.entries({ ...body, model }).filter(([k]) => k !== 'temperature'))
    : { ...body, model }
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Anthropic ${model} ${res.status}: ${text.slice(0, 300)}`)
  }
  return (await res.json()) as MessagesResponse
}

function findToolInput<T>(res: MessagesResponse, name: string): T | null {
  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === name) return block.input as T
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────
// Test 1 — KITCHEN. Same crop, same prompt, both models.
// ─────────────────────────────────────────────────────────────────────

interface KitchenCallResult {
  model: string
  cost: string
  tokensIn: number
  tokensOut: number
  layout: string
  baseLm: number
  wallLm: number
  hasIsland: boolean
  islandLm: number
  rawConfidence: number
  cappedConfidence: number
  baseReasoning: string
  wallReasoning: string
  uncertainty: string
  composedReasoningBase: string
  composedReasoningWall: string
}

async function runKitchenTest(args: {
  jpegBase64: string
  roomName: string
  documentId: string
  pageNo: number
  models: string[]
}): Promise<KitchenCallResult[]> {
  const results: KitchenCallResult[] = []
  for (const model of args.models) {
    console.log(`  → calling ${model}…`)
    const res = await callClaude(model, {
      max_tokens: 1024,
      temperature: 0,
      system: KITCHEN_SYSTEM_PROMPT,
      tools: [KITCHEN_TOOL],
      tool_choice: { type: 'tool', name: KITCHEN_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: args.jpegBase64 },
            },
            {
              type: 'text',
              text: `Kitchen plan crop for room "${args.roomName}" on Document=${args.documentId} page=${args.pageNo}.\n\nReturn ONE kitchen_estimate tool call. Be explicit about uncertainty.`,
            },
          ],
        },
      ],
    })
    const raw = findToolInput<KitchenVisionRaw>(res, KITCHEN_TOOL.name)
    const est = normalizeKitchenVision(raw ?? {})
    const tokensIn = res.usage?.input_tokens ?? 0
    const tokensOut = res.usage?.output_tokens ?? 0
    results.push({
      model,
      cost: costUsd(model, tokensIn, tokensOut),
      tokensIn,
      tokensOut,
      layout: est.layout,
      baseLm: est.baseLm,
      wallLm: est.wallLm,
      hasIsland: est.hasIsland,
      islandLm: est.islandLm,
      rawConfidence: raw?.confidence ?? 0,
      cappedConfidence: est.confidence,
      baseReasoning: est.baseReasoning,
      wallReasoning: est.wallReasoning,
      uncertainty: est.uncertainty,
      composedReasoningBase: composeKitchenReasoning('base', est),
      composedReasoningWall: composeKitchenReasoning('wall', est),
    })
  }
  return results
}

// ─────────────────────────────────────────────────────────────────────
// Test 2 — FINISH. Same room crop, same prompt, both models.
// ─────────────────────────────────────────────────────────────────────

const FINISH_SYSTEM_PROMPT = `You are a senior QS reviewing a residential villa floor finish plan. Your job is to identify which floor finish code applies to a specific room.

Allowed codes (from the project legend):
  ST01  white marble (interior)
  ST03  concrete porcelain (external pavement)
  PR01  marble-texture porcelain (interior)
  PR03  grey porcelain (service rooms, utility)
  BATHROOM  sentinel — finish per the bathroom drawings

Your output FEEDS A HUMAN EXPERT WHO WILL VERIFY EVERY ANSWER. An honest "ambiguous between PR01 and PR03 because color is faded" beats a confident guess. Use the room name as a strong signal where applicable (bedrooms typically PR01, service rooms PR03, bathrooms BATHROOM).

Output VIA the finish_code_for_room tool only.`

const FINISH_TOOL = {
  name: 'finish_code_for_room',
  description: 'Pick the floor-finish code for the given room, with reasoning + uncertainty.',
  input_schema: {
    type: 'object',
    properties: {
      finishCode: {
        type: 'string',
        enum: ['ST01', 'ST03', 'PR01', 'PR03', 'BATHROOM'],
      },
      reasoning: {
        type: 'string',
        description: 'One sentence: which signal led to the code (color, hatching, room name, adjacency).',
      },
      uncertainty: {
        type: 'string',
        description: 'REQUIRED. What was unclear, cut off, ambiguous. One sentence. Empty string only if everything was unambiguous.',
      },
      confidence: { type: 'number', description: 'Self-report 0-100. Capped at 60 client-side.' },
    },
    required: ['finishCode', 'reasoning', 'uncertainty', 'confidence'],
  },
} as const

interface FinishCallResult {
  model: string
  cost: string
  tokensIn: number
  tokensOut: number
  pickedCode: string
  reasoning: string
  uncertainty: string
  rawConfidence: number
}

async function runFinishTest(args: {
  jpegBase64: string
  roomName: string
  models: string[]
}): Promise<FinishCallResult[]> {
  const results: FinishCallResult[] = []
  for (const model of args.models) {
    console.log(`  → calling ${model}…`)
    const res = await callClaude(model, {
      max_tokens: 512,
      temperature: 0,
      system: FINISH_SYSTEM_PROMPT,
      tools: [FINISH_TOOL],
      tool_choice: { type: 'tool', name: FINISH_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: args.jpegBase64 },
            },
            {
              type: 'text',
              text: `Floor-finish plan crop for room "${args.roomName}". Identify the floor finish code applicable to THIS room (the labeled one in the crop). Be explicit about uncertainty.`,
            },
          ],
        },
      ],
    })
    type Raw = { finishCode?: string; reasoning?: string; uncertainty?: string; confidence?: number }
    const raw = findToolInput<Raw>(res, FINISH_TOOL.name)
    const tokensIn = res.usage?.input_tokens ?? 0
    const tokensOut = res.usage?.output_tokens ?? 0
    results.push({
      model,
      cost: costUsd(model, tokensIn, tokensOut),
      tokensIn,
      tokensOut,
      pickedCode: raw?.finishCode ?? '—',
      reasoning: raw?.reasoning ?? '',
      uncertainty: raw?.uncertainty ?? '',
      rawConfidence: raw?.confidence ?? 0,
    })
  }
  return results
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const projectId = args.find((a) => !a.startsWith('--'))
  if (!projectId) {
    console.error('Usage: bun apps/api/scripts/ab-test-models.ts <projectId>')
    process.exit(2)
  }
  const sonnetOnly = args.includes('--sonnet-only')
  const opusOnly = args.includes('--opus-only')
  const models = sonnetOnly ? [SONNET] : opusOnly ? [OPUS] : [SONNET, OPUS]

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, organizationId: true, name: true },
  })
  if (!project) throw new Error(`Project ${projectId} not found`)
  const document = await prisma.document.findFirst({
    where: { projectId, organizationId: project.organizationId, status: 'READY' },
    orderBy: { updatedAt: 'desc' },
  })
  if (!document) throw new Error('No READY document')
  const sourceBytes = await getBlobStore().get(document.storageKey)

  // ───── TEST 1 — KITCHEN ─────
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  TEST 1 — KITCHEN cabinet counting on BOH KITCHEN')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  Sonnet baseline from production: base=17.48 wall=10.5')
  console.log('  Contractor truth: base=10 wall=10')
  console.log('')

  const archSheets = await prisma.sheet.findMany({
    where: { documentId: document.id, organizationId: project.organizationId, sheetType: 'plan' },
    select: { id: true, pageNo: true, drawingNo: true, aiJson: true },
  })
  const targetSheets = archSheets.filter((s) => /^A1\d{2}\b/i.test(s.drawingNo ?? ''))

  const kitchens = await prisma.takeoffItem.findMany({
    where: {
      organizationId: project.organizationId,
      projectId,
      deletedAt: null,
      category: 'ROOM',
    },
    select: { id: true, description: true },
  })
  const bohKitchen = kitchens.find((k) => /BOH KITCHEN/i.test(k.description))
  if (!bohKitchen) throw new Error('No BOH KITCHEN room found')

  // Locate the label on A1xx
  let kitchenLoc: {
    sheet: (typeof targetSheets)[number]
    nameBox: { xMin: number; yMin: number; xMax: number; yMax: number }
    pageWidthPt: number
    pageHeightPt: number
  } | null = null
  const wantName = normalizeRoomName(bohKitchen.description)
  for (const sheet of targetSheets) {
    const { words, pageWidthPt, pageHeightPt } = await renderPageBboxWithDims(sourceBytes, sheet.pageNo)
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i]!
      const single = normalizeRoomName(w.text)
      if (single === wantName) {
        kitchenLoc = {
          sheet,
          nameBox: { xMin: w.xMin, yMin: w.yMin, xMax: w.xMax, yMax: w.yMax },
          pageWidthPt,
          pageHeightPt,
        }
        break
      }
      const next = words[i + 1]
      if (next) {
        const phrase = normalizeRoomName(`${w.text} ${next.text}`)
        if (phrase === wantName) {
          kitchenLoc = {
            sheet,
            nameBox: {
              xMin: Math.min(w.xMin, next.xMin),
              yMin: Math.min(w.yMin, next.yMin),
              xMax: Math.max(w.xMax, next.xMax),
              yMax: Math.max(w.yMax, next.yMax),
            },
            pageWidthPt,
            pageHeightPt,
          }
          break
        }
      }
    }
    if (kitchenLoc) break
  }
  if (!kitchenLoc) throw new Error('Kitchen label not found on any A1xx plan')
  const aiJson = (kitchenLoc.sheet.aiJson ?? {}) as { scale?: string | null }
  const scaleDen = parseScaleDenominator(aiJson.scale)
  const KDPI = 220
  const sheetPxW = Math.round((kitchenLoc.pageWidthPt * KDPI) / 72)
  const sheetPxH = Math.round((kitchenLoc.pageHeightPt * KDPI) / 72)
  const crop = computeKitchenCrop({
    nameBox: kitchenLoc.nameBox,
    scaleDenominator: scaleDen,
    renderDpi: KDPI,
    sheetPixelWidth: sheetPxW,
    sheetPixelHeight: sheetPxH,
    sheetPointWidth: kitchenLoc.pageWidthPt,
    sheetPointHeight: kitchenLoc.pageHeightPt,
  })
  console.log(`  crop: ${crop.width}x${crop.height} px at ${KDPI} DPI on ${kitchenLoc.sheet.drawingNo} (page ${kitchenLoc.sheet.pageNo})`)
  const kitchenJpeg = await renderPageCropJpeg(sourceBytes, {
    pageNo: kitchenLoc.sheet.pageNo,
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    dpi: KDPI,
  })

  // Save the crop for the user to inspect.
  const tmpKitchenPath = path.join(os.tmpdir(), `ab-kitchen-${Date.now()}.jpg`)
  await fs.writeFile(tmpKitchenPath, Buffer.from(kitchenJpeg, 'base64'))
  console.log(`  crop saved: ${tmpKitchenPath}`)
  console.log('')

  const kitchenResults = await runKitchenTest({
    jpegBase64: kitchenJpeg,
    roomName: 'BOH KITCHEN',
    documentId: document.id,
    pageNo: kitchenLoc.sheet.pageNo,
    models,
  })

  for (const r of kitchenResults) {
    console.log('')
    console.log(`  ── ${r.model} ──`)
    console.log(`     layout: ${r.layout}${r.hasIsland ? ' + island' : ''}`)
    console.log(`     base:  ${r.baseLm.toFixed(2)} lm  (contractor 10)`)
    console.log(`     wall:  ${r.wallLm.toFixed(2)} lm  (contractor 10)`)
    console.log(`     conf:  raw=${r.rawConfidence} capped=${r.cappedConfidence}`)
    console.log(`     tokens: in=${r.tokensIn} out=${r.tokensOut} cost=${r.cost}`)
    console.log(`     baseReasoning: ${r.baseReasoning}`)
    console.log(`     wallReasoning: ${r.wallReasoning}`)
    console.log(`     uncertainty: ${r.uncertainty}`)
  }

  // ───── TEST 2 — FINISH ─────
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  TEST 2 — FINISH code identification on CORRIDOR')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  Sonnet original suggestion (per user): PR03 (wrong)')
  console.log('  Contractor truth: PR01')
  console.log('')

  const corridor = kitchens.find((k) => /\bCORRIDOR\b/i.test(k.description))
  if (!corridor) {
    console.log('  No CORRIDOR room found — skipping finish test.')
  } else {
    // Find CORRIDOR label on the I401/I402 FINISH plan (where colours live)
    const finishSheets = await prisma.sheet.findMany({
      where: { documentId: document.id, organizationId: project.organizationId, sheetType: 'finish_plan' },
      select: { id: true, pageNo: true, drawingNo: true, aiJson: true },
    })
    const i4Sheets = finishSheets.filter((s) => /^I4\d{2}\b/i.test(s.drawingNo ?? ''))
    const wantCorridor = normalizeRoomName(corridor.description)
    let corridorLoc: {
      sheet: (typeof i4Sheets)[number]
      nameBox: { xMin: number; yMin: number; xMax: number; yMax: number }
      pageWidthPt: number
      pageHeightPt: number
    } | null = null
    for (const sheet of i4Sheets) {
      const { words, pageWidthPt, pageHeightPt } = await renderPageBboxWithDims(sourceBytes, sheet.pageNo)
      for (const w of words) {
        if (normalizeRoomName(w.text) === wantCorridor) {
          corridorLoc = {
            sheet,
            nameBox: { xMin: w.xMin, yMin: w.yMin, xMax: w.xMax, yMax: w.yMax },
            pageWidthPt,
            pageHeightPt,
          }
          break
        }
      }
      if (corridorLoc) break
    }
    if (!corridorLoc) {
      console.log('  CORRIDOR label not on any I4xx sheet — skipping finish test.')
    } else {
      const cAi = (corridorLoc.sheet.aiJson ?? {}) as { scale?: string | null }
      const cScale = parseScaleDenominator(cAi.scale)
      const cSheetPxW = Math.round((corridorLoc.pageWidthPt * KDPI) / 72)
      const cSheetPxH = Math.round((corridorLoc.pageHeightPt * KDPI) / 72)
      const cCrop = computeKitchenCrop({
        nameBox: corridorLoc.nameBox,
        scaleDenominator: cScale,
        renderDpi: KDPI,
        sheetPixelWidth: cSheetPxW,
        sheetPixelHeight: cSheetPxH,
        sheetPointWidth: corridorLoc.pageWidthPt,
        sheetPointHeight: corridorLoc.pageHeightPt,
      })
      console.log(`  crop: ${cCrop.width}x${cCrop.height} px on ${corridorLoc.sheet.drawingNo} (page ${corridorLoc.sheet.pageNo})`)
      const corridorJpeg = await renderPageCropJpeg(sourceBytes, {
        pageNo: corridorLoc.sheet.pageNo,
        x: cCrop.x,
        y: cCrop.y,
        width: cCrop.width,
        height: cCrop.height,
        dpi: KDPI,
      })
      const tmpFinishPath = path.join(os.tmpdir(), `ab-finish-${Date.now()}.jpg`)
      await fs.writeFile(tmpFinishPath, Buffer.from(corridorJpeg, 'base64'))
      console.log(`  crop saved: ${tmpFinishPath}`)
      console.log('')

      const finishResults = await runFinishTest({
        jpegBase64: corridorJpeg,
        roomName: 'CORRIDOR',
        models,
      })
      for (const r of finishResults) {
        console.log('')
        console.log(`  ── ${r.model} ──`)
        console.log(`     picked: ${r.pickedCode}  (contractor PR01)`)
        console.log(`     confidence: ${r.rawConfidence}`)
        console.log(`     reasoning:   ${r.reasoning}`)
        console.log(`     uncertainty: ${r.uncertainty}`)
        console.log(`     tokens: in=${r.tokensIn} out=${r.tokensOut} cost=${r.cost}`)
      }
    }
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  Prompt versions: kitchen=' + KITCHEN_PROMPT_VERSION + '  finish=ab.v1')
  console.log('  Done.')
  console.log('═══════════════════════════════════════════════════════════════════')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
