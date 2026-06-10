import { Alert, Badge, Box, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Plus,
  Star,
} from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ID } from '@/shared/types'
import { Section } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { useMaterialProcurement, useDeletePriceLink, useSetPrice } from '../api/usePrices'
import type { MaterialSupplierPrice } from '../domain/price.types'
import {
  summariseProcurement,
  type PriceTrend,
  type TrendDirection,
} from '../domain/procurement'
import type { Supplier } from '../domain/supplier.types'
import { AddPriceModal } from './AddPriceModal'
import { PriceComparisonBars } from './PriceComparisonBars'
import { PriceTimelineChart } from './PriceTimelineChart'

interface MaterialProcurementPanelProps {
  materialId: ID
  materialName: string
  suppliers: ReadonlyArray<Supplier>
}

/**
 * The core Phase-8B surface. Pulls live prices + history for one material,
 * derives the procurement summary, and presents it in three layers:
 *
 *   1. Headline chips: cheapest, preferred, savings, trend.
 *   2. Comparison bars: side-by-side price ranking with lead time / MOQ.
 *   3. Timeline chart: 6+ months of snapshots per supplier.
 *
 * No tables — every read is visual. The user understands "buy from X, you'd
 * save Y" before they read a single number.
 */
export function MaterialProcurementPanel({
  materialId,
  materialName,
  suppliers,
}: MaterialProcurementPanelProps) {
  const { t } = useTranslation(['suppliers'])
  const { prices, snapshots, isLoading } = useMaterialProcurement(materialId)
  const setPriceMutation = useSetPrice(materialId)
  const deleteMutation = useDeletePriceLink(materialId)
  const [opened, modal] = useDisclosure(false)
  const [editing, setEditing] = useState<MaterialSupplierPrice | null>(null)

  const suppliersById = useMemo(() => {
    const map = new Map<ID, Supplier>()
    for (const supplier of suppliers) map.set(supplier.id, supplier)
    return map
  }, [suppliers])

  const summary = useMemo(() => summariseProcurement(prices, snapshots), [prices, snapshots])

  const openAdd = () => {
    setEditing(null)
    modal.open()
  }
  const openEdit = (price: MaterialSupplierPrice) => {
    setEditing(price)
    modal.open()
  }

  const handleSubmit = async (
    input: Parameters<typeof setPriceMutation.mutateAsync>[0],
  ) => {
    await setPriceMutation.mutateAsync(input)
    modal.close()
  }

  const handleDelete = (price: MaterialSupplierPrice) => {
    const supplier = suppliersById.get(price.supplierId)
    modals.openConfirmModal({
      title: t('suppliers:delete.priceTitle'),
      children: (
        <Text fz="sm" c="dimmed">
          {t('suppliers:delete.priceBody', {
            supplier: supplier?.name ?? t('suppliers:unknownSupplier'),
            material: materialName,
          })}
        </Text>
      ),
      labels: {
        confirm: t('suppliers:delete.priceConfirm'),
        cancel: t('suppliers:actions.cancel'),
      },
      confirmProps: { color: 'danger' },
      centered: true,
      onConfirm: () => {
        deleteMutation.mutate(price.id, {
          onError: () =>
            notifications.show({ color: 'red', message: t('suppliers:error.delete') }),
        })
      },
    })
  }

  const linkedSupplierIds = summary.prices.map((p) => p.supplierId)

  return (
    <Section
      title={t('suppliers:procurement.title')}
      description={t('suppliers:procurement.subtitle')}
      step="02"
      actions={
        <Button
          variant="default"
          leftSection={<Plus size={16} weight="bold" />}
          onClick={openAdd}
        >
          {t('suppliers:procurement.addPrice')}
        </Button>
      }
    >
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <HeadlineChip
          label={t('suppliers:procurement.cheapest')}
          tone="success"
          primary={
            summary.cheapest
              ? formatCurrency(summary.cheapest.unitPrice, summary.cheapest.currency, {
                  maximumFractionDigits: 0,
                })
              : '—'
          }
          secondary={
            summary.cheapest
              ? (suppliersById.get(summary.cheapest.supplierId)?.name ?? '—')
              : t('suppliers:procurement.noPrices')
          }
        />
        <HeadlineChip
          label={t('suppliers:procurement.preferred')}
          tone="ink"
          icon={<Star size={11} weight="fill" />}
          primary={
            summary.preferred
              ? formatCurrency(summary.preferred.unitPrice, summary.preferred.currency, {
                  maximumFractionDigits: 0,
                })
              : '—'
          }
          secondary={
            summary.preferred
              ? (suppliersById.get(summary.preferred.supplierId)?.name ?? '—')
              : t('suppliers:procurement.noPreferred')
          }
        />
        <HeadlineChip
          label={t('suppliers:procurement.savings')}
          tone={summary.savings ? 'success' : 'gray'}
          primary={
            summary.savings
              ? formatCurrency(
                  summary.savings.amount,
                  summary.preferred?.currency ?? 'AED',
                  { maximumFractionDigits: 0 },
                )
              : '—'
          }
          secondary={
            summary.savings
              ? t('suppliers:procurement.savingsPct', {
                  pct: formatNumber(summary.savings.pct, { maximumFractionDigits: 0 }),
                })
              : t('suppliers:procurement.savingsNone')
          }
        />
        <TrendChip trend={summary.trend} />
      </SimpleGrid>

      {summary.prices.length === 0 ? (
        <Alert color="warn" variant="light" radius="md">
          {isLoading ? t('suppliers:procurement.loading') : t('suppliers:procurement.emptyBody')}
        </Alert>
      ) : (
        <Box
          style={{
            background: 'var(--app-surface)',
            border: '1px solid var(--app-border)',
            borderRadius: 'var(--mantine-radius-md)',
            padding: 16,
          }}
        >
          <PriceComparisonBars
            prices={summary.prices}
            suppliersById={suppliersById}
            cheapestId={summary.cheapest?.id ?? null}
            preferredId={summary.preferred?.id ?? null}
          />

          <Group gap="xs" mt="md" wrap="wrap">
            {summary.prices.map((price) => {
              const supplier = suppliersById.get(price.supplierId)
              return (
                <Group key={price.id} gap={4}>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => openEdit(price)}
                  >
                    {t('suppliers:procurement.editPriceFor', {
                      supplier: supplier?.name ?? '—',
                    })}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="danger"
                    onClick={() => handleDelete(price)}
                  >
                    {t('suppliers:actions.unlink')}
                  </Button>
                </Group>
              )
            })}
          </Group>
        </Box>
      )}

      {snapshots.length > 0 ? (
        <Stack gap="sm">
          <Group justify="space-between" align="baseline">
            <Text
              fz="xs"
              c="dimmed"
              fw={600}
              tt="uppercase"
              style={{ letterSpacing: '0.08em' }}
            >
              {t('suppliers:timeline.title')}
            </Text>
            <Text fz="xs" c="dimmed">
              {t('suppliers:timeline.subtitle')}
            </Text>
          </Group>
          <PriceTimelineChart
            snapshots={snapshots}
            suppliersById={suppliersById}
            preferredSupplierId={summary.preferred?.supplierId ?? null}
            cheapestSupplierId={summary.cheapest?.supplierId ?? null}
          />
        </Stack>
      ) : null}

      <AddPriceModal
        opened={opened}
        onClose={modal.close}
        materialId={materialId}
        materialName={materialName}
        suppliers={suppliers}
        alreadyLinkedSupplierIds={linkedSupplierIds}
        defaultSupplierId={editing?.supplierId ?? null}
        defaultUnitPrice={editing?.unitPrice ?? null}
        onSubmit={handleSubmit}
        isSubmitting={setPriceMutation.isPending}
        errorMessage={setPriceMutation.error?.message ?? undefined}
      />
    </Section>
  )
}

