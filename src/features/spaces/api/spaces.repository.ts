import { dbClient, type AuditedRow, type Repository } from '@/shared/db'
import type {
  Space,
  SpaceInput,
  SpaceMaterialsInput,
} from '../domain/space.types'

/**
 * Spaces table descriptor. Two mutation shapes feed this repo:
 *
 *   - `SpaceInput` (dimensions): geometry-only update — used by the form.
 *   - `SpaceMaterialsInput` (assignments): material-only update — used by the
 *     assignments dialog.
 *
 * The repository accepts EITHER shape as the update body so the form path and
 * the assignments path don't have to overwrite each other's fields. New
 * spaces always start with all three material slots nulled.
 */

type SpaceUpdate = Partial<SpaceInput> | Partial<SpaceMaterialsInput>

export const spacesRepository: Repository<Space, SpaceInput & { projectId: string }, SpaceUpdate> =
  dbClient.createRepository<Space, SpaceInput & { projectId: string }, SpaceUpdate>({
    table: 'spaces',
    idPrefix: 'spc',
    fromCreate: (_organizationId, input) => ({
      projectId: input.projectId,
      name: input.name.trim(),
      length: input.length,
      width: input.width,
      height: input.height,
      floorMaterialId: null,
      wallMaterialId: null,
      ceilingMaterialId: null,
    }),
    fromUpdate: (input) => {
      const patch: Partial<Omit<Space, keyof AuditedRow>> = {}
      if ('name' in input && input.name !== undefined) patch.name = input.name.trim()
      if ('length' in input && input.length !== undefined) patch.length = input.length
      if ('width' in input && input.width !== undefined) patch.width = input.width
      if ('height' in input && input.height !== undefined) patch.height = input.height
      if ('floorMaterialId' in input) patch.floorMaterialId = input.floorMaterialId ?? null
      if ('wallMaterialId' in input) patch.wallMaterialId = input.wallMaterialId ?? null
      if ('ceilingMaterialId' in input) patch.ceilingMaterialId = input.ceilingMaterialId ?? null
      return patch
    },
    // Pre-Phase-3 rows did not have material assignment fields; pre-Phase-5
    // rows did not have `deletedAt`. Both get backfilled defensively.
    normaliseOnRead: (row) => ({
      ...row,
      floorMaterialId: row.floorMaterialId ?? null,
      wallMaterialId: row.wallMaterialId ?? null,
      ceilingMaterialId: row.ceilingMaterialId ?? null,
      deletedAt: row.deletedAt ?? null,
    }),
  })

/**
 * Cascading soft-delete used when a project is removed. Lives in the
 * repository (not the service) because it's a pure data-layer concern.
 */
export function softDeleteSpacesForProject(organizationId: string, projectId: string): number {
  return dbClient.softDeleteWhere<Space>(
    'spaces',
    (row) => row.organizationId === organizationId && row.projectId === projectId,
  )
}
