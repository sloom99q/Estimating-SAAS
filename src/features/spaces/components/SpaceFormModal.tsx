import { Alert, Button, Divider, Group, Modal, NumberInput, Stack, TextInput } from '@mantine/core'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useZodForm } from '@/shared/hooks/useZodForm'
import { SpacePlan2D } from '@/shared/ui'
import { createSpaceSchema, type SpaceFormValues } from '../domain/space.schema'
import type { Space } from '../domain/space.types'
import type { SpaceTemplate } from '../domain/templates'
import { CalcPreview } from './CalcPreview'
import { SpaceTemplatePicker } from './SpaceTemplatePicker'

interface SpaceFormModalProps {
  opened: boolean
  onClose: () => void
  /** When set, the form edits this space; otherwise it creates a new one. */
  space?: Space | undefined
  onSubmit: (values: SpaceFormValues) => void | Promise<void>
  isSubmitting: boolean
  errorMessage?: string | undefined
}

const DEFAULT_VALUES: SpaceFormValues = {
  name: '',
  length: 0,
  width: 0,
  height: 2.7,
}

export function SpaceFormModal({
  opened,
  onClose,
  space,
  onSubmit,
  isSubmitting,
  errorMessage,
}: SpaceFormModalProps) {
  const { t } = useTranslation(['spaces'])
  const editing = Boolean(space)

  const schema = useMemo(
    () => createSpaceSchema((key, options) => String(t(key, options ?? {}))),
    [t],
  )

  const form = useZodForm<SpaceFormValues>(schema, {
    initialValues: space
      ? { name: space.name, length: space.length, width: space.width, height: space.height }
      : DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!opened) return
    form.setValues(
      space
        ? { name: space.name, length: space.length, width: space.width, height: space.height }
        : DEFAULT_VALUES,
    )
    form.resetDirty()
    form.clearErrors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, space])

  const handleSubmit = form.onSubmit(async (values) => {
    await onSubmit(values)
  })

  const applyTemplate = (template: SpaceTemplate) => {
    form.setValues({
      // Keep the user's already-typed name if they had one; otherwise seed
      // from the template's localised name. Template subtitles ("Compact" /
      // "Luxury") are dropped — the dimensions speak for themselves.
      name: form.values.name.trim().length > 0
        ? form.values.name
        : t(`spaces:templates.${template.nameKey}`),
      length: template.dimensions.length,
      width: template.dimensions.width,
      height: template.dimensions.height,
    })
  }

  // Read current values for the live preview — the source of truth is the form
  // store, so the preview is always exactly what the user is about to save.
  const { length, width, height } = form.values

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t('spaces:editSpace') : t('spaces:addSpace')}
      centered
      size="lg"
      radius="md"
    >
      <form onSubmit={handleSubmit} noValidate>
        <Stack gap="md">
          {errorMessage ? (
            <Alert color="danger" variant="light" radius="md">
              {errorMessage}
            </Alert>
          ) : null}

          {!editing ? (
            <>
              <SpaceTemplatePicker onApply={applyTemplate} />
              <Divider color="var(--app-border)" label={t('spaces:templates.customLabel')} labelPosition="center" />
            </>
          ) : null}

          <TextInput
            label={t('spaces:fields.name')}
            placeholder={t('spaces:placeholders.name')}
            withAsterisk
            data-autofocus
            {...form.getInputProps('name')}
          />

          <Group grow align="flex-start">
            <DimensionField
              label={t('spaces:fields.length')}
              unit={t('spaces:units.m')}
              value={form.values.length}
              onChange={(value) => form.setFieldValue('length', value)}
              error={form.errors.length as string | undefined}
            />
            <DimensionField
              label={t('spaces:fields.width')}
              unit={t('spaces:units.m')}
              value={form.values.width}
              onChange={(value) => form.setFieldValue('width', value)}
              error={form.errors.width as string | undefined}
            />
            <DimensionField
              label={t('spaces:fields.height')}
              unit={t('spaces:units.m')}
              value={form.values.height}
              onChange={(value) => form.setFieldValue('height', value)}
              error={form.errors.height as string | undefined}
            />
          </Group>

          <SpacePlan2D length={length} width={width} height={height} showLegend={false} />

          <CalcPreview length={length} width={width} height={height} />

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose} disabled={isSubmitting}>
              {t('spaces:actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? t('spaces:actions.save') : t('spaces:actions.create')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

interface DimensionFieldProps {
  label: string
  unit: string
  value: number
  onChange: (next: number) => void
  error?: string | undefined
}

function DimensionField({ label, unit, value, onChange, error }: DimensionFieldProps) {
  // Mantine NumberInput emits `number | string` — we coerce to a finite number,
  // falling back to 0 so the live preview never sees NaN.
  return (
    <NumberInput
      label={label}
      withAsterisk
      min={0}
      max={200}
      step={0.1}
      decimalScale={2}
      hideControls
      classNames={{ input: 'app-numeric' }}
      rightSection={
        <span style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>{unit}</span>
      }
      rightSectionWidth={36}
      value={value}
      onChange={(next) => {
        const parsed = typeof next === 'number' ? next : Number.parseFloat(next || '0')
        onChange(Number.isFinite(parsed) ? parsed : 0)
      }}
      error={error}
    />
  )
}

