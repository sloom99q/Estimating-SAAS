import { Button, Center, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { paths } from './paths'

/** 404 fallback. Lives in app/ (a routing concern) so it can use `paths`. */
export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <Center mih="100dvh" p="md">
      <Stack align="center" gap="sm">
        <Text className="app-numeric" fz={64} fw={700} c="dimmed" lh={1}>
          404
        </Text>
        <Title order={1} fz="h3" ta="center">
          {t('notFound.title')}
        </Title>
        <Text c="dimmed" ta="center" maw={360}>
          {t('notFound.description')}
        </Text>
        <Button component={Link} to={paths.dashboard} mt="sm">
          {t('notFound.back')}
        </Button>
      </Stack>
    </Center>
  )
}
