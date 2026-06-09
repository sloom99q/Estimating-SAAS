import type { CurrencyCode, ID } from '@/shared/types'
import type { Material, MaterialCategory, MaterialUnit } from './material.types'
import {
  calcSpaceCostBreakdown,
  isDiscreteUnit,
  type DefaultRates,
  type SpaceAreas,
  type SpaceMaterialAssignments,
  type SpaceCostBreakdown,
} from './quantity'

/**
 * Pure bill-of-quantities aggregation.
 *
 * For a single project, given:
 *   - every space (its three pre-computed surface areas)
 *   - the resolved material assignment per surface
 *   - the global default rates (for unassigned surfaces)
 *
 * The aggregator emits:
 *   - one row per distinct material that any space uses (areas SUMMED across
 *     surfaces, quantity recomputed against the SUMMED area so waste is
 *     applied once at the project level rather than compounding per-space)
 *   - per-category totals
 *   - the grand project total, including fallback costs for unassigned
 *     surfaces
 *   - the total unassigned surface area, surfaced so the UI can flag drift
 *
 * Pure — no react, no mantine, no i18next. Unit-testable in isolation.
 */

const TWO_DP = 100

function roundTwoDp(value: number): number {
  return Math.round(value * TWO_DP) / TWO_DP
}

function toAmountString(value: number): string {
  return roundTwoDp(value).toFixed(2)
}

export interface BoqLine {
  materialId: ID
  materialName: string
  category: MaterialCategory
  unit: MaterialUnit
  /** Total m² across every surface using this material. */
  totalArea: number
  /** Quantity to purchase, computed from `totalArea` (single waste application). */
  quantity: number
  unitPrice: number
  totalAmount: string
  currency: CurrencyCode
}

export interface BoqCategoryTotal {
  category: MaterialCategory
  amount: string
  currency: CurrencyCode
}

export interface ProjectBoq {
  lines: BoqLine[]
  categoryTotals: BoqCategoryTotal[]
  grandTotal: string
  currency: CurrencyCode
  /** Per-space breakdown — UI uses it to render the cost column in the table. */
  spaceBreakdowns: Map<ID, SpaceCostBreakdown>
  /** Surface area (m²) that has no material assigned and is therefore costed
   *  with the default rate. Surfaced so the UI can warn the user. */
  unassignedSurfaceArea: number
  /** Cost contributed by unassigned (default-rate) surfaces. */
  unassignedAmount: string
  /**
   * Total surfaces across the project. Always `spaces.length * 3` (floor +
   * wall + ceiling per space). Exposed so the editorial hero can render an
   * "X of Y surfaces assigned" progress without recomputing.
   */
  totalSurfaceCount: number
  /** How many of the surfaces have a real Material assignment. */
  assignedSurfaceCount: number
  /** Convenience: `totalSurfaceCount - assignedSurfaceCount`. */
  unassignedSurfaceCount: number
  /** True when every surface across every space has a material assigned. */
  fullyAssigned: boolean
}

export interface BoqSpaceInput {
  spaceId: ID
  areas: SpaceAreas
  assignments: SpaceMaterialAssignments
}

interface MaterialAccumulator {
  material: Material
  totalArea: number
}

export function calcProjectBoq(spaces: BoqSpaceInput[], rates: DefaultRates): ProjectBoq {
  const accumulator = new Map<ID, MaterialAccumulator>()
  const spaceBreakdowns = new Map<ID, SpaceCostBreakdown>()
  let unassignedSurfaceArea = 0
  let unassignedAmount = 0
  let assignedSurfaceCount = 0
  let unassignedSurfaceCount = 0
  let allFullyAssigned = true

  for (const space of spaces) {
    const breakdown = calcSpaceCostBreakdown(space.areas, space.assignments, rates)
    spaceBreakdowns.set(space.spaceId, breakdown)
    if (!breakdown.fullyAssigned) allFullyAssigned = false

    for (const line of [breakdown.floor, breakdown.wall, breakdown.ceiling]) {
      if (line.material) {
        assignedSurfaceCount += 1
        const existing = accumulator.get(line.material.id)
        if (existing) {
          existing.totalArea += line.area
        } else {
          accumulator.set(line.material.id, {
            material: line.material,
            totalArea: line.area,
          })
        }
      } else {
        unassignedSurfaceCount += 1
        unassignedSurfaceArea += line.area
        unassignedAmount += Number(line.amount)
      }
    }
  }

  const lines: BoqLine[] = []
  for (const { material, totalArea } of accumulator.values()) {
    const waste = Math.max(0, material.wastePct) / 100
    const effectiveArea = totalArea * (1 + waste)
    const rawQuantity = effectiveArea / material.coverage
    const quantity = isDiscreteUnit(material.unit)
      ? Math.ceil(rawQuantity)
      : roundTwoDp(rawQuantity)
    const totalCost = quantity * material.unitPrice
    lines.push({
      materialId: material.id,
      materialName: material.name,
      category: material.category,
      unit: material.unit,
      totalArea: roundTwoDp(totalArea),
      quantity,
      unitPrice: material.unitPrice,
      totalAmount: toAmountString(totalCost),
      currency: material.currency,
    })
  }
  // Largest line first — the user almost always cares which material dominates.
  lines.sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))

  const categoryTotalsMap = new Map<MaterialCategory, { amount: number; currency: CurrencyCode }>()
  for (const line of lines) {
    const entry = categoryTotalsMap.get(line.category)
    if (entry) {
      entry.amount += Number(line.totalAmount)
    } else {
      categoryTotalsMap.set(line.category, {
        amount: Number(line.totalAmount),
        currency: line.currency,
      })
    }
  }

  const categoryTotals: BoqCategoryTotal[] = Array.from(categoryTotalsMap.entries())
    .map(([category, value]) => ({
      category,
      amount: toAmountString(value.amount),
      currency: value.currency,
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount))

  const linesTotal = lines.reduce((sum, line) => sum + Number(line.totalAmount), 0)
  const grandTotalRaw = linesTotal + unassignedAmount

  return {
    lines,
    categoryTotals,
    grandTotal: toAmountString(grandTotalRaw),
    currency: rates.currency,
    spaceBreakdowns,
    unassignedSurfaceArea: roundTwoDp(unassignedSurfaceArea),
    unassignedAmount: toAmountString(unassignedAmount),
    totalSurfaceCount: spaces.length * 3,
    assignedSurfaceCount,
    unassignedSurfaceCount,
    fullyAssigned: allFullyAssigned && spaces.length > 0,
  }
}
