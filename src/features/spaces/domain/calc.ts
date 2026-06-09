import type { CurrencyCode } from '@/shared/types'
import type { ProjectTotals, Space, SpaceCost, SpaceMeasurements } from './space.types'

/**
 * Pure measurement & costing primitives. Framework-free: no react, no mantine,
 * no i18next — these stay in `domain/` so they can be unit-tested in isolation
 * and reused by a future API/worker without dragging the UI tree along.
 *
 * Money is kept as a decimal *string* + currency so the wire-format matches
 * Prisma `Decimal`. We multiply via plain JS for the placeholder rates (numbers
 * the user enters), then snap to 2dp at the very last step — no compounding.
 */

const TWO_DP = 100

function roundCurrency(value: number): number {
  return Math.round(value * TWO_DP) / TWO_DP
}

function toMoneyString(value: number): string {
  return roundCurrency(value).toFixed(2)
}

/**
 * Sanitise a user-entered dimension. Non-finite values, NaN, and negative
 * numbers become 0 so the live preview never paints `NaN m²`.
 */
function clean(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function calcMeasurements(input: {
  length: number
  width: number
  height: number
}): SpaceMeasurements {
  const length = clean(input.length)
  const width = clean(input.width)
  const height = clean(input.height)

  const floorArea = length * width
  const perimeter = (length + width) * 2
  const wallArea = perimeter * height
  const ceilingArea = floorArea

  return { floorArea, wallArea, ceilingArea, perimeter }
}

export interface CostRates {
  floorPerSqm: number
  wallPerSqm: number
  currency: CurrencyCode
}

export function calcCost(measurements: SpaceMeasurements, rates: CostRates): SpaceCost {
  const floor = measurements.floorArea * rates.floorPerSqm
  const wall = measurements.wallArea * rates.wallPerSqm
  return {
    floorAmount: toMoneyString(floor),
    wallAmount: toMoneyString(wall),
    totalAmount: toMoneyString(floor + wall),
    currency: rates.currency,
  }
}

/**
 * Aggregate every space in a project. Sums the raw measurements then derives
 * the cost from that aggregate — so per-space rounding never compounds into
 * the project total.
 */
export function calcProjectTotals(spaces: Space[], rates: CostRates): ProjectTotals {
  let floorArea = 0
  let wallArea = 0
  let ceilingArea = 0
  let perimeter = 0

  for (const space of spaces) {
    const measurements = calcMeasurements(space)
    floorArea += measurements.floorArea
    wallArea += measurements.wallArea
    ceilingArea += measurements.ceilingArea
    perimeter += measurements.perimeter
  }

  const cost = calcCost({ floorArea, wallArea, ceilingArea, perimeter }, rates)

  return {
    spaceCount: spaces.length,
    floorArea,
    wallArea,
    ceilingArea,
    perimeter,
    cost,
  }
}
