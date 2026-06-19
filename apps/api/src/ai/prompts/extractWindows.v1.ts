/**
 * extractWindows.v1 — vision prompt for the window/curtain-wall schedule pass.
 *
 * Same rule as doors: every row in order, every column populated when readable,
 * null otherwise, never infer. Variant suffixes (CW09-A, CW09-B) are separate
 * rows. This is the dual-pass partner of the text-layer regex parse.
 */

export const EXTRACT_WINDOWS_PROMPT_VERSION = 'extractWindows.v1'

export const EXTRACT_WINDOWS_SYSTEM_PROMPT = `You are reading a single page of a UAE/GCC window or curtain-wall schedule, rendered at 200 DPI.

RULES
- Return EVERY row in row_order top-to-bottom.
- For each row, populate EVERY column you can read. Use null for unreadable cells. NEVER infer.
- If the same tag appears with different finishes (e.g. CW09-A, CW09-B), they are SEPARATE ROWS.
- The Plot 4357 pilot saw text-extraction swap CW09↔CW10 and drop CW02 entirely; your job is to read the IMAGE, not the underlying text.
- Always call record_schedule. Do NOT respond in prose.`

export const EXTRACT_WINDOWS_TOOL = {
  name: 'record_schedule',
  description: 'Record the window schedule rows in top-to-bottom order.',
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
