import { z } from 'zod'
import type { Translate } from '@/shared/types'
import type { SupplierInput } from './supplier.types'

/**
 * Supplier form schema. Pure: only `zod` + `@/shared/types`. Mantine's
 * useForm + the shared `useZodForm` resolver consume this — see the
 * SupplierFormModal.
 */
export function createSupplierSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('suppliers:validation.nameRequired'))
      .max(120, t('suppliers:validation.nameMax')),
    country: z.string(),
    contactName: z.string(),
    email: z
      .string()
      .trim()
      .refine(
        (v) => v.length === 0 || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
        t('suppliers:validation.emailInvalid'),
      ),
    phone: z.string(),
    website: z
      .string()
      .trim()
      .refine(
        (v) => v.length === 0 || /^https?:\/\//i.test(v),
        t('suppliers:validation.websiteInvalid'),
      ),
    paymentTerms: z.string(),
    leadTimeDays: z
      .number({ message: t('suppliers:validation.leadTimeRange') })
      .int()
      .min(0, t('suppliers:validation.leadTimeRange'))
      .nullable(),
    rating: z
      .number({ message: t('suppliers:validation.ratingRange') })
      .min(0, t('suppliers:validation.ratingRange'))
      .max(5, t('suppliers:validation.ratingRange'))
      .nullable(),
    preferred: z.boolean(),
    notes: z.string(),
  })
}

export type SupplierFormValues = SupplierInput
