/**
 * Sprint-6 S6-0 rate re-base: ENTIRE seed replaced with the 26 rows from
 * apps/api/docs/FitoutOS_Takeoff_Spec.md §8 (Triple-A Sharjah Qo/202605/221
 * Rev-01, June 2026). The Sprint-3 synthesised rates are RETIRED — none of
 * the previous codes survived the audit (they didn't match the bid's coding
 * scheme; their values were rough placeholders).
 *
 * Per-row sources:
 *   - The 25 single-value rates carry 'Triple-A Qo/202605/221 Rev-01'.
 *   - IRON-STD is a band (350-400 AED/No) in the spec; we seed the upper
 *     value 400 and tag the source explicitly as 'Triple-A …; band 350-400,
 *     seeded upper bound'. The downstream price waterfall doesn't care.
 *
 * Codes follow the §8 family naming convention so future per-finish-code
 * lookups in QUANTIFY/PRICE (S6-3) match cleanly:
 *
 *   DOOR-*    : per-leaf door rates (No)
 *   IRON-STD  : ironmongery per door (No)
 *   SCREED-*  : floor screed (m²)
 *   FLR-*     : floor finishes (m²)
 *   STAIR-*   : tread+riser (lm) and landing (m²)
 *   THRESH    : threshold per metre (lm)
 *   SKIRT-*   : skirting per metre (lm)
 *   WALL-*    : wall feature finishes (m²)
 *   PAINT-INT : interior wall paint (m²)
 *   CEIL-*    : ceiling rates by class (m²)
 *   EXT-*     : external works (m²)
 *   MH-*      : manholes (No)
 *   KIT-*     : kitchen joinery (lm)
 *   VANITY    : vanity unit (No)
 *   HANDRAIL  : stair handrail (lm)
 */
import { type PrismaClient } from '@prisma/client'

/** Default source for the synthesised pre-Sprint-6 rates. Kept for historical reference. */
export const RATE_LIBRARY_SOURCE_ESTIMATED =
  'triple-a-sharjah-2026-estimated; pending architect review'

/** Triple-A bid source — applied to every §8 row in this seed. */
export const RATE_LIBRARY_SOURCE_TRIPLE_A =
  'Triple-A Qo/202605/221 Rev-01'

/** IRON-STD is given as a band 350–400 in the spec; we seed the upper. */
const RATE_LIBRARY_SOURCE_TRIPLE_A_BAND =
  'Triple-A Qo/202605/221 Rev-01; band 350-400, seeded upper bound'

export interface SeedRate {
  code: string
  description: string
  unit: string
  rate: number
  /** When omitted, defaults to RATE_LIBRARY_SOURCE_TRIPLE_A. */
  source?: string
}

/**
 * SPEC.md §8 verbatim, with the unit token written exactly the way the
 * runtime expects ('No' for per-unit, 'm²' for area, 'lm' for linear).
 */
