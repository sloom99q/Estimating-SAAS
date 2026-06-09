import { z } from 'zod'
import type { Translate } from '@/shared/types'

/**
 * Login validation. A factory that takes a translator so messages are i18n keys
 * resolved at call time. Pure: depends only on `zod` (framework-agnostic) — no
 * React, no Mantine, no resolver wiring (that lives in shared/useZodForm).
 */
export function createLoginSchema(t: Translate) {
  return z.object({
    email: z.email(t('auth:validation.emailInvalid')),
    password: z.string().min(6, t('auth:validation.passwordMin')),
  })
}

// A type alias (not an interface) so it satisfies `Record<string, unknown>`,
// which Mantine's useForm / our useZodForm generic requires.
export type LoginFormValues = {
  email: string
  password: string
}
