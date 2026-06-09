import { ActionIcon, Anchor, Button, Group, Menu, Stack, Text, Title } from '@mantine/core'
import {
  ArrowLeft,
  DotsThreeVertical,
  MapPin,
  PencilSimple,
  Trash,
  User,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { DirectionalIcon } from '@/shared/ui'
import { formatDate } from '@/shared/utils/format'
import type { Project } from '../domain/project.types'
import { ProjectStatusBadge } from './ProjectStatusBadge'

interface ProjectWorkspaceHeaderProps {
  project: Project
  onEdit: () => void
  onDelete: () => void
}

/**
 * The detail-page header: back link, project name + status, meta chips, and a
 * single "Edit" primary plus a kebab menu for destructive actions. Deliberately
 * flat — no card, no shadow — so the workspace scrolls as one composed surface.
 */
export function ProjectWorkspaceHeader({
  project,
  onEdit,
  onDelete,
}: ProjectWorkspaceHeaderProps) {
  const { t } = useTranslation(['projects'])

  return (
    <Stack gap="md" mb="xl">
      <Anchor component={Link} to="/projects" fz="sm" c="dimmed" underline="hover" w="fit-content">
        <Group gap={6} wrap="nowrap">
          <DirectionalIcon icon={ArrowLeft} size={14} />
          <span>{t('projects:workspace.back')}</span>
        </Group>
      </Anchor>

      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Stack gap="xs">
          <Group gap="sm" wrap="wrap" align="center">
            <Title order={1} fz="h2">
              {project.name}
            </Title>
            <ProjectStatusBadge status={project.status} />
          </Group>
          <Group gap="md" wrap="wrap">
            <Meta icon={User} label={project.clientName} />
            <Meta icon={MapPin} label={project.location} />
            <Text fz="sm" c="dimmed">
              · {t(`projects:types.${project.type}`)}
            </Text>
            <Text fz="sm" c="dimmed">
              · {t('projects:workspace.createdOn', { date: formatDate(project.createdAt) })}
            </Text>
          </Group>
        </Stack>

        <Group gap="xs" wrap="nowrap">
          <Button
            variant="default"
            leftSection={<PencilSimple size={16} />}
            onClick={onEdit}
          >
            {t('projects:editProject')}
          </Button>
          <Menu position="bottom-end" withinPortal width={200} shadow="sm">
            <Menu.Target>
              <ActionIcon size="lg" aria-label={t('projects:deleteProject')}>
                <DotsThreeVertical size={18} weight="bold" />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item color="danger" leftSection={<Trash size={16} />} onClick={onDelete}>
                {t('projects:deleteProject')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </Stack>
  )
}

function Meta({ icon: Icon, label }: { icon: typeof User; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Icon size={14} />
      <Text fz="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  )
}
