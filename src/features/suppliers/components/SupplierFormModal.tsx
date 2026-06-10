import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useZodForm } from '@/shared/hooks/useZodForm'
import {
  createSupplierSchema,
  type SupplierFormValues,
} from '../domain/supplier.schema'
import type { Supplier } from '../domain/supplier.types'

interface SupplierFormModalProps {
  opened: boolean
  onClose: () => void
  supplier?: Supplier | undefined
  onSubmit: (values: SupplierFormValues) => void | Promise<void>
  isSubmitting: boolean
  errorMessage?: string | undefined
}

const DEFAULT_VALUES: SupplierFormValues = {
  name: '',
  country: '',
  contactName: '',
  email: '',
  phone: '',
  website: '',
  paymentTerms: '',
  leadTimeDays: null,
  rating: null,
  preferred: false,
  notes: '',
}

function fromSupplier(supplier: Supplier): SupplierFormValues {
  return {
    name: supplier.name,
    country: supplier.country ?? '',
    contactName: supplier.contactName ?? '',
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    website: supplier.website ?? '',
    paymentTerms: supplier.paymentTerms ?? '',
    leadTimeDays: supplier.leadTimeDays,
    rating: supplier.rating,
    preferred: supplier.preferred,
    notes: supplier.notes ?? '',
  }
}

export function SupplierFormModal({
  opened,
  onClose,
  supplier,
  onSubmit,
  isSubmitting,
  errorMessage,
}: SupplierFormModalProps) {
  const { t } = useTranslation(['suppliers'])
  const editing = Boolean(supplier)

  const schema = useMemo(
    () => createSupplierSchema((key, options) => String(t(key, options ?? {}))),
    [t],
  )

  const form = useZodForm<SupplierFormValues>(schema, {
    initialValues: supplier ? fromSupplier(supplier) : DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!opened) return
    form.setValues(supplier ? fromSupplier(supplier) : DEFAULT_VALUES)
    form.resetDirty()
    form.clearErrors()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, supplier])

  const handleSubmit = form.onSubmit(async (values) => {
    await onSubmit(values)
  })

  const coerceNumber = (next: number | string): number | null => {
    if (next === '' || next === null || next === undefined) return null
    const parsed = typeof next === 'number' ? next : Number.parseFloat(next)
    return Number.isFinite(parsed) ? parsed : null
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t('suppliers:editSupplier') : t('suppliers:newSupplier')}
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
            label={t('suppliers:fields.name')}
            placeholder={t('suppliers:placeholders.name')}
            withAsterisk
            data-autofocus
            {...form.getInputProps('name')}
          />

          <Group grow align="flex-start">
            <TextInput
              label={t('suppliers:fields.country')}
              placeholder={t('suppliers:placeholders.country')}
              {...form.getInputProps('country')}
            />
            <TextInput
              label={t('suppliers:fields.contactName')}
              placeholder={t('suppliers:placeholders.contactName')}
              {...form.getInputProps('contactName')}
            />
          </Group>

          <Group grow align="flex-start">
            <TextInput
              label={t('suppliers:fields.email')}
              placeholder="contact@example.com"
              type="email"
              {...form.getInputProps('email')}
            />
            <TextInput
              label={t('suppliers:fields.phone')}
              placeholder="+971 4 555 0000"
              {...form.getInputProps('phone')}
            />
          </Group>

          <Group grow align="flex-start">
            <TextInput
              label={t('suppliers:fields.website')}
              placeholder="https://example.com"
              type="url"
              {...form.getInputProps('website')}
            />
            <TextInput
              label={t('suppliers:fields.paymentTerms')}
              placeholder={t('suppliers:placeholders.paymentTerms')}
              {...form.getInputProps('paymentTerms')}
            />
          </Group>

          <Group grow align="flex-start">
            <NumberInput
              label={t('suppliers:fields.leadTimeDays')}
              description={t('suppliers:hints.leadTimeDays')}
              min={0}
              decimalScale={0}
              hideControls
              classNames={{ input: 'app-numeric' }}
              suffix={` ${t('suppliers:units.leadDays')}`}
              value={form.values.leadTimeDays ?? ''}
              onChange={(next) => form.setFieldValue('leadTimeDays', coerceNumber(next))}
              error={form.errors.leadTimeDays as string | undefined}
            />
            <NumberInput
              label={t('suppliers:fields.rating')}
              description={t('suppliers:hints.rating')}
              min={0}
              max={5}
              step={0.1}
              decimalScale={1}
              hideControls
              classNames={{ input: 'app-numeric' }}
              suffix=" / 5"
              value={form.values.rating ?? ''}
              onChange={(next) => form.setFieldValue('rating', coerceNumber(next))}
              error={form.errors.rating as string | undefined}
            />
            <Stack gap={4} pt={28}>
              <Switch
                label={t('suppliers:fields.preferred')}
                checked={form.values.preferred}
                onChange={(event) =>
                  form.setFieldValue('preferred', event.currentTarget.checked)
                }
              />
              <Text fz="xs" c="dimmed">
                {t('suppliers:hints.preferred')}
              </Text>
            </Stack>
          </Group>

          <Textarea
            label={t('suppliers:fields.notes')}
            placeholder={t('suppliers:placeholders.notes')}
            autosize
            minRows={2}
            maxRows={4}
            {...form.getInputProps('notes')}
          />

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose} disabled={isSubmitting}>
              {t('suppliers:actions.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? t('suppliers:actions.save') : t('suppliers:actions.create')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
