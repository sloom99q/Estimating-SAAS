import {
  createRepository,
  generateId,
  listAllRaw,
  seedTable,
  softDeleteWhere,
} from './driver.localStorage'

/**
 * Single source of truth for the persistence driver. The browser app uses the
 * localStorage driver out of the box. To switch to a real Postgres / Prisma
 * backend, replace this re-export with a `prisma`-backed driver that
 * implements the same `RepositoryDescriptor` contract (see `driver.types`).
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Feature code → Repository (typed CRUD)                    │
 *   │                ↓                                           │
 *   │      `dbClient` (this module)                              │
 *   │                ↓                                           │
 *   │      localStorage driver  ←OR→  Prisma server driver       │
 *   └────────────────────────────────────────────────────────────┘
 *
 * No feature ever imports the driver directly — only this `dbClient`.
 */

export const dbClient = {
  createRepository,
  generateId,
  softDeleteWhere,
  listAllRaw,
  seedTable,
} as const

export type {
  AuditedRow,
  QueryOptions,
  QueryWhere,
  Repository,
} from './driver.types'
export type { RepositoryDescriptor } from './driver.localStorage'
