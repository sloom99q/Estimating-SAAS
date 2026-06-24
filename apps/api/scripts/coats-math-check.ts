/**
 * Coats math check — two readings of the design doc §1, both
 * applied to GF-04 LIVING, side-by-side.
 *
 * The ambiguity: "Stucco — bag 55 AED / 40 m² × 2 coats".
 *
 * Reading A (current seed): coverage is per-COAT.
 *   One bag covers 40 m² for ONE coat. Two coats = two bags per
 *   40 m² of wall. coats=2 in the formula:
 *     (55 / 40) × 2 = 2.75 AED/m² for stucco
 *   System total: 20.40 AED/m²
 *
 * Reading B (alternate): coverage is per-SYSTEM (both coats lumped).
 *   "55 AED / 40 m² × 2 coats" means the bag/area is what the
 *   contractor quotes per the full 2-coat stucco job — coverage
 *   already accounts for both coats. coats=1 in the formula:
 *     (55 / 40) × 1 = 1.375 AED/m² for stucco
 *   System total: 13.625 AED/m²
 *
 * Same data, same engine, different reading. Pick which matches
 * how you actually estimate.
 */
import { Prisma } from '@prisma/client'
import { computeAssemblyUnitCost } from '../src/pricing/assemblyEngine'

const LIVING_AREA_M2 = 58.82
const CEILING_HEIGHT_M = 2.8
const PERIMETER_M = 4 * Math.sqrt(LIVING_AREA_M2)
const WALL_AREA_M2 = PERIMETER_M * CEILING_HEIGHT_M

console.log('GF-04 LIVING')
console.log('  floor area : ' + LIVING_AREA_M2.toFixed(2) + ' m²')
console.log('  perimeter  : ' + PERIMETER_M.toFixed(2) + ' m  (4 × √area, square prior)')
console.log('  ceiling H  : ' + CEILING_HEIGHT_M + ' m')
console.log('  wall area  : ' + WALL_AREA_M2.toFixed(2) + ' m²')
console.log('')

// Same components, switch coats on stucco + paint.
function jotun(coats: number) {
  return [
    { kind: 'MATERIAL' as const, label: 'Primer (drum)',                 unitPrice: 65,  coverage: 100, coats: 1,     wastagePct: 0 },
    { kind: 'MATERIAL' as const, label: 'Stucco (bag)',                  unitPrice: 55,  coverage: 40,  coats,        wastagePct: 0 },
    { kind: 'MATERIAL' as const, label: 'Top-coat paint (tin)',          unitPrice: 270, coverage: 50,  coats,        wastagePct: 0 },
    { kind: 'LABOR'    as const, label: 'Painter labour',                unitPrice: 6 },
    { kind: 'MATERIAL' as const, label: 'Roller set',                    unitPrice: 10,  coverage: 100, coats: 1,     wastagePct: 0 },
    { kind: 'MATERIAL' as const, label: 'Masking tape',                  unitPrice: 5,   coverage: 50,  coats: 1,     wastagePct: 0 },
  ]
}

function show(label: string, coats: number) {
  const result = computeAssemblyUnitCost(jotun(coats), { projectQty: WALL_AREA_M2 })
  console.log('═'.repeat(80))
  console.log(label + '  (coats = ' + coats + ' on stucco + paint)')
  console.log('─'.repeat(80))
  for (const e of result.breakdown) {
    console.log('  ' + e.label.padEnd(35) + ' [' + e.kind.padEnd(8) + '] ' + (e.contribution as Prisma.Decimal).toFixed(4).padStart(8) + ' AED/m²')
  }
  const unit = result.unitCost as Prisma.Decimal
  console.log('  ' + '─'.repeat(76))
  console.log('  SYSTEM UNIT COST'.padEnd(48) + ' ' + unit.toFixed(4).padStart(8) + ' AED/m²')
  const total = unit.times(new Prisma.Decimal(WALL_AREA_M2))
  console.log('  LIVING wall paint line                            85.90 m² × ' + unit.toFixed(2) + ' = ' + total.toFixed(2) + ' AED')
  console.log('')
}

show('READING A — coats multiply coverage  (CURRENT SEED)', 2)
show('READING B — coverage already accounts for both coats', 1)

console.log('Difference per m²  : ' + (20.40 - 13.625).toFixed(4) + ' AED/m²  (stucco 1.375 + paint 5.40)')
console.log('Difference on LIVING: ~' + (WALL_AREA_M2 * (20.40 - 13.625)).toFixed(2) + ' AED  for one room')
console.log('Difference on ~1,000 m² project: ~' + ((20.40 - 13.625) * 1000).toFixed(0) + ' AED')
console.log('')
console.log('Pick the reading that matches your real Jotun quote:')
console.log('  A = if your supplier quotes "55 AED/bag, one bag covers 40 m² PER COAT"')
console.log('  B = if "55 AED for 40 m² of stucco job, including both coats"')
process.exit(0)
