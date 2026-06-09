import { ActionIcon, Group, Menu, Table, Text } from '@mantine/core'
import { DotsThreeVertical, PencilSimple, Trash } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../domain/project.types'
import { ProjectStatusBadge } from './ProjectStatusBadge'

interface ProjectsTableProps {
  projects: Project[]
  onOpen: (project: Project) => void
  onEdit: (project: Project) => void
  onDelete: (project: Project) => void
}

export function ProjectsTable({ projects, onOpen, onEdit, onDelete }: ProjectsTableProps) {
  const { t } = useTranslation(['projects'])

  return (
    <Table.ScrollContainer minWidth={760}>
      <Table verticalSpacing="md" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('projects:columns.name')}</Table.Th>
            <Table.Th>{t('projects:columns.client')}</Table.Th>
            <Table.Th>{t('projects:columns.location')}</Table.Th>
            <Table.Th>{t('projects:columns.type')}</Table.Th>
            <Table.Th>{t('projects:columns.status')}</Table.Th>
            <Table.Th w={48} aria-label="" />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {projects.map((project) => (
            <Table.Tr
              key={project.id}
              onClick={() => onOpen(project)}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td>
                <Text fz="sm" fw={500}>
                  {project.name}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text fz="sm">{project.clientName}</Text>
              </Table.Td>
              <Table.Td>
                <Text fz="sm" c="dimmed">
                  {project.location}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text fz="sm" c="dimmed">
                  {t(`projects:types.${project.type}`)}
                </Text>
              </Table.Td>
              <Table.Td>
                <ProjectStatusBadge status={project.status} />
              </Table.Td>
              <Table.Td onClick={(event) => event.stopPropagation()}>
                <Group justify="flex-end" gap={0}>
                  <Menu position="bottom-end" withinPortal shadow="sm" width={180}>
                    <Menu.Target>
                      <ActionIcon aria-label={t('projects:editProject')}>
                        <DotsThreeVertical size={18} weight="bold" />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<PencilSimple size={16} />}
                        onClick={() => onEdit(project)}
                      >
                        {t('projects:editProject')}
                      </Menu.Item>
                      <Menu.Item
                        color="danger"
                        leftSection={<Trash size={16} />}
                        onClick={() => onDelete(project)}
                      >
                        {t('projects:deleteProject')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
