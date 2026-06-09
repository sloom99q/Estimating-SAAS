import type { AuditedRow } from '@/shared/db'
import type { CurrencyCode } from '@/shared/types'

/**
 * Material categories exposed by the library UI. Kept narrow on purpose — the
 * `'other'` bucket exists for everything that does not yet have its own bucket
 * (cleaners, sealants, hardware), so the form never has to grow a free-text
 * category field. New categories slot in here when a real demand appears.
 */
export const MATERIAL_CATEGORIES = [
  'tiles',
  'marble',
  'paint',
  'gypsum',
  'glue',
  'grout',
  'cladding',
  'other',
] as const
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

/**
 * Unit of measure. `m2` and `kg` are continuous (the quantity engine rounds to
 * 2dp), `bag` and `piece` are discrete (the engine rounds quantity UP — you
 * cannot purchase 3.4 bags of grout).
 */
export const MATERIAL_UNITS = ['m2', 'kg', 'bag', 'piece'] as const
export type MaterialUnit = (typeof MATERIAL_UNITS)[number]

/**
 * A material in the org's library. Money values are kept as plain numbers in
 * the form/store for ergonomic editing; the storage layer + wire format stay
 * decimal-safe by serialising via `toFixed(2)` only at boundaries.
 *
 * `AuditedRow` brings in id / organizationId / createdAt / updatedAt /
 * deletedAt — see `@/shared/db`.
 */
export interface Material extends AuditedRow {
  name: string
  category: MaterialCategory
  unit: MaterialUnit
  /** Price per unit, in the material's `currency`. */
  unitPrice: number
  /**
   * Surface (m²) covered by ONE unit. For `unit: m2` materials this is `1` by
   * convention; for `bag`/`piece` it captures the labelled coverage on the
   * package ("1 bag covers 4.5 m²"); for `kg` it captures the spread rate.
   */
  coverage: number
  /** Waste as a percentage of the raw area (e.g. 10 = 10%). */
  wastePct: number
  currency: CurrencyCode
  /**
   * Nullable rather than optional so a `Partial<Material>` patch can clear it
   * without fighting `exactOptionalPropertyTypes` — `null` is a real value,
   * `undefined` would mean "do not change".
   */
  supplier: string | null
  notes: string | null
  /**
   * Optional product photo. Phase 4 visual-first material UI uses this for
   * gallery cards, preview modals and as the floor texture inside the space
   * plan. Falls back to a category swatch when null.
   */
  imageUrl: string | null
  active: boolean
}

/**
 * Form payload. Optional strings are required-but-empty in the form values
 * (Mantine forms hate undefined defaults) and trimmed-then-omitted by the
 * service when saving.
 */
export type MaterialInput = {
  name: string
  category: MaterialCategory
  unit: MaterialUnit
  unitPrice: number
  coverage: number
  wastePct: number
  supplier: string
  notes: string
  imageUrl: string
  active: boolean
}
