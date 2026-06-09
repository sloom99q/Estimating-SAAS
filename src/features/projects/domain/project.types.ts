import type { AuditedRow } from '@/shared/db'

/**
 * A subset of the Phase 1 Prisma `ProjectStatus` enum that Phase 2 actually
 * exposes through the UI. The wider enum (e.g. `on_hold`) is kept so the type
 * lines up with the reference schema when the real backend lands.
 */
export const PROJECT_STATUSES = ['lead', 'active', 'on_hold', 'completed', 'cancelled'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Project type classifies the work — drives default rates and reporting later. */
export const PROJECT_TYPES = ['residential', 'commercial', 'luxury'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

/**
 * Persisted project row. `AuditedRow` brings in
 * `id / organizationId / createdAt / updatedAt / deletedAt`, so the audit
 * contract lives in one place — see `@/shared/db`.
 */
export interface Project extends AuditedRow {
  name: string
  clientName: string
  location: string
  type: ProjectType
  status: ProjectStatus
}

/**
 * Payload accepted by both create and update — the form values shape.
 * Declared as a type alias (not interface) so it satisfies the
 * `Record<string, unknown>` constraint Mantine's useForm requires.
 */
export type ProjectInput = {
  name: string
  clientName: string
  location: string
  type: ProjectType
  status: ProjectStatus
}
