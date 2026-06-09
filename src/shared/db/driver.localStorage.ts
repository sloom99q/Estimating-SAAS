import type { ID } from '@/shared/types'
import type { AuditedRow, QueryOptions, Repository } from './driver.types'

/**
 * Browser-side persistence driver. Reads / writes a single localStorage entry
 * per table (`estimator:db:<table>`). Designed to mimic what a Prisma /
 * server-backed driver will return so swapping is one line in `db/client.ts`.
 *
 *   - Soft-delete-aware: `list` and `findById` filter out rows with a non-null
 *     `deletedAt` by default; pass `includeDeleted: true` to opt back in.
 *   - Multi-tenant: every operation takes `organizationId`. Reads scope down
 *     to that org; writes refuse to leak across orgs.
 *   - Transport-shape parity with Prisma: returns plain JSON-serialisable
 *     objects, stamps `createdAt` / `updatedAt` / `deletedAt` itself.
 *
 * Lives in `shared/db/` (not `shared/lib/storage`) so the entire persistence
 * concern lives in one folder once a server driver lands beside it.
 */

const STORAGE_PREFIX = 'estimator:db:'

interface SerializedTable<T extends AuditedRow> {
  rows: T[]
}

function storageKey(table: string): string {
  return `${STORAGE_PREFIX}${table}`
}

function readTable<T extends AuditedRow>(table: string): T[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(table))
    if (!raw) return []
    const parsed = JSON.parse(raw) as SerializedTable<T>
    return Array.isArray(parsed.rows) ? parsed.rows : []
  } catch {
    return []
  }
}

function writeTable<T extends AuditedRow>(table: string, rows: T[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(table), JSON.stringify({ rows }))
  } catch {
    // Quota / private-mode failures are silently ignored — the in-memory copy
    // still serves the rest of the session.
  }
}

