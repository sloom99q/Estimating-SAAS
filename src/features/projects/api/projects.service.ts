import type { ID } from '@/shared/types'
import type { Project, ProjectInput } from '../domain/project.types'
import { projectsRepository } from './projects.repository'

/**
 * Thin transport facade. The repository owns the CRUD + normalization; this
 * file simulates a small async delay (so the demo feels real against the
 * localStorage driver) and is the single import surface the hooks call. When
 * the real backend lands the delays become network round-trips, but the call
 * sites — and the entire signature — stay the same.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function listProjects(organizationId: ID): Promise<Project[]> {
  await delay(180)
  // Newest first — the most-likely-relevant project should sit at the top.
  return projectsRepository.list(organizationId, {
    orderBy: { createdAt: 'desc' },
  })
}

export async function getProject(organizationId: ID, projectId: ID): Promise<Project> {
  await delay(120)
  const project = await projectsRepository.findById(organizationId, projectId)
  if (!project) throw new Error('projects:error')
  return project
}

export async function createProject(
  organizationId: ID,
  input: ProjectInput,
): Promise<Project> {
  await delay(200)
  return projectsRepository.create(organizationId, input)
}

export async function updateProject(
  organizationId: ID,
  projectId: ID,
  input: ProjectInput,
): Promise<Project> {
  await delay(200)
  return projectsRepository.update(organizationId, projectId, input)
}

export async function deleteProject(organizationId: ID, projectId: ID): Promise<void> {
  await delay(180)
  await projectsRepository.softDelete(organizationId, projectId)
}
