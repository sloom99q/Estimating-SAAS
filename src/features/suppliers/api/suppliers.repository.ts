import { dbClient, type AuditedRow, type Repository } from '@/shared/db'
import type { Supplier, SupplierInput } from '../domain/supplier.types'

function nullableString(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Suppliers table descriptor. Org-scoped CRUD; the HTTP driver routes every
 * call through `/api/suppliers/*`. Normalization (trim, empty → null) is
 * mirrored client-side as a defensive measure even though the server is the
 * authority — keeps the localStorage fallback identical when offline.
 */
export const suppliersRepository: Repository<Supplier, SupplierInput> =
  dbClient.createRepository<Supplier, SupplierInput>({
    table: 'suppliers',
    idPrefix: 'sup',
    fromCreate: (_organizationId, input) => ({
      name: input.name.trim(),
      country: nullableString(input.country),
      contactName: nullableString(input.contactName),
      email: nullableString(input.email),
      phone: nullableString(input.phone),
      website: nullableString(input.website),
      paymentTerms: nullableString(input.paymentTerms),
      leadTimeDays: input.leadTimeDays,
      rating: input.rating,
      preferred: input.preferred,
      notes: nullableString(input.notes),
    }),
    fromUpdate: (input) => {
      const patch: Partial<Omit<Supplier, keyof AuditedRow>> = {}
      if (input.name !== undefined) patch.name = input.name.trim()
      if (input.country !== undefined) patch.country = nullableString(input.country)
      if (input.contactName !== undefined)
        patch.contactName = nullableString(input.contactName)
      if (input.email !== undefined) patch.email = nullableString(input.email)
      if (input.phone !== undefined) patch.phone = nullableString(input.phone)
      if (input.website !== undefined) patch.website = nullableString(input.website)
      if (input.paymentTerms !== undefined)
        patch.paymentTerms = nullableString(input.paymentTerms)
      if (input.leadTimeDays !== undefined) patch.leadTimeDays = input.leadTimeDays
      if (input.rating !== undefined) patch.rating = input.rating
      if (input.preferred !== undefined) patch.preferred = input.preferred
      if (input.notes !== undefined) patch.notes = nullableString(input.notes)
      return patch
    },
  })
