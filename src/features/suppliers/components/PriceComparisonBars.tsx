import { Badge, Box, Group, Stack, Text } from '@mantine/core'
import { Star, Timer } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import type { MaterialSupplierPrice } from '../domain/price.types'
import type { Supplier } from '../domain/supplier.types'

interface PriceComparisonBarsProps {
  prices: ReadonlyArray<MaterialSupplierPrice>
  suppliersById: ReadonlyMap<string, Supplier>
  cheapestId: string | null
  preferredId: string | null
}

/**
 * Horizontal bar chart comparing supplier prices for one material. The
 * cheapest bar is rendered ink-filled; preferred carries a "★ Preferred"
 * badge; everyone else is hairline. Built with raw flex + a small inner
 * `<div>` so the chart needs no SVG plumbing and theme-flips automatically.
 *
 * Communicates information BEFORE the user reads numbers: the bar widths
 * encode relative price, the colour encodes choice (cheapest / preferred),
 * the lead-time + MOQ chips on the right encode the procurement trade-off.
 */
export function PriceComparisonBars({
  prices,
  suppliersById,
  cheapestId,
  preferredId,
}: PriceComparisonBarsProps) {
  const { t } = useTranslation(['suppliers'])
  if (prices.length === 0) return null

  // Scale so the most expensive bar fills the track. Cheapest = max-scaled fill.
  const maxPrice = prices.reduce((m, p) => (p.unitPrice > m ? p.unitPrice : m), 0)
  // Sort cheapest → most expensive, preferred floats to the very top.
  const ordered = [...prices].sort((a, b) => {
    if (a.id === preferredId) return -1
    if (b.id === preferredId) return 1
    return a.unitPrice - b.unitPrice
  })

  return (
    <Stack gap={10}>
      {ordered.map((price) => {
        const supplier = suppliersById.get(price.supplierId)
        const isCheapest = price.id === cheapestId
        const isPreferred = price.id === preferredId
        const widthPct = maxPrice > 0 ? (price.unitPrice / maxPrice) * 100 : 0
        return (
          <Stack key={price.id} gap={6}>
            <Group justify="space-between" align="baseline" wrap="wrap" gap="sm">
              <Group gap="xs" wrap="wrap" align="baseline">
                <Text fz="sm" fw={isPreferred || isCheapest ? 600 : 500}>
                  {supplier?.name ?? t('suppliers:unknownSupplier')}
                </Text>
                {isPreferred ? (
                  <Badge size="xs" color="ink" leftSection={<Star size={9} weight="fill" />}>
                    {t('suppliers:badges.preferred')}
                  </Badge>
                ) : null}
                {isCheapest && !isPreferred ? (
                  <Badge size="xs" color="success" variant="light">
                    {t('suppliers:badges.cheapest')}
                  </Badge>
                ) : null}
              </Group>
              <Text className="app-numeric" fz="sm" fw={600}>
                {formatCurrency(price.unitPrice, price.currency, { maximumFractionDigits: 0 })}
              </Text>
            </Group>

            <Box
              style={{
                position: 'relative',
                width: '100%',
                height: 8,
                borderRadius: 999,
                background: 'var(--app-surface-muted)',
                border: '1px solid var(--app-border)',
                overflow: 'hidden',
              }}
            >
              <Box
                aria-hidden
                style={{
                  width: `${widthPct}%`,
                  height: '100%',
                  background: isCheapest
                    ? 'var(--mantine-color-success-filled)'
                    : isPreferred
                      ? 'var(--mantine-color-text)'
                      : 'var(--mantine-color-dimmed)',
                  opacity: isCheapest || isPreferred ? 0.92 : 0.4,
                  transition: 'width 200ms ease-out',
                }}
              />
            </Box>

            <Group gap="md" wrap="wrap">
              {price.leadTimeDays !== null ? (
                <Group gap={4} wrap="nowrap">
                  <Timer size={11} weight="regular" />
                  <Text className="app-numeric" fz="xs" c="dimmed">
                    {formatNumber(price.leadTimeDays)} {t('suppliers:units.leadDays')}
                  </Text>
                </Group>
              ) : null}
              {price.minimumOrderQuantity !== null ? (
                <Text className="app-numeric" fz="xs" c="dimmed">
                  {t('suppliers:bars.moq', {
                    value: formatNumber(price.minimumOrderQuantity),
                  })}
                </Text>
              ) : null}
              {supplier?.rating !== null && supplier?.rating !== undefined ? (
                <Group gap={4} wrap="nowrap">
                  <Star size={11} weight="fill" />
                  <Text className="app-numeric" fz="xs" c="dimmed">
                    {formatNumber(supplier.rating, { maximumFractionDigits: 1 })}
                  </Text>
                </Group>
              ) : null}
            </Group>
          </Stack>
        )
      })}
    </Stack>
  )
}