export const SHARJAH_GLOBAL_RATES: SeedRate[] = [
  // -- Doors -------------------------------------------------------------
  { code: 'DOOR-1000x3000-FN01', description: 'Door 1000×3000 special finish (FN01)',           unit: 'No',  rate: 2600 },
  { code: 'DOOR-STD-LACQ',       description: 'Door 800-1000×3000 white lacquer (standard)',    unit: 'No',  rate: 2400 },
  { code: 'DOOR-900x2400',       description: 'Door 900×2400',                                  unit: 'No',  rate: 2300 },
  { code: 'IRON-STD',            description: 'Ironmongery set per door',                       unit: 'No',  rate: 400,
    source: RATE_LIBRARY_SOURCE_TRIPLE_A_BAND },

  // -- Floor screeds + finishes -----------------------------------------
  { code: 'SCREED-FLR',          description: 'Sand-cement floor screed',                       unit: 'm²',  rate: 90 },
  { code: 'FLR-ST01',            description: 'Porcelain 1000×1000 honed (legend code ST01)',   unit: 'm²',  rate: 200 },
  { code: 'FLR-PR01',            description: 'Porcelain 1000×1000 marble-texture (PR01)',      unit: 'm²',  rate: 210 },
  { code: 'FLR-PR03',            description: 'Porcelain 600×600 service (PR03)',               unit: 'm²',  rate: 150 },
  { code: 'FLR-BATH',            description: 'Bathroom porcelain 1200×600',                    unit: 'm²',  rate: 195 },

  // -- Stairs ------------------------------------------------------------
  { code: 'STAIR-TREAD',         description: 'Grainy marble tread + riser',                    unit: 'lm',  rate: 800 },
  { code: 'STAIR-LAND',          description: 'Stair landing finish',                           unit: 'm²',  rate: 550 },
  { code: 'THRESH',              description: 'Threshold',                                      unit: 'lm',  rate: 230 },
  { code: 'SKIRT-PR01',          description: 'Skirting 100mm (PR01-matched)',                  unit: 'lm',  rate: 120 },

  // -- Wall finishes -----------------------------------------------------
  { code: 'WALL-WOODPORC',       description: 'Wall porcelain wood-finish cut-to-size',         unit: 'm²',  rate: 580 },
  { code: 'WALL-MARBPORC',       description: 'Wall porcelain 1000×3000',                       unit: 'm²',  rate: 540 },
  { code: 'PAINT-INT',           description: 'Fenomastic emulsion to walls',                   unit: 'm²',  rate: 35 },

  // -- Ceilings ----------------------------------------------------------
  { code: 'CEIL-CL03',           description: 'Gypsum ceiling plain (CL03)',                    unit: 'm²',  rate: 150 },
  { code: 'CEIL-CL02',           description: 'Moisture-resistant gypsum (CL02)',               unit: 'm²',  rate: 170 },
  { code: 'CEIL-CL01-EXT',       description: 'External Marmox ceiling (CL01-EXT)',             unit: 'm²',  rate: 300 },

  // -- External works ---------------------------------------------------
  { code: 'EXT-ST03',            description: 'Concrete porcelain pavement (external ST03)',    unit: 'm²',  rate: 250 },
  { code: 'EXT-SCREED',          description: 'Paving screed',                                  unit: 'm²',  rate: 100 },

  // -- MEP / utilities ---------------------------------------------------
  { code: 'MH-800',              description: 'Manhole 800×800 with cover',                     unit: 'No',  rate: 650 },

  // -- Joinery & specialties --------------------------------------------
  { code: 'KIT-BASE',            description: 'Kitchen base unit HPL',                          unit: 'lm',  rate: 1200 },
  { code: 'KIT-WALL',            description: 'Kitchen wall unit HPL',                          unit: 'lm',  rate: 1100 },
  { code: 'VANITY',              description: 'Stone-top vanity',                               unit: 'No',  rate: 3400 },
  { code: 'HANDRAIL-MDF',        description: 'MDF veneer stair handrail',                      unit: 'lm',  rate: 900 },
]

if (SHARJAH_GLOBAL_RATES.length !== 26) {
  throw new Error(
    `RateLibrary seed must contain exactly 26 rows; got ${SHARJAH_GLOBAL_RATES.length}.`,
  )
}

/**
 * Idempotent. Updates existing global rows by `code`; creates new rows that
 * don't yet exist; deletes orphan global rows whose `code` is no longer in
 * the seed list. The orphan-cleanup ensures the Sprint-3 estimated codes
 * disappear after Sprint-6 lands.
 */
export async function seedGlobalRates(client: PrismaClient): Promise<{
  inserted: number
  updated: number
  deleted: number
}> {
  let inserted = 0
  let updated = 0
  let deleted = 0
  const desiredCodes = new Set(SHARJAH_GLOBAL_RATES.map((r) => r.code))

  for (const row of SHARJAH_GLOBAL_RATES) {
    const source = row.source ?? RATE_LIBRARY_SOURCE_TRIPLE_A
    const existing = await client.rateLibraryItem.findFirst({
      where: { organizationId: null, code: row.code, region: 'SHJ' },
      select: { id: true },
    })
    if (existing) {
      await client.rateLibraryItem.update({
        where: { id: existing.id },
        data: { description: row.description, unit: row.unit, rate: row.rate, source },
      })
      updated += 1
    } else {
      await client.rateLibraryItem.create({
        data: {
          organizationId: null,
          code: row.code,
          description: row.description,
          unit: row.unit,
          rate: row.rate,
          source,
          region: 'SHJ',
        },
      })
      inserted += 1
    }
  }

  // S6-0: prune retired codes. Sprint-3 synthesised rates whose codes are not
  // in the §8 list get hard-deleted; PRICE no longer needs them.
  const stragglers = await client.rateLibraryItem.findMany({
    where: { organizationId: null, region: 'SHJ' },
    select: { id: true, code: true },
  })
  for (const r of stragglers) {
    if (!desiredCodes.has(r.code)) {
      await client.rateLibraryItem.delete({ where: { id: r.id } })
      deleted += 1
    }
  }
  return { inserted, updated, deleted }
}
