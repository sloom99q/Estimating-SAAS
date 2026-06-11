/**
 * Anthropic client used by the takeoff handlers (CLASSIFY, EXTRACT_*).
 *
 * The client has TWO modes selected at runtime:
 *
 *   - LIVE   : `ANTHROPIC_API_KEY` is set. The methods hit /v1/messages with
 *              the versioned prompt for the call and the tool's strict JSON
 *              schema. Tokens reported back populate AiUsage.
 *
 *   - STUB   : `ANTHROPIC_API_KEY` is empty (the default in dev / CI). The
 *              methods return hand-designed deterministic responses defined
 *              in `./stubs.ts`. Same shape, same prompt version field — the
 *              handlers can't tell which mode they're in.
 *
 * Sprint-2 acceptance ships with stubs because it does not require
 * Anthropic credentials. Live mode is enabled by setting the env var.
 *
 * Retry policy on live errors: 429 / 529 / 5xx → exponential backoff up to
 * 3 attempts (BackoffMs: 1s, 2s, 4s). Anything else is surfaced to the
 * handler — the runner converts that into a job-level retry per the
 * existing backoff policy.
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

function isStubMode(): boolean {
  return !config.anthropicApiKey
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

// --- CLASSIFY -------------------------------------------------------------

export async function classifySheet(input: ClassifyInput): Promise<ClassifyOutput> {
  if (isStubMode()) return stubClassify(input)
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
  if (isStubMode()) return stubExtractSchedule(input)
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
  if (isStubMode()) return stubExtractRooms(input)
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
