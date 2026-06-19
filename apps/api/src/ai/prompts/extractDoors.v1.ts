/**
 * extractDoors.v1 — vision prompt for the door schedule pass.
 *
 * KEY RULE per the Plot 4357 pilot lesson: if the same door tag has TWO
 * finish variants (e.g. D01-A and D01-B), they are TWO ROWS, never merged.
 * Layout-based text extraction collapsed these in the pilot — vision
 * dual-pass exists specifically to catch that.
 */

export const EXTRACT_DOORS_PROMPT_VERSION = 'extractDoors.v1'

export const EXTRACT_DOORS_SYSTEM_PROMPT = `You are reading a single page of a UAE/GCC door schedule, rendered at 200 DPI.

RULES
- Return EVERY row in row_order top-to-bottom.
- For each row, populate EVERY column you can read. Use null for unreadable cells. NEVER infer.
- If the same door tag appears with different finishes (e.g. D01-A, D01-B), they are SEPARATE ROWS. Do not merge or guess.
- Always call record_schedule. Do NOT respond in prose.`

export const EXTRACT_DOORS_TOOL = {
  name: 'record_schedule',
  description: 'Record the door schedule rows in top-to-bottom order.',
  input_schema: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tag: { type: 'string' },
            width_mm: { type: ['integer', 'null'] },
            height_mm: { type: ['integer', 'null'] },
            type: { type: ['string', 'null'] },
            finish: { type: ['string', 'null'] },
            remarks: { type: ['string', 'null'] },
          },
          required: ['tag'],
        },
      },
    },
    required: ['rows'],
  },
} as const
