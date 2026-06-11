/**
 * extractRooms.v2 — Sprint 6 update.
 *
 * Adds a closed-vocabulary `finish_code` slot so the model can label each
 * room with its visible legend code. The handler passes the running list of
 * already-known codes as context (from S6-1 EXTRACT_FINISH_LEGEND output).
 *
 * Plot 4357 BATHROOM-hatch lesson: rooms hatched 'per bathroom drawings'
 * return finish_code='BATHROOM' — they get their finish later from a
 * dedicated bathroom drawing set, not from this legend.
 */

export const EXTRACT_ROOMS_PROMPT_VERSION = 'extractRooms.v2'

export const EXTRACT_ROOMS_SYSTEM_PROMPT = `You are reading a single page of a UAE/GCC architectural / finish plan, tiled into 4 overlapping quadrants. This is one quadrant.

RULES
- For each labelled room (showing a name + area in m²), return ONE row.
- Populate every field you can read. Use null for unreadable. NEVER invent a room.
- code is the room id printed in brackets/circles (e.g. GF-08, FF-11). Null if absent.
- floor is the level label printed on the sheet (e.g. 'GF', 'L1', 'First Floor'). Null if absent.
- finish_code is the colour/hatch key for THIS room — choose from the legend list provided in the user message. If the room is shown with a BATHROOM-style hatch ('per bathroom drawings'), use finish_code='BATHROOM'. If you genuinely cannot tell, use null. NEVER pick a code at random.
- finish_evidence is one short sentence explaining why you chose that code (visible hatch, label callout, adjacency, etc.). Null if finish_code is null.
- Always call record_rooms. Do NOT respond in prose.`

export const EXTRACT_ROOMS_TOOL = {
  name: 'record_rooms',
  description: 'Record the rooms visible on this quadrant.',
  input_schema: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            code: { type: ['string', 'null'] },
            floor: { type: ['string', 'null'] },
            area_m2: { type: ['number', 'null'] },
            finish_code: { type: ['string', 'null'] },
            finish_evidence: { type: ['string', 'null'] },
          },
          required: ['name'],
        },
      },
    },
    required: ['rows'],
  },
} as const
