import type { CurrencyCode, ID, ISODateString } from '@/shared/types'

/**
 * The CURRENT price for a (material, supplier) pair. Exactly one live row per
 * pair per org. Updating the price never overwrites history — the server
 * writes a new `PriceSnapshot` and bumps `unitPrice + effectiveDate` here.
 */
export interface MaterialSupplierPrice {
  id: ID
  organizationId: ID
  materialId: ID
  supplierId: ID
  unitPrice: number
  currency: CurrencyCode
  minimumOrderQuantity: number | null
  leadTimeDays: number | null
  effectiveDate: ISODateString
  /** Per-MATERIAL preferred flag. At most one true per material per org. */
  isPreferred: boolean
  notes: string | null
  createdAt: ISODateString
  updatedAt: ISODateString
  deletedAt: ISODateString | null
}

/**
 * Immutable price history row. Written on every create / price-update of a
 * `MaterialSupplierPrice`. Never updated, never deleted.
 */
export interface PriceSnapshot {
  id: ID
  organizationId: ID
  materialId: ID
  supplierId: ID
  price: number
  currency: CurrencyCode
  effectiveDate: ISODateString
  createdAt: ISODateString
}

/** Form payload for setting a price. The server fabricates the snapshot. */
export type SetPriceInput = {
  materialId: ID
  supplierId: ID
  unitPrice: number
  currency?: CurrencyCode
  minimumOrderQuantity: number | null
  leadTimeDays: number | null
  isPreferred?: boolean
  notes: string
  /** ISO; omitted = server uses `now`. */
  effectiveDate?: ISODateString
}

/** Metadata-only patch — does NOT touch the price. */
export type PatchPriceLinkInput = {
  minimumOrderQuantity?: number | null
  leadTimeDays?: number | null
  isPreferred?: boolean
  notes?: string | null
}
