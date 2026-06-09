import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_CURRENCY } from '@/shared/config/constants'
import { useZodForm } from '@/shared/hooks/useZodForm'
import { createMaterialSchema, type MaterialFormValues } from '../domain/material.schema'
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  type Material,
  type MaterialCategory,
  type MaterialUnit,
} from '../domain/material.types'

interface MaterialFormModalProps {
  opened: boolean
  onClose: () => void
  material?: Material | undefined
  onSubmit: (values: MaterialFormValues) => void | Promise<void>
  isSubmitting: boolean
  errorMessage?: string | undefined
}

const DEFAULT_VALUES: MaterialFormValues = {
  name: '',
  category: 'tiles',
  unit: 'm2',
  unitPrice: 0,
  coverage: 1,
  wastePct: 10,
  supplier: '',
  notes: '',
  imageUrl: '',
  active: true,
}

function fromMaterial(material: Material): MaterialFormValues {
  return {
    name: material.name,
    category: material.category,
    unit: material.unit,
    unitPrice: material.unitPrice,
    coverage: material.coverage,
    wastePct: material.wastePct,
    supplier: material.supplier ?? '',
    notes: material.notes ?? '',
    imageUrl: material.imageUrl ?? '',
    active: material.active,
  }
}

export function MaterialFormModal({
  opened,
  onClose,
  material,
  onSubmit,
  isSubmitting,
  errorMessage,
}: MaterialFormModalProps) {
  const { t } = useTranslation(['materials'])
  const editing = Boolean(material)

  const schema = useMemo(
    () => createMaterialSchema((key, options) => String(t(key, options ?? {}))),
    [t],
  )

  const form = useZodForm<MaterialFormValues>(schema, {
    initialValues: material ? fromMaterial(material) : DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!opened) return
    form.setValues(material ? fromMaterial(material) : DEFAULT_VALUES)
    form.resetDirty()
    form.clearErrors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, material])

  // When the user picks `m²` as the unit, coverage is by convention `1`.
  // Auto-snap it so the field never confuses the quantity engine downstream.
  useEffect(() => {
    if (form.values.unit === 'm2' && form.values.coverage !== 1) {
      form.setFieldValue('coverage', 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.unit])

  const handleSubmit = form.onSubmit(async (values) => {
    await onSubmit(values)
  })

  const categoryOptions = MATERIAL_CATEGORIES.map((value) => ({
    value,
    label: t(`materials:categories.${value}`),
  }))
  const unitOptions = MATERIAL_UNITS.map((value) => ({
    value,
    label: t(`materials:units.${value}_long`),
  }))

  const unitLabel = t(`materials:units.${form.values.unit}`)

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t('materials:editMaterial') : t('materials:newMaterial')}
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

          <TextInput
            label={t('materials:fields.name')}
            placeholder={t('materials:placeholders.name')}
            withAsterisk
            data-autofocus
            {...form.getInputProps('name')}
          />

          <Group grow align="flex-start">
            <Select
              label={t('materials:fields.category')}
              data={categoryOptions}
              allowDeselect={false}
              checkIconPosition="right"
              withAsterisk
              value={form.values.category}
              onChange={(value) =>
                form.setFieldValue('category', (value ?? 'other') as MaterialCategory)
              }
              error={form.errors.category as string | undefined}
            />
            <Select
              label={t('materials:fields.unit')}
              data={unitOptions}
              allowDeselect={false}
              checkIconPosition="right"
              withAsterisk
              value={form.values.unit}
              onChange={(value) =>
                form.setFieldValue('unit', (value ?? 'm2') as MaterialUnit)
              }
              error={form.errors.unit as string | undefined}
            />
          </Group>

          <Group grow align="flex-start">
            <NumberInput
              label={t('materials:fields.unitPrice')}
              withAsterisk
              min={0}
              decimalScale={2}
              hideControls
              classNames={{ input: 'app-numeric' }}
              prefix={`${DEFAULT_CURRENCY} `}
              value={form.values.unitPrice}
              onChange={(next) => form.setFieldValue('unitPrice', coerceNumber(next))}
              error={form.errors.unitPrice as string | undefined}
            />
            <NumberInput
              label={t('materials:fields.coverage')}
              description={t('materials:hints.coverage')}
              withAsterisk
              min={0}
              decimalScale={3}
              hideControls
              classNames={{ input: 'app-numeric' }}
              suffix={` m² / ${unitLabel}`}
              disabled={form.values.unit === 'm2'}
              value={form.values.coverage}
              onChange={(next) => form.setFieldValue('coverage', coerceNumber(next))}
              error={form.errors.coverage as string | undefined}
            />
            <NumberInput
              label={t('materials:fields.wastePct')}
              description={t('materials:hints.waste')}
              withAsterisk
              min={0}
              max={100}
              step={1}
              decimalScale={1}
              hideControls
              classNames={{ input: 'app-numeric' }}
              suffix=" %"
              value={form.values.wastePct}
              onChange={(next) => form.setFieldValue('wastePct', coerceNumber(next))}
              error={form.errors.wastePct as string | undefined}
            />
          </Group>

          <Group grow align="flex-start">
            <TextInput
              label={t('materials:fields.supplier')}
              placeholder={t('materials:placeholders.supplier')}
              {...form.getInputProps('supplier')}
            />
            <Stack gap={4} pt={28}>
              <Switch
                label={t('materials:fields.active')}
                checked={form.values.active}
                onChange={(event) => form.setFieldValue('active', event.currentTarget.checked)}
              />
              <Text fz="xs" c="dimmed">
                {t('materials:hints.active')}
              </Text>
            </Stack>
          </Group>

          <TextInput
            label={t('materials:fields.imageUrl')}
            description={t('materials:hints.imageUrl')}
            placeholder={t('materials:placeholders.imageUrl')}
            type="url"
            {...form.getInputProps('imageUrl')}
          />

          <Textarea
            label={t('materials:fields.notes')}
            placeholder={t('materials:placeholders.notes')}
            autosize
            minRows={2}
            maxRows={4}
            {...form.getInputProps('notes')}
          />

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose} disabled={isSubmitting}>
              {t('materials:actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? t('materials:actions.save') : t('materials:actions.create')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}

function coerceNumber(value: number | string): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}
