import { Avatar, Badge, Group, Table, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/shared/utils/format'
import type { OrgUser, UserStatus } from '../domain/user.types'

const STATUS_COLOR: Record<UserStatus, string> = {
  active: 'success',
  invited: 'info',
  disabled: 'gray',
}

export function UsersTable({ users }: { users: OrgUser[] }) {
  const { t } = useTranslation(['users', 'common'])

  return (
    <Table.ScrollContainer minWidth={680}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('users:columns.name')}</Table.Th>
            <Table.Th>{t('users:columns.role')}</Table.Th>
            <Table.Th>{t('users:columns.status')}</Table.Th>
            <Table.Th>{t('users:columns.lastActive')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((user) => (
            <Table.Tr key={user.id}>
              <Table.Td>
                <Group gap="sm" wrap="nowrap">
                  <Avatar src={user.avatarUrl} name={user.fullName} color="ink" radius="xl" size={34} />
                  <div>
                    <Text fz="sm" fw={500}>
                      {user.fullName}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {user.email}
                    </Text>
                  </div>
                </Group>
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color="gray">
                  {t(`common:roles.${user.role}`)}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLOR[user.status]}>{t(`users:status.${user.status}`)}</Badge>
              </Table.Td>
              <Table.Td>
                {user.lastActiveAt ? (
                  <Text className="app-numeric" fz="sm">
                    {formatDate(user.lastActiveAt)}
                  </Text>
                ) : (
                  <Text fz="sm" c="dimmed">
                    {t('users:never')}
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
