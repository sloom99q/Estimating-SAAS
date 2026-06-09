import { dbClient, type AuditedRow } from '@/shared/db'
import type { ID } from '@/shared/types'
import { materialsSeedRows } from '@/features/materials/api/materials.seed'
import { projectsSeedRows } from '@/features/projects/api/projects.seed'

/**
 * Composes every feature's seed data and writes it into the persistence
 * driver IF that table is currently empty for the org. Idempotent — safe to
 * call on every app boot. Lives in `app/db/` (composition layer) because it
 * imports from multiple features.
 *
 * The contract is intentionally generic — the same code path works whether
 * the underlying driver is localStorage today or Postgres tomorrow.
 */
interface SeedSpec {
  table: string
  rows: AuditedRow[]
}

function isEmptyFor(spec: SeedSpec, organizationId: ID): boolean {
  const existing = dbClient.listAllRaw(spec.table) as AuditedRow[]
  return !existing.some((row) => row.organizationId === organizationId)
}

export function runSeedIfEmpty(organizationId: ID): void {
  const specs: SeedSpec[] = [
    { table: 'projects', rows: projectsSeedRows(organizationId) },
    { table: 'materials', rows: materialsSeedRows(organizationId) },
    // Spaces are user-created; nothing to seed.
  ]

  for (const spec of specs) {
    if (!isEmptyFor(spec, organizationId)) continue
    const existing = dbClient.listAllRaw(spec.table) as AuditedRow[]
    dbClient.seedTable(spec.table, [...existing, ...spec.rows])
  }
}
