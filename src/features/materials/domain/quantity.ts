import type { CurrencyCode } from '@/shared/types'
import type { Material, MaterialUnit } from './material.types'

/**
 * Pure quantity & cost engine. Converts a SURFACE (area in m²) plus a
 * MATERIAL (price, coverage, waste, unit) into:
 *   - the quantity that must be purchased
 *   - the cost of that quantity
 *
 * Two rounding policies cover every unit:
 *   - continuous units (m², kg) → quantity is rounded to 2dp
 *   - discrete units (bag, piece) → quantity is rounded UP to the next whole
 *     unit, because you cannot purchase 3.4 bags of grout
 *
 * Money is computed in plain JS, then snapped to 2dp ONLY at the boundary so
 * intermediate rounding cannot compound. The returned `amount` is a decimal
 * string so the wire format matches Prisma `Decimal` whenever the real API
 * replaces this engine.
 */

const TWO_DP = 100

function roundTwoDp(value: number): number {
  return Math.round(value * TWO_DP) / TWO_DP
}

function toAmountString(value: number): string {
  return roundTwoDp(value).toFixed(2)
}

const DISCRETE_UNITS: ReadonlySet<MaterialUnit> = new Set(['bag', 'piece'])

export function isDiscreteUnit(unit: MaterialUnit): boolean {
  return DISCRETE_UNITS.has(unit)
}

export interface SurfaceQuantity {
  /** Area in m² before any waste is applied. */
  area: number
  /** Quantity to purchase, expressed in the material's unit. */
  quantity: number
  /** Cost of the purchased quantity, in the material's currency. */
  amount: string
  currency: CurrencyCode
}

/**
 * Compute the quantity required for a single surface against a single
 * material. The surface contributes `0` quantity if its area is non-positive
 * (defensive: a freshly-typed dimension form can pass `0` while the user is
 * still typing — we must not paint NaN).
 */
export function calcSurfaceQuantity(area: number, material: Material): SurfaceQuantity {
  const sanitisedArea = Number.isFinite(area) && area > 0 ? area : 0
  const waste = Math.max(0, material.wastePct) / 100
  const effectiveArea = sanitisedArea * (1 + waste)

  const rawQuantity = effectiveArea / material.coverage
  const quantity = isDiscreteUnit(material.unit)
    ? Math.ceil(rawQuantity)
    : roundTwoDp(rawQuantity)

  const cost = quantity * material.unitPrice

  return {
    area: sanitisedArea,
    quantity,
    amount: toAmountString(cost),
    currency: material.currency,
  }
}

/**
 * Discriminated source of every number in the cost engine. Exposed on
 * `SurfaceCostLine` so the UI (and the dev-only cost-trace mode) can show
 * EXACTLY where each amount came from — a material in the org's library, or
 * the fallback `DEFAULT_RATES` config. There is no third source: any new
 * value flowing through has to be added here first.
 */
export type CostSource =
  | { kind: 'material'; materialId: string; materialName: string; unitPrice: number }
  | { kind: 'default-rate'; surface: 'floor' | 'wall' | 'ceiling'; ratePerSqm: number }

export interface SurfaceCostLine {
  /** Which surface this line represents — used as a stable key in the UI. */
  surface: 'floor' | 'wall' | 'ceiling'
  area: number
  /** Resolved material, or null when the surface falls back to a default rate. */
  material: Material | null
  /** Empty when the surface uses default rates (`material === null`). */
  quantity: number | null
  amount: string
  currency: CurrencyCode
  /** Provenance — see `CostSource` for the closed list of possibilities. */
  source: CostSource
}

export interface DefaultRates {
  floorPerSqm: number
  wallPerSqm: number
  /**
   * Optional ceiling rate. When omitted, ceiling falls back to the floor rate
   * — matching the Phase 2 placeholder behaviour.
   */
  ceilingPerSqm?: number
  currency: CurrencyCode
}

function buildFallback(
  surface: SurfaceCostLine['surface'],
  area: number,
  rates: DefaultRates,
): SurfaceCostLine {
  const sanitisedArea = Number.isFinite(area) && area > 0 ? area : 0
  const ratePerSqm =
    surface === 'floor'
      ? rates.floorPerSqm
      : surface === 'wall'
        ? rates.wallPerSqm
        : (rates.ceilingPerSqm ?? rates.floorPerSqm)
  return {
    surface,
    area: sanitisedArea,
    material: null,
    quantity: null,
    amount: toAmountString(sanitisedArea * ratePerSqm),
    currency: rates.currency,
    source: { kind: 'default-rate', surface, ratePerSqm },
  }
}

export interface SpaceAreas {
  floorArea: number
  wallArea: number
  ceilingArea: number
}

export interface SpaceMaterialAssignments {
  floorMaterial: Material | null
  wallMaterial: Material | null
  ceilingMaterial: Material | null
}

export interface SpaceCostBreakdown {
  floor: SurfaceCostLine
  wall: SurfaceCostLine
  ceiling: SurfaceCostLine
  totalAmount: string
  currency: CurrencyCode
  /** True iff every surface uses a material (i.e. nothing fell back). */
  fullyAssigned: boolean
}

/**
 * Compute every surface line for a single space, falling back to default
 * placeholder rates wherever a surface has no material assigned. The total is
 * computed BEFORE we serialise each line to a fixed-decimal string so the
 * intermediate sum never gains banker's-rounding drift.
 */
export function calcSpaceCostBreakdown(
  areas: SpaceAreas,
  assignments: SpaceMaterialAssignments,
  rates: DefaultRates,
): SpaceCostBreakdown {
  const floor = assignments.floorMaterial
    ? toLine('floor', areas.floorArea, assignments.floorMaterial)
    : buildFallback('floor', areas.floorArea, rates)
  const wall = assignments.wallMaterial
    ? toLine('wall', areas.wallArea, assignments.wallMaterial)
    : buildFallback('wall', areas.wallArea, rates)
  const ceiling = assignments.ceilingMaterial
    ? toLine('ceiling', areas.ceilingArea, assignments.ceilingMaterial)
    : buildFallback('ceiling', areas.ceilingArea, rates)

  const totalRaw = Number(floor.amount) + Number(wall.amount) + Number(ceiling.amount)

  return {
    floor,
    wall,
    ceiling,
    totalAmount: toAmountString(totalRaw),
    currency: rates.currency,
    fullyAssigned: Boolean(
      assignments.floorMaterial && assignments.wallMaterial && assignments.ceilingMaterial,
    ),
  }
}

function toLine(
  surface: SurfaceCostLine['surface'],
  area: number,
  material: Material,
): SurfaceCostLine {
  const result = calcSurfaceQuantity(area, material)
  return {
    surface,
    area: result.area,
    material,
    quantity: result.quantity,
    amount: result.amount,
    currency: result.currency,
    source: {
      kind: 'material',
      materialId: material.id,
      materialName: material.name,
      unitPrice: material.unitPrice,
    },
  }
}
