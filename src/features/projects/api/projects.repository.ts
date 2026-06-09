import { dbClient, type AuditedRow, type Repository } from '@/shared/db'
import type { Project, ProjectInput } from '../domain/project.types'

/**
 * Projects table descriptor. The body builder trims free-text fields so the
 * data layer never persists a name that's secretly five spaces long.
 */
export const projectsRepository: Repository<Project, ProjectInput> = dbClient.createRepository<
  Project,
  ProjectInput
>({
  table: 'projects',
  idPrefix: 'prj',
  fromCreate: (_organizationId, input) => ({
    name: input.name.trim(),
    clientName: input.clientName.trim(),
    location: input.location.trim(),
    type: input.type,
    status: input.status,
  }),
  fromUpdate: (input) => {
    const patch: Partial<Omit<Project, keyof AuditedRow>> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.clientName !== undefined) patch.clientName = input.clientName.trim()
    if (input.location !== undefined) patch.location = input.location.trim()
    if (input.type !== undefined) patch.type = input.type
    if (input.status !== undefined) patch.status = input.status
    return patch
  },
})
