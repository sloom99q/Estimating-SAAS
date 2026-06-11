/**
 * extractSchedule.v2 — Sprint 4 unified schedule prompt.
 *
 * Replaces extractDoors.v1 + extractWindows.v1 (kept for promptVersion
 * history). The vision pass now decides for itself whether this sheet is a
 * door schedule, a window/glazing schedule, or neither — Sprint-3 lost a
 * whole set of window rows because the title-based decideKind() routing in
 * the handler didn't recognise sheets labelled "GLAZING TYPES" or "CURTAIN
 * WALL TYPES". The model gets the kindHint as a starting bias, but its own
 * `kind` self-report wins.
 *
 * Plot 4357 pilot lessons preserved:
 *   - Variant tags (D01-A vs D01-B, CW09-A vs CW09-B) are SEPARATE rows,
 *     never merged. But: many schedules don't use variant suffixes at all —
 *     extracting one row per visible row is correct.
 *   - Pilot vision pass swapped CW09↔CW10 in earlier tests; reading column
 *     order top-to-bottom is the rule.
 */

export const EXTRACT_SCHEDULE_PROMPT_VERSION = 'extractSchedule.v2'

export const EXTRACT_SCHEDULE_SYSTEM_PROMPT = `You are reading a single drawing-set sheet rendered at 200 DPI. The sheet may be a door schedule, a window/glazing schedule, or something else entirely.

DECIDE WHAT YOU SEE
- If the sheet's primary content is a door schedule (DOOR TAG / Width / Height / Type / Finish columns), kind = "DOOR".
- If it's a window or glazing or curtain-wall schedule (CW tags, glazing types, frame info), kind = "WINDOW".
- If it's neither (an elevation, plan, detail, etc.), kind = null and rows = []. Do NOT guess.

EXTRACT ROWS (when kind is DOOR or WINDOW)
- Return EVERY row in the schedule, top-to-bottom (row_order).
- Door tags look like D01, D02, ..., sometimes D01-A / D01-B for finish variants — SPLIT variants into separate rows. Same for window tags (CW01, CW01-A, etc.).
- Populate every column you can read. Use null for unreadable. NEVER infer.
- width_mm and height_mm are integers in millimetres. A schedule cell that prints "1.00" or "3.00" is METRES; convert to 1000 / 3000. A cell that prints "900 X 3000" or "3000" is already MILLIMETRES.
- type / finish / remarks are free text the schedule shows.

ANTI-PATTERNS (must not happen)
- Do NOT invent a tag that isn't drawn on the sheet.
- Do NOT silently drop a row because it's hard to read — return null cells instead.
- Do NOT merge two variant rows (D01-A and D01-B with different finishes are TWO rows).

Always call the record_schedule tool. Do NOT respond in prose.`

export const EXTRACT_SCHEDULE_TOOL = {
  name: 'record_schedule',
  description: 'Record what was visible: kind + ordered rows.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: ['string', 'null'], enum: ['DOOR', 'WINDOW', null] },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tag: { type: 'string' },
            count: { type: ['integer', 'null'] },
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
    required: ['kind', 'rows'],
  },
} as const
