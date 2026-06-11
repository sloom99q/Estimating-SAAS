/**
 * Sprint-3 RateLibrary seed — 26 synthesised "Triple-A Sharjah" interior
 * fit-out rates. These are PLAUSIBLE market values drawn from common UAE
 * 2024–2026 fit-out data and are TAGGED AS ESTIMATED so reviewers know they
 * are not verified vendor quotes.
 *
 * Architect note: the original Sprint-3 brief pointed at SPEC.md §8 for these
 * rates, but SPEC.md was deferred from Sprint 2 Step 0. I'll replace these
 * with the real §8 rates verbatim as soon as the spec lands; until then
 * `source = 'triple-a-sharjah-2026-estimated; pending architect review'`
 * makes the provenance unmistakable.
 *
 * Rows are inserted with `organizationId = NULL` per ADR-012 — they are the
 * GLOBAL fallback in the PRICE waterfall. Every org sees them; per-org
 * overrides (regular rows with non-null org id) win on `code` collision.
 */
import { Prisma, PrismaClient } from '@prisma/client'

export const RATE_LIBRARY_SOURCE =
  'triple-a-sharjah-2026-estimated; pending architect review'

export interface SeedRate {
  code: string
  description: string
  unit: string
  rate: number
}

export const SHARJAH_GLOBAL_RATES: SeedRate[] = [
  // -- 1.0 General -------------------------------------------------------
  { code: 'site-setup-fixed',          description: 'Site setup, hoarding & temp services',         unit: 'lumpsum', rate: 12500 },
  { code: 'safety-equipment',          description: 'Site safety equipment & PPE allocation',       unit: 'm²',      rate: 8 },

  // -- 2.5 Metal ---------------------------------------------------------
  { code: 'mild-steel-handrail',       description: 'Mild steel handrail, painted finish',          unit: 'm',       rate: 280 },
  { code: 'ss-balustrade',             description: 'Stainless steel handrail / balustrade',        unit: 'm',       rate: 750 },
  { code: 'structural-bracket-nr',     description: 'Structural mounting bracket, supply & fix',    unit: 'nr',      rate: 145 },

  // -- 2.6 Wood ----------------------------------------------------------
  { code: 'veneer-joinery-m2',         description: 'Veneer joinery, wall mounted (per m² face)',   unit: 'm²',      rate: 950 },
  { code: 'mdf-paint-furniture-m2',    description: 'MDF paint-finished furniture (per m² face)',   unit: 'm²',      rate: 620 },
  { code: 'solid-wood-door-supply',    description: 'Solid wood door leaf, supply only',            unit: 'nr',      rate: 1200 },

  // -- 2.8 Doors / Windows / Glazing ------------------------------------
  { code: 'door-single-supply-install',description: 'Single swing door, supply + install',          unit: 'nr',      rate: 1850 },
  { code: 'door-double-supply-install',description: 'Double swing door, supply + install',          unit: 'nr',      rate: 3200 },
  { code: 'curtain-wall-aluminium-m2', description: 'Aluminium curtain wall & glazing',             unit: 'm²',      rate: 1150 },
  { code: 'glazed-partition-12mm',     description: 'Glazed partition, 12mm tempered',              unit: 'm²',      rate: 680 },

  // -- 2.9 Finishes ------------------------------------------------------
  { code: 'paint-emulsion-2coat',      description: 'Emulsion paint, 2 coats incl primer',          unit: 'm²',      rate: 22 },
  { code: 'paint-jotun-system-a',      description: 'Jotun interior paint system A',                unit: 'm²',      rate: 20.20 },
  { code: 'ceramic-tile-600',          description: 'Glazed ceramic floor tile 600×600',            unit: 'm²',      rate: 95 },
  { code: 'porcelain-anti-slip',       description: 'Porcelain anti-slip floor tile',               unit: 'm²',      rate: 165 },
  { code: 'marble-polished',           description: 'Natural marble polished tiling',               unit: 'm²',      rate: 380 },
  { code: 'gypsum-ceiling-frame',      description: 'Gypsum board ceiling on metal frame',          unit: 'm²',      rate: 95 },
  { code: 'skirting-mdf-100',          description: 'MDF skirting 100mm, painted',                  unit: 'm',       rate: 38 },
  { code: 'plaster-internal',          description: 'Internal cement plaster, 12mm',                unit: 'm²',      rate: 28 },
  { code: 'screed-cement-25',          description: 'Cement screed 25mm',                           unit: 'm²',      rate: 32 },
  { code: 'waterproofing-membrane',    description: 'Waterproofing membrane, wet areas',            unit: 'm²',      rate: 48 },

  // -- 3.1 External ------------------------------------------------------
  { code: 'interlock-paving-60',       description: 'Interlock paving 60mm, sand base',             unit: 'm²',      rate: 110 },
  { code: 'kerbstone-pcc',             description: 'PCC kerbstone, supply + install',              unit: 'm',       rate: 95 },

  // -- 4.0 Provisional Sums (per m² total floor area) -------------------
  { code: 'structure-allowance-m2',    description: 'Structural works carry allowance',             unit: 'm²',      rate: 250 },
  { code: 'mep-allowance-m2',          description: 'MEP carry allowance (mech + elec + plumb)',    unit: 'm²',      rate: 320 },
]

if (SHARJAH_GLOBAL_RATES.length !== 26) {
  // Catch accidental edits — the architect ask is for 26 rates exactly.
  throw new Error(
    `RateLibrary seed must contain exactly 26 rows; got ${SHARJAH_GLOBAL_RATES.length}.`,
  )
}

/**
 * Idempotent. The Prisma `@@unique([organizationId, code, region])` is a
 * standard SQL unique index, which treats NULLs as distinct — so a
 * `findFirst + create/update` cycle is the safe pattern for the global
 * (organizationId=NULL) rows. Per-org overrides DO use the composite key.
 */
export async function seedGlobalRates(client: PrismaClient): Promise<number> {
  let touched = 0
  for (const row of SHARJAH_GLOBAL_RATES) {
    const existing = await client.rateLibraryItem.findFirst({
      where: { organizationId: null, code: row.code, region: 'SHJ' },
      select: { id: true },
    })
    if (existing) {
      await client.rateLibraryItem.update({
        where: { id: existing.id },
        data: {
          description: row.description,
          unit: row.unit,
          rate: row.rate,
          source: RATE_LIBRARY_SOURCE,
        },
      })
    } else {
      await client.rateLibraryItem.create({
        data: {
          organizationId: null,
          code: row.code,
          description: row.description,
          unit: row.unit,
          rate: row.rate,
          source: RATE_LIBRARY_SOURCE,
          region: 'SHJ',
        },
      })
    }
    touched += 1
  }
  return touched
}

// Keep the import non-trivial — Prisma re-export so consumers can type-check
// against the generated types without re-importing.
export type { Prisma }
