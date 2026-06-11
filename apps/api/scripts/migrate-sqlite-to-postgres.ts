/**
 * SQLite (Phase 8A/8B) → Postgres (Phase 9 Sprint 1) row-by-row migration.
 *
 *   bun apps/api/scripts/migrate-sqlite-to-postgres.ts
 *
 * Idempotent: each row is upserted by `id`. Print a per-table parity report at
 * the end. If any table's source / target row counts don't match, the script
 * exits non-zero.
 *
 * The destination is whatever `DATABASE_URL` points at (the live Postgres);
 * the source is `LEGACY_SQLITE_URL` (defaults to `apps/api/data/app.db`).
 */
import { Database } from 'bun:sqlite'
import path from 'node:path'
import { prisma } from '../src/db'

interface Row {
  [key: string]: unknown
}

// Default to apps/api/data/app.db resolved from this script's location, so the
// migration runs from any cwd (repo root, apps/api, anywhere).
const DEFAULT_SQLITE = path.resolve(import.meta.dir, '../data/app.db')
const LEGACY_URL = process.env.LEGACY_SQLITE_URL ?? DEFAULT_SQLITE

// ---------------------------------------------------------------------------
// SQLite reader
// ---------------------------------------------------------------------------

function openSqlite(url: string): Database {
  // Accept both `file:./path` and bare paths.
  const path = url.replace(/^file:/, '')
  return new Database(path, { readonly: true })
}

function readAll(db: Database, table: string): Row[] {
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as Row[]
  } catch (err) {
    if (String(err).includes('no such table')) {
      console.log(`  ↳ table ${table} not present in legacy db — skipping`)
      return []
    }
    throw err
  }
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function asString(value: unknown): string {
  return value == null ? '' : String(value)
}

