import { Button, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { FolderOpen, Plus } from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { DataCard, PageHeader } from '@/shared/ui'
import { useCreateProject } from '../api/useCreateProject'
import { useDeleteProject } from '../api/useDeleteProject'
import { useProjects } from '../api/useProjects'
import { useUpdateProject } from '../api/useUpdateProject'
import { ProjectFormModal } from '../components/ProjectFormModal'
import { ProjectsTable } from '../components/ProjectsTable'
import type { Project } from '../domain/project.types'

export function ProjectListPage() {
  const { t } = useTranslation(['projects', 'common'])
  const navigate = useNavigate()
  const { data: projects, isLoading, isError } = useProjects()
  const createMutation = useCreateProject()
  const updateMutation = useUpdateProject()
  const deleteMutation = useDeleteProject()

  const [modalOpened, modal] = useDisclosure(false)
  const [editing, setEditing] = useState<Project | undefined>(undefined)

  const openCreate = () => {
    setEditing(undefined)
    modal.open()
  }
  const openEdit = (project: Project) => {
    setEditing(project)
    modal.open()
  }

  const handleSubmit = async (values: Parameters<typeof createMutation.mutate>[0]) => {
    if (editing) {
      await updateMutation.mutateAsync({ projectId: editing.id, input: values })
    } else {
      await createMutation.mutateAsync(values)
    }
    modal.close()
  }

  const handleDelete = (project: Project) => {
    modals.openConfirmModal({
      title: t('projects:delete.title'),
      children: (
        <Text fz="sm" c="dimmed">
          {t('projects:delete.body', { name: project.name })}
        </Text>
      ),
      labels: {
        confirm: t('projects:delete.confirm'),
        cancel: t('projects:actions.cancel'),
      },
      confirmProps: { color: 'danger' },
      centered: true,
      onConfirm: () => {
        deleteMutation.mutate(project.id, {
          onError: () => {
            notifications.show({ color: 'red', message: t('projects:error') })
          },
        })
      },
    })
  }

  const errorMessage =
    createMutation.error?.message ?? updateMutation.error?.message ?? undefined

  const emptyAction = (
    <Button
      mt="sm"
      leftSection={<Plus size={16} weight="bold" />}
      onClick={openCreate}
    >
      {t('projects:empty.cta')}
    </Button>
  )

  return (
    <Stack gap="xl">
      <PageHeader
        title={t('projects:title')}
        description={t('projects:description')}
        actions={
          <Button leftSection={<Plus size={16} weight="bold" />} onClick={openCreate}>
            {t('projects:newProject')}
          </Button>
        }
      />

      <DataCard
        isLoading={isLoading}
        isError={isError}
        isEmpty={!projects || projects.length === 0}
        errorTitle={t('projects:error')}
        emptyIcon={FolderOpen}
        emptyTitle={t('projects:empty.title')}
        emptyDescription={t('projects:empty.description')}
        emptyAction={emptyAction}
      >
        {projects ? (
          <ProjectsTable
            projects={projects}
            onOpen={(project) => {
              void navigate(`/projects/${project.id}`)
            }}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        ) : null}
      </DataCard>

      <ProjectFormModal
        opened={modalOpened}
        onClose={modal.close}
        project={editing}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        errorMessage={errorMessage}
      />
    </Stack>
  )
}
