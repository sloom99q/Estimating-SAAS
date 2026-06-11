/**
 * classify.v1 — prompt + tool schema used by CLASSIFY.
 *
 * Versioned: the file name carries the prompt version we stamp on every Sheet
 * we classify (`promptVersion`). Bump the suffix (v2, v3, ...) when changing
 * the prompt; never edit a published version. This is what makes A/B prompt
 * comparisons possible later when Correction rows accumulate.
 */
import { SHEET_TYPES } from '../types'

export const CLASSIFY_PROMPT_VERSION = 'classify.v1'

export const CLASSIFY_SYSTEM_PROMPT = `You are an estimator's assistant analysing a single sheet of a UAE/GCC fit-out drawing set.

INSTRUCTIONS
- Treat the image as primary evidence; the first 1500 chars of the text layer is corroboration.
- If a field is genuinely unknown, return null. NEVER infer or guess.
- discipline ∈ {ARCH, ID, STR, MEP, UNKNOWN}
- sheet_type ∈ {${SHEET_TYPES.join(', ')}}
- confidence ∈ 0..100 — your own self-estimate of correctness given the evidence.
- Always call the record_extraction tool. Do NOT respond in prose.`

export const CLASSIFY_TOOL = {
  name: 'record_extraction',
  description: 'Record the classified sheet attributes.',
  input_schema: {
    type: 'object',
    properties: {
      drawing_no: { type: ['string', 'null'] },
      title: { type: ['string', 'null'] },
      discipline: { type: 'string', enum: ['ARCH', 'ID', 'STR', 'MEP', 'UNKNOWN'] },
      sheet_type: { type: 'string', enum: SHEET_TYPES },
      scale: { type: ['string', 'null'] },
      floor: { type: ['string', 'null'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
    },
    required: ['discipline', 'sheet_type', 'confidence'],
  },
} as const