function asNum(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

// ---------------------------------------------------------------------------
// Per-table migrators. Order matters — FK parents first.
// ---------------------------------------------------------------------------

type Migrator = {
  name: string
  legacyTable: string
  migrate: (rows: Row[]) => Promise<number>
}

const MIGRATORS: Migrator[] = [
  {
    name: 'organizations',
    legacyTable: 'organizations',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.organization.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            name: asString(r.name),
            slug: asString(r.slug),
            defaultCurrency: asString(r.defaultCurrency) || 'AED',
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
            ...(toDate(r.updatedAt) ? { updatedAt: toDate(r.updatedAt) as Date } : {}),
            deletedAt: toDate(r.deletedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'users',
    legacyTable: 'users',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.user.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            email: asString(r.email),
            fullName: asString(r.fullName),
            passwordHash: asString(r.passwordHash),
            avatarUrl: r.avatarUrl == null ? null : asString(r.avatarUrl),
            isSuperAdmin: asBool(r.isSuperAdmin),
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
            ...(toDate(r.updatedAt) ? { updatedAt: toDate(r.updatedAt) as Date } : {}),
            deletedAt: toDate(r.deletedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'memberships',
    legacyTable: 'memberships',
    migrate: async (rows) => {
      for (const r of rows) {
        const roleRaw = asString(r.role) || 'estimator'
        // Legacy values land cleanly on the new enum because the seed used
        // the same vocabulary.
        const role = (['owner', 'admin', 'estimator', 'viewer'] as const).includes(
          roleRaw as 'owner' | 'admin' | 'estimator' | 'viewer',
        )
          ? (roleRaw as 'owner' | 'admin' | 'estimator' | 'viewer')
          : 'estimator'
        await prisma.membership.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            organizationId: asString(r.organizationId),
            userId: asString(r.userId),
            role,
            status: asString(r.status) || 'active',
            ...(toDate(r.invitedAt) ? { invitedAt: toDate(r.invitedAt) as Date } : {}),
            joinedAt: toDate(r.joinedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'projects',
    legacyTable: 'projects',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.project.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            organizationId: asString(r.organizationId),
            name: asString(r.name),
            clientName: asString(r.clientName),
            location: asString(r.location),
            type: asString(r.type),
            status: asString(r.status) || 'lead',
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
            ...(toDate(r.updatedAt) ? { updatedAt: toDate(r.updatedAt) as Date } : {}),
            deletedAt: toDate(r.deletedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'spaces',
    legacyTable: 'spaces',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.space.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            organizationId: asString(r.organizationId),
            projectId: asString(r.projectId),
            name: asString(r.name),
            length: asNum(r.length),
            width: asNum(r.width),
            height: asNum(r.height),
            floorMaterialId: r.floorMaterialId == null ? null : asString(r.floorMaterialId),
            wallMaterialId: r.wallMaterialId == null ? null : asString(r.wallMaterialId),
            ceilingMaterialId: r.ceilingMaterialId == null ? null : asString(r.ceilingMaterialId),
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
            ...(toDate(r.updatedAt) ? { updatedAt: toDate(r.updatedAt) as Date } : {}),
            deletedAt: toDate(r.deletedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'materials',
    legacyTable: 'materials',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.material.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            organizationId: asString(r.organizationId),
            name: asString(r.name),
            category: asString(r.category),
            unit: asString(r.unit),
            unitPrice: asNum(r.unitPrice),
            coverage: asNum(r.coverage),
            wastePct: asNum(r.wastePct),
            currency: asString(r.currency) || 'AED',
            supplier: r.supplier == null ? null : asString(r.supplier),
            notes: r.notes == null ? null : asString(r.notes),
            imageUrl: r.imageUrl == null ? null : asString(r.imageUrl),
            active: asBool(r.active),
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
            ...(toDate(r.updatedAt) ? { updatedAt: toDate(r.updatedAt) as Date } : {}),
            deletedAt: toDate(r.deletedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'suppliers',
    legacyTable: 'suppliers',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.supplier.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            organizationId: asString(r.organizationId),
            name: asString(r.name),
            country: r.country == null ? null : asString(r.country),
            contactName: r.contactName == null ? null : asString(r.contactName),
            email: r.email == null ? null : asString(r.email),
            phone: r.phone == null ? null : asString(r.phone),
            website: r.website == null ? null : asString(r.website),
            paymentTerms: r.paymentTerms == null ? null : asString(r.paymentTerms),
            leadTimeDays: r.leadTimeDays == null ? null : asNum(r.leadTimeDays),
            rating: r.rating == null ? null : asNum(r.rating),
            preferred: asBool(r.preferred),
            notes: r.notes == null ? null : asString(r.notes),
            // creditLimitAed is the ADR-009 addition — not present in legacy
            // rows, so it stays null on migration.
            creditLimitAed: null,
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
            ...(toDate(r.updatedAt) ? { updatedAt: toDate(r.updatedAt) as Date } : {}),
            deletedAt: toDate(r.deletedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'material_supplier_prices',
    legacyTable: 'material_supplier_prices',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.materialSupplierPrice.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            organizationId: asString(r.organizationId),
            materialId: asString(r.materialId),
            supplierId: asString(r.supplierId),
            unitPrice: asNum(r.unitPrice),
            currency: asString(r.currency),
            minimumOrderQuantity:
              r.minimumOrderQuantity == null ? null : asNum(r.minimumOrderQuantity),
            leadTimeDays: r.leadTimeDays == null ? null : asNum(r.leadTimeDays),
            effectiveDate: toDate(r.effectiveDate) ?? new Date(),
            isPreferred: asBool(r.isPreferred),
            notes: r.notes == null ? null : asString(r.notes),
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
            ...(toDate(r.updatedAt) ? { updatedAt: toDate(r.updatedAt) as Date } : {}),
            deletedAt: toDate(r.deletedAt),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
  {
    name: 'price_snapshots',
    legacyTable: 'price_snapshots',
    migrate: async (rows) => {
      for (const r of rows) {
        await prisma.priceSnapshot.upsert({
          where: { id: asString(r.id) },
          create: {
            id: asString(r.id),
            organizationId: asString(r.organizationId),
            materialId: asString(r.materialId),
            supplierId: asString(r.supplierId),
            price: asNum(r.price),
            currency: asString(r.currency),
            effectiveDate: toDate(r.effectiveDate) ?? new Date(),
            ...(toDate(r.createdAt) ? { createdAt: toDate(r.createdAt) as Date } : {}),
          },
          update: {},
        })
      }
      return rows.length
    },
  },
]

// ---------------------------------------------------------------------------
// Target row counts (post-migration) so we can print the parity report.
// ---------------------------------------------------------------------------

async function targetRowCounts(): Promise<Record<string, number>> {
  return {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    memberships: await prisma.membership.count(),
    projects: await prisma.project.count(),
    spaces: await prisma.space.count(),
    materials: await prisma.material.count(),
    suppliers: await prisma.supplier.count(),
    material_supplier_prices: await prisma.materialSupplierPrice.count(),
    price_snapshots: await prisma.priceSnapshot.count(),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[migrate] source = ${LEGACY_URL}`)
  console.log(`[migrate] target = ${process.env.DATABASE_URL ?? '(DATABASE_URL unset)'}`)
  let sqlite: Database
  try {
    sqlite = openSqlite(LEGACY_URL)
  } catch (err) {
    console.error(`[migrate] cannot open legacy SQLite (${LEGACY_URL}):`, err)
    process.exit(1)
  }

  const sourceCounts: Record<string, number> = {}
  for (const m of MIGRATORS) {
    const rows = readAll(sqlite, m.legacyTable)
    sourceCounts[m.legacyTable] = rows.length
    const migrated = await m.migrate(rows)
    console.log(`  ✓ ${m.legacyTable.padEnd(28)} ${migrated} rows`)
  }

  sqlite.close()

  // Parity report
  const target = await targetRowCounts()
  console.log('\n[migrate] row-count parity (SQLite → Postgres):')
  let allMatch = true
  for (const m of MIGRATORS) {
    const src = sourceCounts[m.legacyTable] ?? 0
    const dst = target[m.legacyTable] ?? 0
    const ok = src === dst
    if (!ok) allMatch = false
    const marker = ok ? '✓' : '✗'
    console.log(
      `  ${marker} ${m.legacyTable.padEnd(28)} ${String(src).padStart(4)} → ${String(dst).padStart(4)}`,
    )
  }

  if (!allMatch) {
    console.error('\n[migrate] PARITY MISMATCH — counts differ. Aborting.')
    process.exit(2)
  }
  console.log('\n[migrate] done.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('[migrate] failed:', err)
    await prisma.$disconnect()
    process.exit(1)
  })
