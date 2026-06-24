/**
 * LIB-3 — verify rate-rollup math end-to-end.
 *
 * Picks GF-04 LIVING (58.82 m²) from the LM1929 DXF MVP test
 * project, derives wall area via aspect prior (perimeter = 4 × √area
 * for a square; default ceiling height 2.8 m), looks up the Jotun
 * Standard interior wall paint Assembly, runs computeAssemblyUnitCost,
 * prints the component-by-component breakdown + system unit cost +
 * total for this one room. Compares against MATERIAL_LIBRARY.md §1's
 * worked example (50 m² → 1,020 AED at 20.40/m²).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../src/db'
import { computeAssemblyUnitCost } from '../src/pricing/assemblyEngine'

const DEMO_PROJECT_ID = 'cmqrxs9940001e1gs2zh56x8p'
const DEFAULT_CEILING_HEIGHT_M = 2.8

// ── Look up LIVING from the demo project ─────────────────────────
const livingRoom = await prisma.takeoffItem.findFirst({
  where: {
    projectId: DEMO_PROJECT_ID,
    category: 'ROOM',
    tag: 'GF-04',
    deletedAt: null,
  },
  select: {
    id: true,
    description: true,
    qtyAi: true,
    meta: true,
  },
})
if (!livingRoom) {
  console.error('GF-04 LIVING not found in demo project — was the demo restored?')
  process.exit(1)
}
const areaM2 = Number(livingRoom.qtyAi!.toString())
console.log('=== Room ===')
console.log(' tag=GF-04  name=' + livingRoom.description + '  area=' + areaM2.toFixed(2) + ' m²')

// ── Derive wall area via aspect prior ───────────────────────────
// For a square room: perimeter = 4 × √area
// For an L-shape or long room: aspect ratio increases the perimeter
// for the same area. The conservative estimator's prior is to assume
// rectangular with aspect 1.5:1 — about 8% more wall than a perfect
// square. For phase 1 we keep it simple (square = 4 × √area).
const perimeter_m_squarePrior = 4 * Math.sqrt(areaM2)
const wallArea_m2 = perimeter_m_squarePrior * DEFAULT_CEILING_HEIGHT_M
console.log('')
console.log('=== Wall area (aspect-prior, ceiling height 2.8 m) ===')
console.log(' perimeter (square prior) = 4 × √' + areaM2.toFixed(2) + ' = ' + perimeter_m_squarePrior.toFixed(2) + ' m')
console.log(' wall area               = perimeter × 2.8 m = ' + wallArea_m2.toFixed(2) + ' m²')

// ── Look up the Jotun system ────────────────────────────────────
const org = await prisma.project.findUnique({
  where: { id: DEMO_PROJECT_ID },
  select: { organizationId: true },
})
const jotun = await prisma.assembly.findFirst({
  where: {
    organizationId: org!.organizationId,
    name: 'Standard interior wall paint',
    deletedAt: null,
  },
  include: {
    brand: { select: { name: true } },
    components: { orderBy: { sortOrder: 'asc' } },
  },
})
if (!jotun) {
  console.error('Jotun system not found in org — did seed run?')
  process.exit(1)
}
console.log('')
console.log('=== System ===')
console.log(' brand=' + jotun.brand!.name + '  system=' + jotun.name)
console.log(' takeoffCategory=' + jotun.takeoffCategory + '  outputUnit=' + jotun.outputUnit)

// ── Compute unit cost (per m²) with breakdown ───────────────────
const result = computeAssemblyUnitCost(
  jotun.components.map((c) => ({
    kind: c.kind as 'MATERIAL' | 'LABOR' | 'TOOL_FIXED',
    label: c.label,
    unitPrice: c.unitPrice,
    coverage: c.coverage,
    coats: c.coats,
    wastagePct: c.wastagePct,
    fixedCost: c.fixedCost,
  })),
  // Pass projectQty so TOOL_FIXED would amortise correctly (none in
  // this system; tools are MATERIAL-kind here).
  { projectQty: wallArea_m2 },
)

console.log('')
console.log('=== Component breakdown (per m²) ===')
for (const e of result.breakdown) {
  const v = e.contribution as Prisma.Decimal
  console.log('  ' + e.label.padEnd(50) + ' [' + e.kind.padEnd(11) + '] ' + v.toFixed(4).padStart(8) + ' AED/m²')
}
console.log('  ' + '─'.repeat(85))
const unitCost = result.unitCost as Prisma.Decimal
console.log('  SYSTEM UNIT COST'.padEnd(64) + ' ' + unitCost.toFixed(4).padStart(8) + ' AED/m²')

// ── Per-room cost ────────────────────────────────────────────────
const lineTotal = unitCost.times(new Prisma.Decimal(wallArea_m2))
console.log('')
console.log('=== Line total for LIVING ===')
console.log('  wall area  ' + wallArea_m2.toFixed(2) + ' m²')
console.log('  × rate     ' + unitCost.toFixed(4) + ' AED/m²')
console.log('  = total    ' + lineTotal.toFixed(2) + ' AED')

// ── Cross-check against estimator's locked Reading B ────────────
// Reading B (2026-06-24): coats=1 on stucco + paint because the
// bag/tin coverage already accounts for both coats.
//   Primer 0.6500 + Stucco 1.3750 + Paint 5.4000
//   + Labor 6.0000 + Roller 0.1000 + Tape 0.1000 = 13.6250
const expectedUnitCostStr = '13.6250'
const actualUnitCostStr = unitCost.toFixed(4)
const matches = actualUnitCostStr === expectedUnitCostStr
console.log('')
console.log('=== Cross-check vs Reading B (coats=1) ===')
console.log('  expected unit cost: ' + expectedUnitCostStr + ' AED/m² (estimator-locked Reading B)')
console.log('  actual   unit cost: ' + actualUnitCostStr + ' AED/m²')
console.log('  ' + (matches ? '✓ MATCH — schema + seed + engine all align' : '✗ MISMATCH — investigate'))
if (!matches) process.exit(1)

// ── What this means for the full project ────────────────────────
const allRooms = await prisma.takeoffItem.findMany({
  where: { projectId: DEMO_PROJECT_ID, category: 'ROOM', deletedAt: null },
  select: { tag: true, description: true, qtyAi: true },
  orderBy: { tag: 'asc' },
})
let totalWallArea = 0
let totalPaintCost = 0
for (const r of allRooms) {
  if (!r.qtyAi) continue
  const a = Number(r.qtyAi.toString())
  const wa = 4 * Math.sqrt(a) * DEFAULT_CEILING_HEIGHT_M
  totalWallArea += wa
  totalPaintCost += wa * Number(unitCost.toFixed(4))
}
console.log('')
console.log('=== If applied to ALL ' + allRooms.length + ' DXF rooms in the demo project ===')
console.log('  total wall area (aspect prior)  : ' + totalWallArea.toFixed(2) + ' m²')
console.log('  total paint cost (Jotun system) : ' + totalPaintCost.toFixed(2) + ' AED')
console.log('  vs run-6 BOQ v14 wall paint     : 0 AED (no PAINT lines emitted today)')
console.log('')
console.log('This is what LIB-4 (QUANTIFY wall area) will add to the BOQ once wired.')
process.exit(0)