function HeadlineChip({
  label,
  primary,
  secondary,
  tone,
  icon,
}: {
  label: string
  primary: string
  secondary: string
  tone: 'success' | 'ink' | 'gray'
  icon?: React.ReactNode
}) {
  const colorVar = tone === 'gray' ? 'var(--mantine-color-dimmed)' : `var(--mantine-color-${tone}-filled)`
  const bgVar = tone === 'gray' ? 'var(--app-surface)' : `var(--mantine-color-${tone}-light)`
  return (
    <Box
      style={{
        background: bgVar,
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
        padding: 14,
      }}
    >
      <Group gap={6} align="center">
        {icon}
        {tone === 'gray' ? (
          <Text fz="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
            {label}
          </Text>
        ) : (
          <Text fz="xs" fw={600} tt="uppercase" style={{ letterSpacing: '0.08em', color: colorVar }}>
            {label}
          </Text>
        )}
      </Group>
      <Text className="app-numeric" fz={22} fw={600} mt={6} lh={1.1}>
        {primary}
      </Text>
      <Text fz="xs" c="dimmed" mt={4} lineClamp={1}>
        {secondary}
      </Text>
    </Box>
  )
}

function TrendChip({ trend }: { trend: PriceTrend }) {
  const { t } = useTranslation(['suppliers'])
  const directionMap: Record<TrendDirection, { tone: 'success' | 'danger' | 'gray'; icon: React.ReactNode }> = {
    up: { tone: 'danger', icon: <ArrowUp size={11} weight="bold" /> },
    down: { tone: 'success', icon: <ArrowDown size={11} weight="bold" /> },
    stable: { tone: 'gray', icon: <ArrowRight size={11} weight="bold" /> },
  }
  const m = directionMap[trend.direction]
  const colorVar =
    m.tone === 'gray' ? 'var(--mantine-color-dimmed)' : `var(--mantine-color-${m.tone}-filled)`
  const bgVar =
    m.tone === 'gray' ? 'var(--app-surface)' : `var(--mantine-color-${m.tone}-light)`
  const pctText =
    trend.pct === 0
      ? '0%'
      : `${trend.pct > 0 ? '+' : ''}${formatNumber(trend.pct, { maximumFractionDigits: 1 })}%`
  return (
    <Box
      style={{
        background: bgVar,
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
        padding: 14,
      }}
    >
      <Group gap={6} align="center">
        {m.tone === 'gray' ? (
          <Text fz="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.08em' }}>
            {t('suppliers:procurement.trend')}
          </Text>
        ) : (
          <Text fz="xs" fw={600} tt="uppercase" style={{ letterSpacing: '0.08em', color: colorVar }}>
            {t('suppliers:procurement.trend')}
          </Text>
        )}
        <Badge size="xs" color={m.tone} variant="light" leftSection={m.icon}>
          {t(`suppliers:trend.${trend.direction}`)}
        </Badge>
      </Group>
      <Text className="app-numeric" fz={22} fw={600} mt={6} lh={1.1}>
        {pctText}
      </Text>
      <Text fz="xs" c="dimmed" mt={4}>
        {trend.fromPrice !== null && trend.toPrice !== null
          ? t('suppliers:trend.detail', {
              from: formatNumber(trend.fromPrice, { maximumFractionDigits: 0 }),
              to: formatNumber(trend.toPrice, { maximumFractionDigits: 0 }),
            })
          : t('suppliers:trend.noData')}
      </Text>
    </Box>
  )
}
