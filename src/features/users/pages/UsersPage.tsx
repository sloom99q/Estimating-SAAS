import { Stack } from '@mantine/core'
import { Users } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { DataCard, PageHeader } from '@/shared/ui'
import { useUsers } from '../api/useUsers'
import { UsersTable } from '../components/UsersTable'

export function UsersPage() {
  const { t } = useTranslation(['users'])
  const { data, isLoading, isError } = useUsers()

  return (
    <Stack gap="xl">
      <PageHeader title={t('users:title')} description={t('users:description')} />

      <DataCard
        isLoading={isLoading}
        isError={isError}
        isEmpty={!data || data.length === 0}
        errorTitle={t('users:error')}
        emptyIcon={Users}
        emptyTitle={t('users:empty.title')}
        emptyDescription={t('users:empty.description')}
      >
        {data ? <UsersTable users={data} /> : null}
      </DataCard>
    </Stack>
  )
}
