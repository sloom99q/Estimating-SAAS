import { DEFAULT_CURRENCY } from '@/shared/config/constants'
import type { CostRates } from '../domain/calc'

/**
 * Default placeholder cost rates per square metre. These are intentionally
 * round numbers in the tenant's default currency — the materials/supplier
 * intelligence layer (later phase) will replace them with real, sourced prices.
 *
 * Keeping rates as a single shared constant here means the rest of the feature
 * never hardcodes a number; swapping to per-org or per-project-type rates is a
 * one-file change.
 */
export const DEFAULT_RATES: CostRates = {
  floorPerSqm: 280,
  wallPerSqm: 180,
  currency: DEFAULT_CURRENCY,
}
