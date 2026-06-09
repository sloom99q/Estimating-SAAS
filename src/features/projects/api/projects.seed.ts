import { dbClient } from '@/shared/db'
import type { ID } from '@/shared/types'
import type { Project } from '../domain/project.types'

/**
 * Demo project list. One reference project so a fresh org has something to
 * click into; future phases (calendar / invoicing) can extend this.
 */
export function projectsSeedRows(organizationId: ID): Project[] {
  const now = new Date('2026-06-01T09:00:00.000Z').toISOString()
  return [
    {
      id: dbClient.generateId('prj'),
      organizationId,
      name: 'Marina Heights Penthouse',
      clientName: 'Hadid Family Office',
      location: 'Dubai Marina, UAE',
      type: 'luxury',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ]
}
