import { useForm, type UseFormInput, type UseFormReturnType } from '@mantine/form'
import type { ZodType } from 'zod'

/**
 * Adapts a pure zod schema (defined in a feature's `domain/`) into a Mantine
 * form. The resolver wiring lives here in `shared` — never in `domain`, which
 * must stay framework-free. zod error messages are returned verbatim, so a
 * schema can emit i18n keys and the form can translate them at render time.
 */
function zodValidate<T extends Record<string, unknown>>(schema: ZodType<T>) {
  return (values: T): Partial<Record<keyof T, string>> => {
    const result = schema.safeParse(values)
    if (result.success) return {}

    const errors: Partial<Record<keyof T, string>> = {}
    for (const issue of result.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !(key in errors)) {
        errors[key as keyof T] = issue.message
      }
    }
    return errors
  }
}

export function useZodForm<T extends Record<string, unknown>>(
  schema: ZodType<T>,
  input: Omit<UseFormInput<T>, 'validate'>,
): UseFormReturnType<T> {
  return useForm<T>({ ...input, validate: zodValidate(schema) })
}
