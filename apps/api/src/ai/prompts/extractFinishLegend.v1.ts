/**
 * extractFinishLegend.v1 — Sprint 6 new pipeline stage.
 *
 * Reads a finish_plan or legend sheet (Plot 4357: the I401-I404 series) and
 * extracts the legend table rows: { code, name, material, size, finish,
 * usage }. These are MATERIAL DEFINITIONS, not quantified takeoff rows —
 * the downstream EXTRACT_ROOMS step uses the code list as context to label
 * each room with its finish_code.
 *
 * Legend codes follow the pilot's conventions:
 *   ST01 / ST02 / ST03         stone/marble
 *   PR01 / PR02 / PR03         porcelain
 *   WD01 / WD02                wall feature (wood porcelain)
 *   FN01 / FN02 / FN03 / FN04  special finishes
 *   LS01 / LS02                landscape / external
 *   BATHROOM                   per-bathroom-drawings hatch (special)
 */

export const EXTRACT_FINISH_LEGEND_PROMPT_VERSION = 'extractFinishLegend.v1'

export const EXTRACT_FINISH_LEGEND_SYSTEM_PROMPT = `You are reading a finish-legend sheet from a UAE/GCC fit-out drawing set, rendered at 200 DPI. The sheet shows a small table of finish codes (ST01, PR03, WD01 etc.) with descriptions, sizes, and the location each code applies to.

EXTRACT
- One row per legend code visible on the sheet.
- code is the short identifier (e.g. ST01, PR03, WD01, FN01).
- name is the human-readable label (e.g. "White Marble", "Porcelain Tile").
- material describes what it is (e.g. "marble", "porcelain", "wood-look porcelain", "GRC").
- size is the printed size if shown (e.g. "1000x1000", "600x600", "1200x600"). Null if absent.
- finish is the visible surface treatment (e.g. "honed", "polished", "matt"). Null if absent.
- usage is the human description of where it applies (e.g. "interior floors", "bathrooms", "service areas", "wall feature behind TV").
- kind classifies which surface the code targets: FLOOR, WALL, CEILING, EXTERNAL, or OTHER.

RULES
- One row per UNIQUE code. Don't repeat.
- If the table is unreadable or absent, return rows = [].
- NEVER infer a code that isn't drawn on the sheet.
- Always call record_finish_legend.`

export const EXTRACT_FINISH_LEGEND_TOOL = {
  name: 'record_finish_legend',
  description: 'Record the legend table rows visible on this sheet.',
  input_schema: {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            name: { type: ['string', 'null'] },
            material: { type: ['string', 'null'] },
            size: { type: ['string', 'null'] },
            finish: { type: ['string', 'null'] },
            usage: { type: ['string', 'null'] },
            kind: {
              type: ['string', 'null'],
              enum: ['FLOOR', 'WALL', 'CEILING', 'EXTERNAL', 'OTHER', null],
            },
          },
          required: ['code'],
        },
      },
    },
    required: ['rows'],
  },
} as const
