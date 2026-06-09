import { z } from 'zod'
import type { Translate } from '@/shared/types'
import { PROJECT_STATUSES, PROJECT_TYPES, type ProjectInput } from './project.types'

/**
 * Project form schema factory. Pure: depends only on `zod` so it stays in
 * `domain/`. The translator turns messages into i18n keys, resolved at render
 * time (see useZodForm).
 */
export function createProjectSchema(t: Translate) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('projects:validation.nameRequired'))
      .max(80, t('projects:validation.nameMax')),
    clientName: z.string().trim().min(1, t('projects:validation.clientRequired')),
    location: z.string().trim().min(1, t('projects:validation.locationRequired')),
    type: z.enum(PROJECT_TYPES),
    status: z.enum(PROJECT_STATUSES),
  })
}

// Type alias (not interface) so it satisfies `Record<string, unknown>` — Mantine
// useForm / useZodForm require an index-signature-compatible shape.
export type ProjectFormValues = ProjectInput
