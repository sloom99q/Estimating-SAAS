/**
 * Anthropic client used by the takeoff handlers (CLASSIFY, EXTRACT_*).
 *
 * MODES (resolved at boot; see config.aiMode):
 *
 *   - 'live'  → /v1/messages with the versioned prompt and the tool's strict
 *               JSON schema. Token usage reported back through AiUsage.
 *   - 'stub'  → deterministic stub outputs from ./stubs.ts. NEVER allowed in
 *               production unless ALLOW_STUB_IN_PRODUCTION=true (architect
 *               escape hatch, not for general use). Sprint-3 SaaS-fairness
 *               rule: a paid org cannot get silently-stubbed results.
 *
 * Concurrency: live calls go through a global semaphore
 * `MAX_CONCURRENT_AI_CALLS` (default 4) so multiple workers can't blow past
 * the Anthropic org rate limit. The stub path is concurrency-free.
 *
 * Retry policy on live errors: 429 / 529 / 5xx → exponential backoff up to
 * 3 attempts (1s, 2s, 4s). Anything else surfaces — the job runner retries
 * the whole job under its own backoff.
 *
 * Stamping: every stub output has `promptVersion` suffixed with '-stub'.
 * Handlers also stamp `meta.stub=true` on Sheet/TakeoffItem rows so
 * fabricated data is unmistakable forever, even after migration.
 */
import { config } from '../config'
import {
  CLASSIFY_PROMPT_VERSION,
  CLASSIFY_SYSTEM_PROMPT,
  CLASSIFY_TOOL,
} from './prompts/classify.v1'
import {
  EXTRACT_SCHEDULE_PROMPT_VERSION,
  EXTRACT_SCHEDULE_SYSTEM_PROMPT,
  EXTRACT_SCHEDULE_TOOL,
} from './prompts/extractSchedule.v2'
import {
  EXTRACT_FINISH_LEGEND_PROMPT_VERSION,
  EXTRACT_FINISH_LEGEND_SYSTEM_PROMPT,
  EXTRACT_FINISH_LEGEND_TOOL,
} from './prompts/extractFinishLegend.v1'
import {
  EXTRACT_ROOMS_PROMPT_VERSION,
  EXTRACT_ROOMS_SYSTEM_PROMPT,
  EXTRACT_ROOMS_TOOL,
} from './prompts/extractRooms.v2'
import {
  stubClassify,
  stubExtractFinishLegend,
  stubExtractRooms,
  stubExtractSchedule,
} from './stubs'
import type {
  ClassifyInput,
  ClassifyOutput,
  ExtractFinishLegendInput,
  ExtractFinishLegendOutput,
  ExtractRoomsInput,
  ExtractRoomsOutput,
  ExtractScheduleInput,
  ExtractScheduleOutput,
} from './types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_RETRIES = 3

export const STUB_SUFFIX = '-stub'

/**
 * Resolved at boot. Architect's Sprint-2 review requires this be explicit and
 * loud — silent fallback was the failure mode we're closing.
 */
function effectiveMode(): 'live' | 'stub' {
  if (config.aiMode === 'live') {
    if (!config.anthropicApiKey) {
      throw new Error(
        'AI_MODE=live but ANTHROPIC_API_KEY is empty. Refusing to fire. ' +
          'Set the key or switch AI_MODE=stub for offline dev.',
      )
    }
    return 'live'
  }
  if (config.isProduction && !config.allowStubInProduction) {
    throw new Error(
      'AI_MODE=stub is not allowed in production (ALLOW_STUB_IN_PRODUCTION=false). ' +
        'A paying org cannot silently receive stubbed AI output.',
    )
  }
  return 'stub'
}

export function isStubMode(): boolean {
  return effectiveMode() === 'stub'
}

// ---------------------------------------------------------------------------
// Global concurrency cap on live calls (Sprint-3 A6)
// ---------------------------------------------------------------------------

let inFlight = 0
const waiters: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  if (inFlight < config.maxConcurrentAiCalls) {
    inFlight += 1
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  inFlight += 1
}

