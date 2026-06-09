import type { ID } from '@/shared/types'
import type { Space, SpaceInput, SpaceMaterialsInput } from '../domain/space.types'
import { softDeleteSpacesForProject, spacesRepository } from './spaces.repository'

/**
 * Thin transport facade for the spaces feature. CRUD + normalization live in
 * `spaces.repository`. The hooks call into this module; everything is async
 * so the real network swap is a no-op at the call site.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function listSpaces(organizationId: ID, projectId: ID): Promise<Space[]> {
  await delay(150)
  return spacesRepository.list(organizationId, {
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createSpace(
  organizationId: ID,
  projectId: ID,
  input: SpaceInput,
): Promise<Space> {
  await delay(180)
  return spacesRepository.create(organizationId, { ...input, projectId })
}

export async function updateSpace(
  organizationId: ID,
  spaceId: ID,
  input: SpaceInput,
): Promise<Space> {
  await delay(180)
  return spacesRepository.update(organizationId, spaceId, input)
}

export async function updateSpaceMaterials(
  organizationId: ID,
  spaceId: ID,
  input: SpaceMaterialsInput,
): Promise<Space> {
  await delay(140)
  return spacesRepository.update(organizationId, spaceId, input)
}

export async function deleteSpace(organizationId: ID, spaceId: ID): Promise<void> {
  await delay(150)
  await spacesRepository.softDelete(organizationId, spaceId)
}

/**
 * Cascading soft-delete used when a project is removed. Delegates to the
 * repository helper so the loop lives in the data layer, not in the UI.
 */
export async function deleteSpacesForProject(
  organizationId: ID,
  projectId: ID,
): Promise<void> {
  await delay(80)
  softDeleteSpacesForProject(organizationId, projectId)
}
