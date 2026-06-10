import type { AuditedRow } from '@/shared/db'

/**
 * Persisted supplier row. Audit fields come from `AuditedRow`; the rest matches
 * the Bun + Prisma + SQLite schema 1:1 (see apps/api/prisma/schema.prisma).
 *
 * Note: `Supplier.preferred` is an org-wide flag ("this supplier is generally
 * our default"). A per-material preferred supplier is tracked on
 * `MaterialSupplierPrice.isPreferred` — see `./price.types.ts`.
 */
export interface Supplier extends AuditedRow {
  name: string
  country: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  paymentTerms: string | null
  /** Average lead time in days for orders from this supplier. */
  leadTimeDays: number | null
  /** Quality rating in [0, 5]. Null while the org is still ranking suppliers. */
  rating: number | null
  preferred: boolean
  notes: string | null
}

/** Form payload — accepted by both create and update. */
export type SupplierInput = {
  name: string
  country: string
  contactName: string
  email: string
  phone: string
  website: string
  paymentTerms: string
  leadTimeDays: number | null
  rating: number | null
  preferred: boolean
  notes: string
}
