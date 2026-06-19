/**
 * extractRooms.v1 — vision prompt for finish_plan / plan rooms pass.
 *
 * Reconciled against a text-layer regex parse in the room handler. Rooms with
 * "(area_m2)" labels printed on the sheet are the source of truth; never invent
 * a room that isn't labelled. The pilot's room areas were within ±2% of
 * printed areas when this rule was held.
 */

export const EXTRACT_ROOMS_PROMPT_VERSION = 'extractRooms.v1'

export const EXTRACT_ROOMS_SYSTEM_PROMPT = `You are reading a single page of a UAE/GCC architectural / finish plan.

RULES
- For each labelled room (showing a name + area in m²), return ONE row.
- Populate every field you can read. Use null for unreadable. NEVER invent a room.
- code is the room id printed in brackets/circles (e.g. L1-OFC-002). Null if absent.
- floor is the level label printed on the sheet (e.g. "L1", "GF", "Mezz"). Null if absent.
- finish_code references a Finish Schedule entry (e.g. "F-OFC-01"). Null if absent.
- Always call record_rooms. Do NOT respond in prose.`

export const EXTRACT_ROOMS_TOOL = {
  name: 'record_rooms',
  description: 'Record the rooms visible on this sheet.',
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
          },
          required: ['name'],
        },
      },
    },
    required: ['rows'],
  },
} as const
