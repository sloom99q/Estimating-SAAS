import { env } from '@/shared/config/env'
import { createHttpRepository } from './driver.http'
import {
  createRepository as createLocalStorageRepository,
  generateId,
  listAllRaw,
  seedTable,
  softDeleteWhere,
  type RepositoryDescriptor,
} from './driver.localStorage'
import type { AuditedRow, Repository } from './driver.types'

/**
 * Single source of truth for the persistence driver. When `VITE_API_URL` is
 * configured, every repository talks to the Bun + Prisma + SQLite API over
 * HTTP. When it is not (offline-only dev / tests), the legacy localStorage
 * driver covers the same `Repository<TRow, TCreate, TUpdate>` contract, so
 * feature code never branches on driver.
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Feature code → Repository (typed CRUD)                    │
 *   │                ↓                                           │
 *   │      `dbClient` (this module)                              │
 *   │                ↓                                           │
 *   │      HTTP driver  ←OR→  localStorage driver                │
 *   └────────────────────────────────────────────────────────────┘
 *
 * No feature ever imports a driver directly — only this `dbClient`.
 */

const useHttpDriver = env.apiUrl !== ''

function createRepository<TRow extends AuditedRow, TCreate, TUpdate = TCreate>(
  descriptor: RepositoryDescriptor<TRow, TCreate, TUpdate>,
): Repository<TRow, TCreate, TUpdate> {
  return useHttpDriver
    ? createHttpRepository<TRow, TCreate, TUpdate>(descriptor)
    : createLocalStorageRepository<TRow, TCreate, TUpdate>(descriptor)
}

/**
 * `softDeleteWhere`, `listAllRaw` and `seedTable` are localStorage-only
 * affordances. In HTTP mode the server owns those concerns: cascading
 * soft-deletes happen inside the project DELETE transaction, and seeding is
 * `bun run seed` on the API side. The frontend helpers no-op rather than
 * fail, so legacy call sites stay valid.
 */
function safeListAllRaw<TRow extends AuditedRow>(table: string): TRow[] {
  return useHttpDriver ? [] : listAllRaw<TRow>(table)
}
function safeSeedTable<TRow extends AuditedRow>(table: string, rows: TRow[]): void {
  if (useHttpDriver) return
  seedTable(table, rows)
}
function safeSoftDeleteWhere<TRow extends AuditedRow>(
  table: string,
  predicate: (row: TRow) => boolean,
): number {
  return useHttpDriver ? 0 : softDeleteWhere(table, predicate)
}

export const dbClient = {
  /** True when the HTTP/SQLite backend is in use (i.e. VITE_API_URL is set). */
  isHttpBacked: useHttpDriver,
  createRepository,
  generateId,
  softDeleteWhere: safeSoftDeleteWhere,
  listAllRaw: safeListAllRaw,
  seedTable: safeSeedTable,
} as const

export type {
  AuditedRow,
  QueryOptions,
  QueryWhere,
  Repository,
} from './driver.types'
export type { RepositoryDescriptor } from './driver.localStorage'
