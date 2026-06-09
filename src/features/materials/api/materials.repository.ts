import { DEFAULT_CURRENCY } from '@/shared/config/constants'
import { dbClient, type AuditedRow, type Repository } from '@/shared/db'
import type { Material, MaterialInput } from '../domain/material.types'

function nullableString(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Materials table descriptor. The body builder enforces the
 * currency-comes-from-config rule (`DEFAULT_CURRENCY`) so the UI cannot
 * accidentally bake a different currency into a row, and collapses empty
 * strings into nulls to match the persisted shape.
 */
export const materialsRepository: Repository<Material, MaterialInput> =
  dbClient.createRepository<Material, MaterialInput>({
    table: 'materials',
    idPrefix: 'mat',
    fromCreate: (_organizationId, input) => ({
      name: input.name.trim(),
      category: input.category,
      unit: input.unit,
      unitPrice: input.unitPrice,
      coverage: input.coverage,
      wastePct: input.wastePct,
      currency: DEFAULT_CURRENCY,
      supplier: nullableString(input.supplier),
      notes: nullableString(input.notes),
      imageUrl: nullableString(input.imageUrl),
      active: input.active,
    }),
    fromUpdate: (input) => {
      const patch: Partial<Omit<Material, keyof AuditedRow>> = {}
      if (input.name !== undefined) patch.name = input.name.trim()
      if (input.category !== undefined) patch.category = input.category
      if (input.unit !== undefined) patch.unit = input.unit
      if (input.unitPrice !== undefined) patch.unitPrice = input.unitPrice
      if (input.coverage !== undefined) patch.coverage = input.coverage
      if (input.wastePct !== undefined) patch.wastePct = input.wastePct
      if (input.supplier !== undefined) patch.supplier = nullableString(input.supplier)
      if (input.notes !== undefined) patch.notes = nullableString(input.notes)
      if (input.imageUrl !== undefined) patch.imageUrl = nullableString(input.imageUrl)
      if (input.active !== undefined) patch.active = input.active
      return patch
    },
    // Backfill pre-Phase-4 (no imageUrl) and pre-Phase-5 (no deletedAt) rows.
    normaliseOnRead: (row) => ({
      ...row,
      imageUrl: row.imageUrl ?? null,
      deletedAt: row.deletedAt ?? null,
    }),
  })
