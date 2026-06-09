import { Card, Center, Loader } from '@mantine/core'
import { Warning } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import { EmptyState } from '../EmptyState/EmptyState'

/**
 * Standard container for a piece of asynchronous data — a list, a table, a
 * BOQ. Encodes the loading / error / empty / loaded states so every page
 * surface them the same way and the body code never sprawls into a 4-branch
 * conditional. The card's padding, borders and corner radius come from the
 * theme `Card` defaults — `padding={0}` here because the inner table or
 * gallery is responsible for its own breathing room.
 *
 * Usage pattern:
 *   <DataCard isLoading={isLoading} isError={isError} isEmpty={!data?.length}
 *             emptyTitle={t('users:empty.title')} emptyIcon={Users}>
 *     <UsersTable users={data!} />
 *   </DataCard>
 */
interface DataCardProps {
  isLoading?: boolean | undefined
  isError?: boolean | undefined
  isEmpty?: boolean | undefined
  errorTitle?: string | undefined
  emptyTitle?: string | undefined
  emptyDescription?: string | undefined
  emptyIcon?: ComponentType<IconProps> | undefined
  emptyAction?: ReactNode | undefined
  /** Loaded children — rendered only when not loading / error / empty. */
  children: ReactNode
  /** Padding override; defaults to 0 (the inner table/gallery owns padding). */
  padding?: 0 | number | string
}

export function DataCard({
  isLoading,
  isError,
  isEmpty,
  errorTitle,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  children,
  padding = 0,
}: DataCardProps) {
  const { t } = useTranslation(['common'])

  return (
    <Card padding={padding}>
      {isLoading ? (
        <Center py={64}>
          <Loader />
        </Center>
      ) : isError ? (
        <EmptyState
          icon={Warning}
          title={errorTitle ?? t('common:errors.generic')}
        />
      ) : isEmpty ? (
        <EmptyState
          icon={emptyIcon ?? Warning}
          title={emptyTitle ?? ''}
          {...(emptyDescription ? { description: emptyDescription } : {})}
          {...(emptyAction ? { action: emptyAction } : {})}
        />
      ) : (
        children
      )}
    </Card>
  )
}
