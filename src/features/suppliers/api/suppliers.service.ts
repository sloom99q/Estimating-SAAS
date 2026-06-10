import type { ID } from '@/shared/types'
import type { Supplier, SupplierInput } from '../domain/supplier.types'
import { suppliersRepository } from './suppliers.repository'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function listSuppliers(organizationId: ID): Promise<Supplier[]> {
  await delay(150)
  return suppliersRepository.list(organizationId)
}

export async function getSupplier(organizationId: ID, supplierId: ID): Promise<Supplier> {
  await delay(80)
  const row = await suppliersRepository.findById(organizationId, supplierId)
  if (!row) throw new Error('suppliers:error')
  return row
}

export async function createSupplier(
  organizationId: ID,
  input: SupplierInput,
): Promise<Supplier> {
  await delay(180)
  return suppliersRepository.create(organizationId, input)
}

export async function updateSupplier(
  organizationId: ID,
  supplierId: ID,
  input: SupplierInput,
): Promise<Supplier> {
  await delay(180)
  return suppliersRepository.update(organizationId, supplierId, input)
}

export async function deleteSupplier(organizationId: ID, supplierId: ID): Promise<void> {
  await delay(150)
  await suppliersRepository.softDelete(organizationId, supplierId)
}
