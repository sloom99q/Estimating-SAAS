import type { AuditedRow } from '@/shared/db'
import type { CurrencyCode, ID } from '@/shared/types'

/**
 * A single measurable space (room / area) inside a project. `AuditedRow`
 * brings in id / organizationId / createdAt / updatedAt / deletedAt — see
 * `@/shared/db`.
 */
export interface Space extends AuditedRow {
  projectId: ID
  name: string
  /** Internal length in metres. */
  length: number
  /** Internal width in metres. */
  width: number
  /** Floor-to-ceiling height in metres. */
  height: number
  /**
   * Material assignments per surface. `null` means "use default placeholder
   * rates" — the same surface a freshly-created space starts with. Nullable
   * (not optional) so a Partial-style update can clear an assignment without
   * fighting `exactOptionalPropertyTypes`.
   *
   * These IDs reference the `materials` feature but Space does NOT import the
   * Material type — by design, so cross-feature coupling stays at the ID level
   * and the composition layer (app/) is the only place that joins the two.
   */
  floorMaterialId: ID | null
  wallMaterialId: ID | null
  ceilingMaterialId: ID | null
}

/**
 * Form input shape — only the user-editable fields.
 * Type alias (not interface) so it satisfies Mantine useForm's
 * `Record<string, unknown>` generic constraint.
 */
export type SpaceInput = {
  name: string
  length: number
  width: number
  height: number
}

/**
 * Payload for updating ONLY the material assignments of a space. Kept
 * separate from `SpaceInput` so the dimensions form and the assignments
 * dialog can mutate independently — preventing one path from accidentally
 * wiping the other path's data.
 */
export type SpaceMaterialsInput = {
  floorMaterialId: ID | null
  wallMaterialId: ID | null
  ceilingMaterialId: ID | null
}

/**
 * Pure-numeric measurements derived from `(length, width, height)`. All values
 * are in square or linear metres; the formatter is responsible for display.
 */
export interface SpaceMeasurements {
  floorArea: number
  wallArea: number
  ceilingArea: number
  perimeter: number
}

/**
 * Placeholder cost breakdown. Money values are kept as decimal strings + a
 * currency code so the shape matches the eventual API (Prisma `Decimal` →
 * string on the wire) — no JS-float arithmetic for money.
 */
export interface SpaceCost {
  floorAmount: string
  wallAmount: string
  totalAmount: string
  currency: CurrencyCode
}

/** Aggregated project totals across every space. */
export interface ProjectTotals {
  spaceCount: number
  floorArea: number
  wallArea: number
  ceilingArea: number
  perimeter: number
  cost: SpaceCost
}
