import { Card, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { LoginForm } from '../components/LoginForm'

export function LoginPage() {
  const { t } = useTranslation(['auth'])
  return (
    <Card w={420} maw="100%" padding="xl" radius="md" withBorder>
      <Stack gap={4} mb="lg">
        <Title order={1} fz="h2">
          {t('auth:title')}
        </Title>
        <Text c="dimmed" fz="sm">
          {t('auth:subtitle')}
        </Text>
      </Stack>

      <LoginForm />

      <Text c="dimmed" fz="xs" ta="center" mt="lg">
        {t('auth:hint')}
      </Text>
    </Card>
  )
}
