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
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_CURRENCY } from '@/shared/config/constants'
import type { ID } from '@/shared/types'
import type { SetPriceInput } from '../domain/price.types'
import type { Supplier } from '../domain/supplier.types'

interface AddPriceModalProps {
  opened: boolean
  onClose: () => void
  materialId: ID
  materialName: string
  /** Suppliers available to pick. Inactive / deleted ones are filtered upstream. */
  suppliers: ReadonlyArray<Supplier>
  /** Supplier ids already linked to this material; we exclude them from the picker. */
  alreadyLinkedSupplierIds: ReadonlyArray<ID>
  /** Pre-select a supplier (used when "edit price" is clicked on an existing row). */
  defaultSupplierId?: ID | null
  defaultUnitPrice?: number | null
  onSubmit: (input: SetPriceInput) => Promise<unknown>
  isSubmitting: boolean
  errorMessage?: string | undefined
}

/**
 * One-input price write. Picks the supplier + price + optional MOQ /
 * lead-time / preferred / notes, and POSTs to /api/material-supplier-prices.
 * The server upserts the live link AND writes a `PriceSnapshot` in the same
 * transaction, so the timeline always reflects this change next render.
 */
export function AddPriceModal({
  opened,
  onClose,
  materialId,
  materialName,
  suppliers,
  alreadyLinkedSupplierIds,
  defaultSupplierId,
  defaultUnitPrice,
  onSubmit,
  isSubmitting,
  errorMessage,
}: AddPriceModalProps) {
  const { t } = useTranslation(['suppliers'])
  const editing = Boolean(defaultSupplierId)

  const [supplierId, setSupplierId] = useState<ID | null>(defaultSupplierId ?? null)
  const [unitPrice, setUnitPrice] = useState<number>(defaultUnitPrice ?? 0)
  const [moq, setMoq] = useState<number | null>(null)
  const [leadTime, setLeadTime] = useState<number | null>(null)
  const [isPreferred, setIsPreferred] = useState<boolean>(false)
  const [notes, setNotes] = useState<string>('')

  useEffect(() => {
    if (!opened) return
    setSupplierId(defaultSupplierId ?? null)
    setUnitPrice(defaultUnitPrice ?? 0)
    setMoq(null)
    setLeadTime(null)
    setIsPreferred(false)
    setNotes('')
  }, [opened, defaultSupplierId, defaultUnitPrice])

  const options = suppliers
    .filter((s) => !s.deletedAt)
    .filter(
      (s) =>
        editing || !alreadyLinkedSupplierIds.includes(s.id) || s.id === defaultSupplierId,
    )
    .map((s) => ({ value: s.id, label: s.name }))

  const canSubmit = supplierId !== null && unitPrice > 0

  const handleSubmit = async () => {
    if (!canSubmit || !supplierId) return
    const input: SetPriceInput = {
      materialId,
      supplierId,
      unitPrice,
      currency: DEFAULT_CURRENCY,
      minimumOrderQuantity: moq,
      leadTimeDays: leadTime,
      isPreferred,
      notes,
    }
    await onSubmit(input)
  }

  const coerce = (next: number | string): number => {
    if (next === '' || next === null || next === undefined) return 0
    const parsed = typeof next === 'number' ? next : Number.parseFloat(next)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const coerceNullable = (next: number | string): number | null => {
    if (next === '' || next === null || next === undefined) return null
    const parsed = typeof next === 'number' ? next : Number.parseFloat(next)
    return Number.isFinite(parsed) ? parsed : null
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editing ? t('suppliers:addPrice.editTitle') : t('suppliers:addPrice.title')}
      centered
      size="lg"
      radius="md"
    >
      <Stack gap="md">
        <Text fz="sm" c="dimmed">
          {t('suppliers:addPrice.subtitle', { name: materialName })}
        </Text>

        {errorMessage ? (
          <Alert color="danger" variant="light" radius="md">
            {errorMessage}
          </Alert>
        ) : null}

        {options.length === 0 ? (
          <Alert color="warn" variant="light" radius="md">
            {t('suppliers:addPrice.noSuppliers')}
          </Alert>
        ) : null}

        <Group grow align="flex-start">
          <Select
            label={t('suppliers:addPrice.supplier')}
            withAsterisk
            data={options}
            value={supplierId}
            onChange={(value) => setSupplierId(value)}
            allowDeselect={false}
            checkIconPosition="right"
            searchable
            disabled={editing}
          />
          <NumberInput
            label={t('suppliers:addPrice.unitPrice')}
            withAsterisk
            min={0}
            decimalScale={2}
            hideControls
            classNames={{ input: 'app-numeric' }}
            prefix={`${DEFAULT_CURRENCY} `}
            value={unitPrice}
            onChange={(next) => setUnitPrice(coerce(next))}
          />
        </Group>

        <Group grow align="flex-start">
          <NumberInput
            label={t('suppliers:addPrice.moq')}
            description={t('suppliers:hints.moq')}
            min={0}
            decimalScale={2}
            hideControls
            classNames={{ input: 'app-numeric' }}
            value={moq ?? ''}
            onChange={(next) => setMoq(coerceNullable(next))}
          />
          <NumberInput
            label={t('suppliers:addPrice.leadTimeDays')}
            min={0}
            decimalScale={0}
            hideControls
            classNames={{ input: 'app-numeric' }}
            suffix={` ${t('suppliers:units.leadDays')}`}
            value={leadTime ?? ''}
            onChange={(next) => setLeadTime(coerceNullable(next))}
          />
          <Stack gap={4} pt={28}>
            <Switch
              label={t('suppliers:addPrice.preferred')}
              checked={isPreferred}
              onChange={(event) => setIsPreferred(event.currentTarget.checked)}
            />
            <Text fz="xs" c="dimmed">
              {t('suppliers:hints.preferredMaterial')}
            </Text>
          </Stack>
        </Group>

        <Textarea
          label={t('suppliers:fields.notes')}
          placeholder={t('suppliers:placeholders.priceNotes')}
          autosize
          minRows={2}
          maxRows={4}
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
        />

        <Group justify="flex-end" gap="sm" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={isSubmitting}>
            {t('suppliers:actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={isSubmitting} disabled={!canSubmit}>
            {editing ? t('suppliers:addPrice.save') : t('suppliers:addPrice.submit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
