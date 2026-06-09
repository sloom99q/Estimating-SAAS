import type { ID, ISODateString } from '@/shared/types'

/**
 * Shape every row coming OUT of the DbClient. Audit fields are required so the
 * UI / repository layer can rely on them. Domain types extend `AuditedRow`
 * (`type Project = AuditedRow & { name: ... }`), keeping the persistence
 * contract in one place.
 */
export interface AuditedRow {
  id: ID
  organizationId: ID
  createdAt: ISODateString
  updatedAt: ISODateString
  /** ISO timestamp when the row was soft-deleted; null while it's live. */
  deletedAt: ISODateString | null
}

/**
 * Predicate-based filter, expressed as field equality. Sufficient for the
 * Phase-5 demands (project scoping, list filters); the underlying driver is
 * free to translate it (Prisma → `where`, localStorage → `Array.filter`).
 */
export type QueryWhere<T> = Partial<Pick<T, Extract<keyof T, string>>>

export interface QueryOptions<T> {
  where?: QueryWhere<T>
  orderBy?: { [K in keyof T]?: 'asc' | 'desc' }
  limit?: number
  /** Include soft-deleted rows. Default: false. */
  includeDeleted?: boolean
}

/**
 * Generic CRUD repository contract. Implementations talk to the underlying
 * DbClient; feature code never instantiates these directly.
 *
 *   - `list` and `findById` honour soft-delete by default.
 *   - `softDelete` writes the `deletedAt` stamp without removing the row.
 *   - `restore` clears `deletedAt`.
 *   - `hardDelete` is intentionally NOT exposed — soft-delete is the only
 *     destructive path so historical reports / audit trails stay intact.
 */
export interface Repository<TRow extends AuditedRow, TCreate, TUpdate = TCreate> {
  list(organizationId: ID, options?: QueryOptions<TRow>): Promise<TRow[]>
  findById(
    organizationId: ID,
    id: ID,
    options?: { includeDeleted?: boolean },
  ): Promise<TRow | null>
  create(organizationId: ID, input: TCreate): Promise<TRow>
  update(organizationId: ID, id: ID, input: Partial<TUpdate>): Promise<TRow>
  softDelete(organizationId: ID, id: ID): Promise<void>
  restore(organizationId: ID, id: ID): Promise<void>
}
