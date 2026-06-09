import type { ID } from '@/shared/types'
import type { Material, MaterialInput } from '../domain/material.types'
import { materialsRepository } from './materials.repository'

/**
 * Thin transport facade for materials. The repository owns CRUD +
 * normalization (`currency` from DEFAULT_CURRENCY, supplier/notes/imageUrl
 * empty-string → null coercion). This module is where the hooks reach in.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function listMaterials(organizationId: ID): Promise<Material[]> {
  await delay(150)
  return materialsRepository.list(organizationId, {
    orderBy: { name: 'asc' },
  })
}

export async function getMaterial(organizationId: ID, materialId: ID): Promise<Material> {
  await delay(80)
  const material = await materialsRepository.findById(organizationId, materialId)
  if (!material) throw new Error('materials:error')
  return material
}

export async function createMaterial(
  organizationId: ID,
  input: MaterialInput,
): Promise<Material> {
  await delay(180)
  return materialsRepository.create(organizationId, input)
}

export async function updateMaterial(
  organizationId: ID,
  materialId: ID,
  input: MaterialInput,
): Promise<Material> {
  await delay(180)
  return materialsRepository.update(organizationId, materialId, input)
}

export async function deleteMaterial(organizationId: ID, materialId: ID): Promise<void> {
  await delay(150)
  await materialsRepository.softDelete(organizationId, materialId)
}
