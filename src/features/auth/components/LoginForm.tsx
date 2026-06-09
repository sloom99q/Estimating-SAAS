import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useZodForm } from '@/shared/hooks/useZodForm'
import { useLogin } from '../api/useLogin'
import { createLoginSchema, type LoginFormValues } from '../domain/auth.schema'

export function LoginForm() {
  const { t } = useTranslation(['auth', 'common'])
  const login = useLogin()

  // Recreate the schema when the language changes so messages stay translated.
  const schema = useMemo(
    () => createLoginSchema((key, options) => String(t(key, options ?? {}))),
    [t],
  )

  const form = useZodForm<LoginFormValues>(schema, {
    initialValues: { email: '', password: '' },
  })

  const handleSubmit = form.onSubmit((values) => {
    login.mutate(values)
  })

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        {login.error ? (
          <Alert color="danger" variant="light" radius="md">
            {t(login.error.message)}
          </Alert>
        ) : null}

        <TextInput
          label={t('auth:fields.email')}
          placeholder="you@company.com"
          autoComplete="email"
          withAsterisk
          {...form.getInputProps('email')}
        />

        <PasswordInput
          label={t('auth:fields.password')}
          placeholder="••••••••"
          autoComplete="current-password"
          withAsterisk
          {...form.getInputProps('password')}
        />

        <Button type="submit" fullWidth mt="xs" loading={login.isPending}>
          {t('auth:submit')}
        </Button>
      </Stack>
    </form>
  )
}
