import type { MaterialSupplierPrice, PriceSnapshot } from './price.types'

/**
 * Pure procurement-intelligence primitives. Framework-free: no react, no
 * mantine, no i18next, no data fetching. The composition layer feeds these
 * helpers the rows it already has; the same primitives back the BOQ engine,
 * the material detail page, and the future quotation cost-confidence layer.
 */

const TWO_DP = 100
function roundTwoDp(value: number): number {
  return Math.round(value * TWO_DP) / TWO_DP
}

/** Cheapest live price (excludes deleted links). Null when there are no prices. */
export function pickCheapestPrice<T extends MaterialSupplierPrice>(
  prices: ReadonlyArray<T>,
): T | null {
  let cheapest: T | null = null
  for (const price of prices) {
    if (price.deletedAt) continue
    if (!cheapest || price.unitPrice < cheapest.unitPrice) cheapest = price
  }
  return cheapest
}

/** Per-material preferred price (`MaterialSupplierPrice.isPreferred === true`). */
export function pickPreferredPrice<T extends MaterialSupplierPrice>(
  prices: ReadonlyArray<T>,
): T | null {
  for (const price of prices) {
    if (price.deletedAt) continue
    if (price.isPreferred) return price
  }
  return null
}

/**
 * Savings (in currency) of switching from preferred to cheapest. Positive =
 * cheapest is cheaper than preferred. Null when there is no preferred OR
 * when preferred IS the cheapest.
 */
export function savingsVsPreferred(
  preferred: MaterialSupplierPrice | null,
  cheapest: MaterialSupplierPrice | null,
): { amount: number; pct: number } | null {
  if (!preferred || !cheapest) return null
  if (preferred.id === cheapest.id) return null
  if (preferred.currency !== cheapest.currency) return null
  const amount = roundTwoDp(preferred.unitPrice - cheapest.unitPrice)
  if (amount <= 0) return null
  const pct = roundTwoDp((amount / preferred.unitPrice) * 100)
  return { amount, pct }
}

export type TrendDirection = 'up' | 'down' | 'stable'

export interface PriceTrend {
  direction: TrendDirection
  /** Percentage delta over the window (positive = up). */
  pct: number
  /** First snapshot used in the calc; never null when snapshots is non-empty. */
  fromPrice: number | null
  /** Last snapshot used in the calc. */
  toPrice: number | null
}

/**
 * Compute a trend by comparing the EARLIEST snapshot in the window to the
 * LATEST. `stableThresholdPct` controls when a delta is small enough to call
 * "stable" (default 1.5%). Snapshots are assumed pre-sorted by `effectiveDate`
 * ASC, which is the server's canonical order.
 */
export function computeTrend(
  snapshots: ReadonlyArray<PriceSnapshot>,
  stableThresholdPct = 1.5,
): PriceTrend {
  if (snapshots.length === 0) {
    return { direction: 'stable', pct: 0, fromPrice: null, toPrice: null }
  }
  const first = snapshots[0]!
  const last = snapshots[snapshots.length - 1]!
  if (first.price <= 0) {
    return { direction: 'stable', pct: 0, fromPrice: first.price, toPrice: last.price }
  }
  const pct = roundTwoDp(((last.price - first.price) / first.price) * 100)
  const direction: TrendDirection =
    Math.abs(pct) < stableThresholdPct ? 'stable' : pct > 0 ? 'up' : 'down'
  return { direction, pct, fromPrice: first.price, toPrice: last.price }
}

/**
 * Group snapshots by supplierId. Returns supplier id → snapshot[] sorted
 * ascending by effectiveDate, which is the shape the timeline chart expects.
 */
export function snapshotsBySupplier(
  snapshots: ReadonlyArray<PriceSnapshot>,
): Map<string, PriceSnapshot[]> {
  const map = new Map<string, PriceSnapshot[]>()
  for (const snap of snapshots) {
    const list = map.get(snap.supplierId)
    if (list) list.push(snap)
    else map.set(snap.supplierId, [snap])
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  }
  return map
}

export interface ProcurementSummary {
  prices: MaterialSupplierPrice[]
  cheapest: MaterialSupplierPrice | null
  preferred: MaterialSupplierPrice | null
  savings: { amount: number; pct: number } | null
  trend: PriceTrend
  supplierCount: number
}

/**
 * The single derivation the material detail page consumes. Pure: same inputs
 * always yield the same summary. The composition layer fetches `prices` +
 * `snapshots` for the material, hands them in, and renders the result.
 */
export function summariseProcurement(
  prices: ReadonlyArray<MaterialSupplierPrice>,
  snapshots: ReadonlyArray<PriceSnapshot>,
): ProcurementSummary {
  const live = prices.filter((p) => !p.deletedAt)
  const cheapest = pickCheapestPrice(live)
  const preferred = pickPreferredPrice(live)
  const sorted = [...snapshots].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate),
  )
  return {
    prices: live,
    cheapest,
    preferred,
    savings: savingsVsPreferred(preferred, cheapest),
    trend: computeTrend(sorted),
    supplierCount: live.length,
  }
}
