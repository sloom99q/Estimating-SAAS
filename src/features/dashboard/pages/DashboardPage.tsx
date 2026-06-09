import { Button, Card, Grid, Stack, Text, Title } from '@mantine/core'
import { FolderOpen } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { PageHeader } from '@/shared/ui'
import { useDashboardStats } from '../api/useDashboardStats'
import { StatsGrid } from '../components/StatsGrid'

// Hardcoded so the dashboard feature does not import the app/ composition layer
// (the eslint architecture rule forbids `features → app`). The single source of
// truth for the URL still lives in `app/router/paths.ts`.
const PROJECTS_HREF = '/projects'

export function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'common'])
  const user = useCurrentUser()
  const { data, isLoading } = useDashboardStats()

  return (
    <Stack gap="xl">
      <PageHeader
        title={t('dashboard:greeting', { name: user?.fullName ?? '' })}
        description={t('dashboard:subtitle')}
        actions={
          <Button
            component={Link}
            to={PROJECTS_HREF}
            variant="default"
            leftSection={<FolderOpen size={16} />}
          >
            {t('common:nav.projects')}
          </Button>
        }
      />

      <StatsGrid stats={data} loading={isLoading} />

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card mih={280}>
            <Title order={2} fz="h4" mb="xs">
              {t('dashboard:sections.pipeline')}
            </Title>
            <Text c="dimmed" fz="sm">
              {t('dashboard:placeholder')}
            </Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Card mih={280}>
            <Title order={2} fz="h4" mb="xs">
              {t('dashboard:sections.activity')}
            </Title>
            <Text c="dimmed" fz="sm">
              {t('dashboard:placeholder')}
            </Text>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