/** Sortable, non-sequential id — matches the Prisma `cuid()` shape on the wire. */
export function generateId(prefix: string): ID {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${time}${rand}`
}

/**
 * Implementation contract that domain repositories pass to {@link createRepository}.
 * Splits CONCRETE knowledge (table name, id prefix, how to normalise an input
 * into a brand-new row) from the GENERIC CRUD machinery. Repositories never
 * touch localStorage directly — they describe their shape, the driver does the
 * rest. When the server driver lands it gets the same descriptor.
 */
export interface RepositoryDescriptor<TRow extends AuditedRow, TCreate, TUpdate = TCreate> {
  /** Storage table name. Must be unique. */
  table: string
  /** id prefix used by {@link generateId} (e.g. 'prj', 'spc', 'mat'). */
  idPrefix: string
  /**
   * Transform a CREATE payload into a fully-formed row body (excluding the
   * generic audit fields, which the driver stamps). Implementations apply
   * trimming / null-coalescing here.
   */
  fromCreate: (organizationId: ID, input: TCreate) => Omit<TRow, keyof AuditedRow>
  /**
   * Transform an UPDATE payload into the partial row patch. Used to apply
   * trimming and to omit fields the caller didn't pass.
   */
  fromUpdate?: (input: Partial<TUpdate>) => Partial<Omit<TRow, keyof AuditedRow>>
  /**
   * Read-time defensive backfill for rows persisted by an earlier phase whose
   * schema lacked a field that exists today.
   */
  normaliseOnRead?: (row: TRow) => TRow
}

function matchesWhere<T extends AuditedRow>(row: T, where: QueryOptions<T>['where']): boolean {
  if (!where) return true
  const filter = where as Record<string, unknown>
  for (const key of Object.keys(filter)) {
    if ((row as Record<string, unknown>)[key] !== filter[key]) return false
  }
  return true
}

function applyOrder<T extends AuditedRow>(
  rows: T[],
  orderBy: QueryOptions<T>['orderBy'],
): T[] {
  if (!orderBy) return rows
  const entries = Object.entries(orderBy) as Array<[keyof T, 'asc' | 'desc']>
  if (entries.length === 0) return rows
  const sorted = [...rows]
  sorted.sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = a[key]
      const bv = b[key]
      if (av === bv) continue
      const sign = dir === 'desc' ? -1 : 1
      if (av == null) return 1 * sign
      if (bv == null) return -1 * sign
      return av < bv ? -1 * sign : 1 * sign
    }
    return 0
  })
  return sorted
}

/**
 * Build a Repository against the localStorage driver. Returns the generic
 * `Repository<TRow,...>` interface, so calling code is unaware which driver
 * powers it — making the future server swap a one-file change.
 */
export function createRepository<TRow extends AuditedRow, TCreate, TUpdate = TCreate>(
  descriptor: RepositoryDescriptor<TRow, TCreate, TUpdate>,
): Repository<TRow, TCreate, TUpdate> {
  // Eager load once; every mutation flushes back to disk.
  let rows: TRow[] = readTable<TRow>(descriptor.table).map(
    descriptor.normaliseOnRead ?? ((row) => row),
  )

  function persist(): void {
    writeTable(descriptor.table, rows)
  }

  return {
    async list(organizationId, options = {}) {
      const includeDeleted = options.includeDeleted ?? false
      const filtered = rows.filter(
        (row) =>
          row.organizationId === organizationId &&
          (includeDeleted || row.deletedAt === null) &&
          matchesWhere(row, options.where),
      )
      const ordered = applyOrder(filtered, options.orderBy)
      return options.limit ? ordered.slice(0, options.limit) : ordered
    },

    async findById(organizationId, id, options = {}) {
      const includeDeleted = options.includeDeleted ?? false
      const row = rows.find(
        (candidate) =>
          candidate.organizationId === organizationId &&
          candidate.id === id &&
          (includeDeleted || candidate.deletedAt === null),
      )
      return row ?? null
    },

    async create(organizationId, input) {
      const body = descriptor.fromCreate(organizationId, input)
      const now = new Date().toISOString()
      const created = {
        ...body,
        id: generateId(descriptor.idPrefix),
        organizationId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as TRow
      rows = [...rows, created]
      persist()
      return created
    },

    async update(organizationId, id, input) {
      const patch = descriptor.fromUpdate
        ? descriptor.fromUpdate(input)
        : (input as unknown as Partial<Omit<TRow, keyof AuditedRow>>)
      const now = new Date().toISOString()
      let next: TRow | null = null
      rows = rows.map((row) => {
        if (row.organizationId !== organizationId || row.id !== id) return row
        next = { ...row, ...patch, id: row.id, organizationId: row.organizationId, updatedAt: now }
        return next
      })
      if (!next) {
        throw new Error(`${descriptor.table}: row not found`)
      }
      persist()
      return next
    },

    async softDelete(organizationId, id) {
      const now = new Date().toISOString()
      let found = false
      rows = rows.map((row) => {
        if (row.organizationId !== organizationId || row.id !== id) return row
        if (row.deletedAt) return row
        found = true
        return { ...row, deletedAt: now, updatedAt: now }
      })
      if (found) persist()
    },

    async restore(organizationId, id) {
      let found = false
      rows = rows.map((row) => {
        if (row.organizationId !== organizationId || row.id !== id) return row
        if (!row.deletedAt) return row
        found = true
        return { ...row, deletedAt: null, updatedAt: new Date().toISOString() }
      })
      if (found) persist()
    },
  }
}

/**
 * Cross-table escape hatch. Used by callbacks that need to clean up dependent
 * rows (e.g. `Project` delete → soft-delete its `Space`s). Keeps that logic
 * inside the data layer so the feature service stays declarative.
 */
export function softDeleteWhere<TRow extends AuditedRow>(
  table: string,
  predicate: (row: TRow) => boolean,
): number {
  const rows = readTable<TRow>(table)
  const now = new Date().toISOString()
  let count = 0
  const next = rows.map((row) => {
    if (row.deletedAt) return row
    if (!predicate(row)) return row
    count += 1
    return { ...row, deletedAt: now, updatedAt: now }
  })
  if (count > 0) writeTable(table, next)
  return count
}

/** Read every row (including soft-deleted) — used by the seed script. */
export function listAllRaw<TRow extends AuditedRow>(table: string): TRow[] {
  return readTable<TRow>(table)
}

/** Replace the whole table — used only by the seed script when bootstrapping. */
export function seedTable<TRow extends AuditedRow>(table: string, rows: TRow[]): void {
  writeTable(table, rows)
}
