import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  TextInput,
} from '@mantine/core'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useZodForm } from '@/shared/hooks/useZodForm'
import {
  createProjectSchema,
  type ProjectFormValues,
} from '../domain/project.schema'
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type Project,
  type ProjectStatus,
  type ProjectType,
} from '../domain/project.types'

interface ProjectFormModalProps {
  opened: boolean
  onClose: () => void
  /** When set, the form edits this project; otherwise it creates a new one. */
  project?: Project | undefined
  onSubmit: (values: ProjectFormValues) => void | Promise<void>
  isSubmitting: boolean
  errorMessage?: string | undefined
}

const DEFAULT_VALUES: ProjectFormValues = {
  name: '',
  clientName: '',
  location: '',
  type: 'residential',
  status: 'lead',
}

export function ProjectFormModal({
  opened,
  onClose,
  project,
  onSubmit,
  isSubmitting,
  errorMessage,
}: ProjectFormModalProps) {
  const { t } = useTranslation(['projects', 'common'])
  const editing = Boolean(project)

  const schema = useMemo(
    () => createProjectSchema((key, options) => String(t(key, options ?? {}))),
    [t],
  )

  const form = useZodForm<ProjectFormValues>(schema, {
    initialValues: project
      ? {
          name: project.name,
          clientName: project.clientName,
          location: project.location,
          type: project.type,
          status: project.status,
        }
      : DEFAULT_VALUES,
  })

  // Reset whenever the modal opens with a different target so old values from a
  // previous edit can never leak into a fresh "create" pass (and vice versa).
  useEffect(() => {
    if (!opened) return
    form.setValues(
      project
        ? {
            name: project.name,
            clientName: project.clientName,
            location: project.location,
            type: project.type,
            status: project.status,
          }
        : DEFAULT_VALUES,
    )
    form.resetDirty()
    form.clearErrors()
    // form is stable per Mantine; only re-run when the target identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, project])

  const handleSubmit = form.onSubmit(async (values) => {
    await onSubmit(values)
  })

  const typeOptions = PROJECT_TYPES.map((value) => ({
    value,
    label: t(`projects:types.${value}`),
  }))
  const statusOptions = PROJECT_STATUSES.map((value) => ({
    value,
    label: t(`projects:status.${value}`),
  }))

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t('projects:editProject') : t('projects:newProject')}
      centered
      size="md"
      radius="md"
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {errorMessage ? (
            <Alert color="danger" variant="light" radius="md">
              {errorMessage}
            </Alert>
          ) : null}

          <TextInput
            label={t('projects:fields.name')}
            placeholder={t('projects:placeholders.name')}
            withAsterisk
            data-autofocus
            {...form.getInputProps('name')}
          />

          <Group grow align="flex-start">
            <TextInput
              label={t('projects:fields.clientName')}
              placeholder={t('projects:placeholders.clientName')}
              withAsterisk
              {...form.getInputProps('clientName')}
            />
            <TextInput
              label={t('projects:fields.location')}
              placeholder={t('projects:placeholders.location')}
              withAsterisk
              {...form.getInputProps('location')}
            />
          </Group>

          <Group grow align="flex-start">
            <Select
              label={t('projects:fields.type')}
              data={typeOptions}
              allowDeselect={false}
              checkIconPosition="right"
              withAsterisk
              value={form.values.type}
              onChange={(value) => form.setFieldValue('type', (value ?? 'residential') as ProjectType)}
              error={form.errors.type as string | undefined}
            />
            <Select
              label={t('projects:fields.status')}
              data={statusOptions}
              allowDeselect={false}
              checkIconPosition="right"
              withAsterisk
              value={form.values.status}
              onChange={(value) => form.setFieldValue('status', (value ?? 'lead') as ProjectStatus)}
              error={form.errors.status as string | undefined}
            />
          </Group>

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose} disabled={isSubmitting}>
              {t('projects:actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? t('projects:actions.save') : t('projects:actions.create')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
