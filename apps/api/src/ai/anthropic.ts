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
  EXTRACT_DOORS_PROMPT_VERSION,
  EXTRACT_DOORS_SYSTEM_PROMPT,
  EXTRACT_DOORS_TOOL,
} from './prompts/extractDoors.v1'
import {
  EXTRACT_WINDOWS_PROMPT_VERSION,
  EXTRACT_WINDOWS_SYSTEM_PROMPT,
  EXTRACT_WINDOWS_TOOL,
} from './prompts/extractWindows.v1'
import {
  EXTRACT_ROOMS_PROMPT_VERSION,
  EXTRACT_ROOMS_SYSTEM_PROMPT,
  EXTRACT_ROOMS_TOOL,
} from './prompts/extractRooms.v1'
import { stubClassify, stubExtractRooms, stubExtractSchedule } from './stubs'
import type {
  ClassifyInput,
  ClassifyOutput,
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
        body: JSON.stringify(body),
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
    model: config.anthropicModel,
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
  const tool = input.kind === 'DOOR' ? EXTRACT_DOORS_TOOL : EXTRACT_WINDOWS_TOOL
  const systemPrompt =
    input.kind === 'DOOR' ? EXTRACT_DOORS_SYSTEM_PROMPT : EXTRACT_WINDOWS_SYSTEM_PROMPT
  const promptVersion =
    input.kind === 'DOOR' ? EXTRACT_DOORS_PROMPT_VERSION : EXTRACT_WINDOWS_PROMPT_VERSION

  const res = await callMessages({
    model: config.anthropicModel,
    max_tokens: 2048,
    temperature: 0,
    system: systemPrompt,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [
      {
        role: 'user',
        content: [
          ...buildImageBlock(input.jpegBase64),
          {
            type: 'text',
            text: `Document=${input.documentId} page=${input.pageNo} (${input.kind} schedule)\n\nFirst 1500 chars of text layer:\n${input.textSnippet.slice(0, 1500)}`,
          },
        ],
      },
    ],
  })
  const raw = findToolInput(res, tool.name) as { rows?: ExtractScheduleOutput['rows'] }
  return {
    kind: input.kind,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    tokensIn: res.usage?.input_tokens ?? 0,
    tokensOut: res.usage?.output_tokens ?? 0,
    promptVersion,
  }
}

// --- EXTRACT_ROOMS --------------------------------------------------------

export async function extractRooms(input: ExtractRoomsInput): Promise<ExtractRoomsOutput> {
  if (isStubMode()) return zeroTokens(stampStub(stubExtractRooms(input)))
  const res = await callMessages({
    model: config.anthropicModel,
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
            text: `Document=${input.documentId} page=${input.pageNo} (rooms)\n\nFirst 1500 chars of text layer:\n${input.textSnippet.slice(0, 1500)}`,
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
