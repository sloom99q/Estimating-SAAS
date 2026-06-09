import { Badge } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { ProjectStatus } from '../domain/project.types'

const STATUS_COLOR: Record<ProjectStatus, string> = {
  lead: 'info',
  active: 'success',
  on_hold: 'warn',
  completed: 'gray',
  cancelled: 'danger',
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation(['projects'])
  return <Badge color={STATUS_COLOR[status]}>{t(`projects:status.${status}`)}</Badge>
}