function releaseSlot(): void {
  inFlight -= 1
  const next = waiters.shift()
  if (next) next()
}

interface ContentBlock {
  type: string
  text?: string
  input?: unknown
  source?: { type: 'base64'; media_type: string; data: string }
}

interface MessagesResponse {
  content: ContentBlock[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Sprint-8 S8-8 R1 A/B: opus-4-8 dropped support for `temperature` (the API
 * returns 400 "temperature is deprecated for this model" if it's set). Strip
 * the field when the resolved model is in the no-temperature family before
 * we POST. Sonnet-4-6 (and earlier opus tiers) still accept it.
 */
/**
 * Models that REJECT a `temperature` param outright with HTTP 400. The
 * original Sprint-8 anchor matched only `claude-opus-4-8` / `4-9` /
 * `4-1x+` / `5-*`, but model IDs sometimes carry a date suffix
 * (`claude-opus-4-8-20260612`) and that anchor's trailing `$` caused
 * the strip to no-op. The new rule:
 *
 *   - opus-4-8 and newer (any -minor where -minor >= 8) → strip
 *   - opus-5+ → strip
 *   - any future opus tier we don't know about → strip (safer default
 *     because temperature became "deprecated" not "ignored")
 *
 * Sonnet / Haiku stay sensitive to temperature and continue to receive
 * it; deterministic 0 is still load-bearing for the extraction stages.
 */
const NO_TEMPERATURE_MODELS = /^claude-opus-(4-([89]|\d{2,})|[5-9]|\d{2,})/i

function sanitizeRequestBody(body: object): object {
  const b = body as Record<string, unknown>
  const model = typeof b.model === 'string' ? b.model : ''
  if (model && NO_TEMPERATURE_MODELS.test(model)) {
    if ('temperature' in b) {
      const { temperature: _t, ...rest } = b
      return rest
    }
  }
  return b
}

async function callMessages(body: object): Promise<MessagesResponse> {
  await acquireSlot()
  try {
    let attempt = 0
    while (true) {
      attempt += 1
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(sanitizeRequestBody(body)),
      })
      if (res.ok) return (await res.json()) as MessagesResponse
      const status = res.status
      const retriable = status === 429 || status === 529 || status >= 500
      if (!retriable || attempt >= MAX_RETRIES) {
        const text = await res.text().catch(() => '')
        throw new Error(`Anthropic ${status}: ${text || res.statusText}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)))
    }
  } finally {
    releaseSlot()
  }
}

function findToolInput(response: MessagesResponse, toolName: string): unknown {
  const block = response.content.find((b) => b.type === 'tool_use' && (b as { name?: string }).name === toolName) as
    | { input?: unknown }
    | undefined
  if (!block?.input) throw new Error(`Anthropic response missing tool_use:${toolName}`)
  return block.input
}

function buildImageBlock(jpegBase64: string | null): ContentBlock[] {
  if (!jpegBase64) return []
  return [
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 },
    },
  ]
}

// Sprint-3 A1: every stub output is stamped so fabricated data is forever
// distinguishable from real Anthropic output.
function stampStub<T extends { promptVersion: string }>(out: T): T {
  return { ...out, promptVersion: `${out.promptVersion}${STUB_SUFFIX}` }
}

// Sprint-3 A3: stub calls report zero Anthropic tokens (they didn't happen).
// We still want a counter for "stub work done" — handlers bump a separate
// `stubTokens` line on Usage so the bill stays honest but observability
// isn't blind.
function zeroTokens<T extends { tokensIn: number; tokensOut: number }>(out: T): T {
  return { ...out, tokensIn: 0, tokensOut: 0 }
}

// --- CLASSIFY -------------------------------------------------------------

export async function classifySheet(input: ClassifyInput): Promise<ClassifyOutput> {
  if (isStubMode()) return zeroTokens(stampStub(stubClassify(input)))
  const res = await callMessages({
    // Sprint-8 S8-8 R1 — CLASSIFY uses the cheap-tier model.
    model: config.anthropicModels.classify,
    max_tokens: 512,
    temperature: 0,
    system: CLASSIFY_SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          ...buildImageBlock(input.jpegBase64),
          {
            type: 'text',
            text: `Document=${input.documentId} page=${input.pageNo}/${input.totalPages}\n\nFirst 1500 chars of text layer:\n${input.textSnippet.slice(0, 1500)}`,
          },
        ],
      },
    ],
  })
  const raw = findToolInput(res, CLASSIFY_TOOL.name) as Partial<ClassifyOutput>
  return {
    drawing_no: raw.drawing_no ?? null,
    title: raw.title ?? null,
    discipline: raw.discipline ?? 'UNKNOWN',
    sheet_type: raw.sheet_type ?? 'other',
    scale: raw.scale ?? null,
    floor: raw.floor ?? null,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
    promptVersion: CLASSIFY_PROMPT_VERSION,
  }
}

// --- EXTRACT_SCHEDULES ----------------------------------------------------

export async function extractSchedule(
  input: ExtractScheduleInput,
): Promise<ExtractScheduleOutput> {
  if (isStubMode()) return zeroTokens(stampStub(stubExtractSchedule(input)))

  const hint = input.kindHint
    ? `Title heuristic suggests this is a ${input.kindHint} schedule, but trust your own eyes. If you see otherwise, set kind accordingly.`
    : 'The title heuristic is inconclusive — decide for yourself.'

  const res = await callMessages({
    // S8-8 R1 — schedules are vision work (CW table photos).
    model: config.anthropicModels.vision,
    max_tokens: 4096,
    temperature: 0,
    system: EXTRACT_SCHEDULE_SYSTEM_PROMPT,
    tools: [EXTRACT_SCHEDULE_TOOL],
    tool_choice: { type: 'tool', name: EXTRACT_SCHEDULE_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          ...buildImageBlock(input.jpegBase64),
          {
            type: 'text',
            text: `Document=${input.documentId} page=${input.pageNo}\n${hint}\n\nFirst 1500 chars of text layer:\n${input.textSnippet.slice(0, 1500)}`,
          },
        ],
      },
    ],
  })
  const raw = findToolInput(res, EXTRACT_SCHEDULE_TOOL.name) as {
    kind?: ExtractScheduleOutput['kind']
    rows?: ExtractScheduleOutput['rows']
  }
  return {
    kind: raw.kind === 'DOOR' || raw.kind === 'WINDOW' ? raw.kind : null,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
    promptVersion: EXTRACT_SCHEDULE_PROMPT_VERSION,
  }
}

// --- EXTRACT_ROOMS --------------------------------------------------------

export async function extractRooms(input: ExtractRoomsInput): Promise<ExtractRoomsOutput> {
  if (isStubMode()) return zeroTokens(stampStub(stubExtractRooms(input)))
  const legendBlurb =
    input.legendCodes && input.legendCodes.length > 0
      ? `Legend vocabulary (use ONLY these codes for finish_code; null is allowed; 'BATHROOM' is reserved for the per-bathroom-drawings hatch):\n  ${input.legendCodes.join(', ')}\n\n`
      : 'No legend vocabulary supplied yet — return finish_code=null on every room.\n\n'
  const res = await callMessages({
    // S8-8 R1 — rooms vision is the bulk of the spend; A/B target.
    model: config.anthropicModels.vision,
    max_tokens: 2048,
    temperature: 0,
    system: EXTRACT_ROOMS_SYSTEM_PROMPT,
    tools: [EXTRACT_ROOMS_TOOL],
    tool_choice: { type: 'tool', name: EXTRACT_ROOMS_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          ...buildImageBlock(input.jpegBase64),
          {
            type: 'text',
            text: `Document=${input.documentId} page=${input.pageNo} (rooms)\n\n${legendBlurb}First 1500 chars of text layer:\n${input.textSnippet.slice(0, 1500)}`,
          },
        ],
      },
    ],
  })
  const raw = findToolInput(res, EXTRACT_ROOMS_TOOL.name) as { rows?: ExtractRoomsOutput['rows'] }
  return {
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
    promptVersion: EXTRACT_ROOMS_PROMPT_VERSION,
  }
}

// --- EXTRACT_FINISH_LEGEND (Sprint 6) ------------------------------------

// --- ESTIMATE_KITCHEN (AI-est roadmap #3) ---------------------------------

import {
  KITCHEN_PROMPT_VERSION,
  KITCHEN_SYSTEM_PROMPT,
  KITCHEN_TOOL,
  normalizeKitchenVision,
  type KitchenEstimate,
  type KitchenVisionRaw,
} from './estimateKitchenPass'

export interface EstimateKitchenInput {
  documentId: string
  pageNo: number
  /** JPEG of the kitchen crop, already sized per computeKitchenCrop. */
  jpegBase64: string
  /** Display name used in the user-side text block. */
  roomName: string
}

export interface EstimateKitchenOutput {
  estimate: KitchenEstimate
  tokensIn: number
  tokensOut: number
  promptVersion: string
}

export async function estimateKitchen(
  input: EstimateKitchenInput,
): Promise<EstimateKitchenOutput> {
  if (isStubMode()) {
    return zeroTokens({
      estimate: normalizeKitchenVision({
        kitchenLayout: 'L',
        baseLm: 8.4,
        baseReasoning: 'south wall 4.2 m + west wall 4.2 m = 8.4 lm (stub)',
        wallLm: 5.2,
        wallReasoning: 'south wall only — west wall has a window (stub)',
        hasIsland: false,
        islandLm: 0,
        confidence: 55,
        uncertainty: 'STUB mode — no real vision performed.',
      }),
      promptVersion: KITCHEN_PROMPT_VERSION + '.stub',
    })
  }
  const res = await callMessages({
    // Per-stage model toggle (2026-06-20 expert call after the Sonnet-vs-
    // Opus A/B). Geometric reasoning categories use Opus by default; can
    // be overridden via ANTHROPIC_MODEL_KITCHEN.
    model: config.anthropicModels.kitchen,
    max_tokens: 1024,
    temperature: 0,
    system: KITCHEN_SYSTEM_PROMPT,
    tools: [KITCHEN_TOOL],
    tool_choice: { type: 'tool', name: KITCHEN_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          ...buildImageBlock(input.jpegBase64),
          {
            type: 'text',
            text: `Kitchen plan crop for room "${input.roomName}" on Document=${input.documentId} page=${input.pageNo}.\n\nReturn ONE kitchen_estimate tool call. Be explicit about uncertainty.`,
          },
        ],
      },
    ],
  })
  const raw = findToolInput(res, KITCHEN_TOOL.name) as KitchenVisionRaw
  return {
    estimate: normalizeKitchenVision(raw ?? {}),
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
    promptVersion: KITCHEN_PROMPT_VERSION,
  }
}

export async function extractFinishLegend(
  input: ExtractFinishLegendInput,
): Promise<ExtractFinishLegendOutput> {
  if (isStubMode()) return zeroTokens(stampStub(stubExtractFinishLegend(input)))
  const res = await callMessages({
    // S8-8 R1 — legend is now text-first (S8-1); this vision call is the
    // enricher path only. Still on the vision-tier model.
    model: config.anthropicModels.vision,
    max_tokens: 2048,
    temperature: 0,
    system: EXTRACT_FINISH_LEGEND_SYSTEM_PROMPT,
    tools: [EXTRACT_FINISH_LEGEND_TOOL],
    tool_choice: { type: 'tool', name: EXTRACT_FINISH_LEGEND_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          ...buildImageBlock(input.jpegBase64),
          {
            type: 'text',
            text: `Document=${input.documentId} page=${input.pageNo} (finish legend)\n\nFirst 2000 chars of text layer:\n${input.textSnippet.slice(0, 2000)}`,
          },
        ],
      },
    ],
  })
  const raw = findToolInput(res, EXTRACT_FINISH_LEGEND_TOOL.name) as {
    rows?: ExtractFinishLegendOutput['rows']
  }
  return {
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
    promptVersion: EXTRACT_FINISH_LEGEND_PROMPT_VERSION,
  }
}
