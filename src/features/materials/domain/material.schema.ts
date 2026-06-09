import { z } from 'zod'
import type { Translate } from '@/shared/types'
import { MATERIAL_CATEGORIES, MATERIAL_UNITS, type MaterialInput } from './material.types'

/**
 * Material form schema factory. Pure: depends only on `zod`. Coverage and
 * unit price must be strictly positive; waste percentage is clamped to a
 * sensible building envelope (0–100 %) so a fat finger cannot demand 6x as
 * much grout as the surface holds.
 */
export function createMaterialSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('materials:validation.nameRequired'))
      .max(80, t('materials:validation.nameMax')),
    category: z.enum(MATERIAL_CATEGORIES),
    unit: z.enum(MATERIAL_UNITS),
    unitPrice: z
      .number({ message: t('materials:validation.unitPricePositive') })
      .finite(t('materials:validation.unitPricePositive'))
      .gt(0, t('materials:validation.unitPricePositive')),
    coverage: z
      .number({ message: t('materials:validation.coveragePositive') })
      .finite(t('materials:validation.coveragePositive'))
      .gt(0, t('materials:validation.coveragePositive')),
    wastePct: z
      .number({ message: t('materials:validation.wasteRange') })
      .finite(t('materials:validation.wasteRange'))
      .min(0, t('materials:validation.wasteRange'))
      .max(100, t('materials:validation.wasteRange')),
    supplier: z.string(),
    notes: z.string(),
    imageUrl: z
      .string()
      .trim()
      .refine(
        (value) => value.length === 0 || /^https?:\/\//i.test(value),
        t('materials:validation.imageUrlInvalid'),
      ),
    active: z.boolean(),
  })
}

export type MaterialFormValues = MaterialInput
