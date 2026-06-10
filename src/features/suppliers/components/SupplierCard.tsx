import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { MapPin, Star, Timer } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/shared/utils/format'
import type { Supplier } from '../domain/supplier.types'

interface SupplierCardProps {
  supplier: Supplier
  /** Count of distinct materials this supplier currently prices. */
  materialsCount?: number | undefined
  onClick: (supplier: Supplier) => void
}

/**
 * Visual-first supplier card. Same restraint as MaterialCard — hairline
 * border, no shadow, editorial mono numerals. Preferred suppliers get a
 * tinted ink edge so the top of the gallery reads as "your shortlist" at a
 * glance.
 */
export function SupplierCard({ supplier, materialsCount, onClick }: SupplierCardProps) {
  const { t } = useTranslation(['suppliers'])
  const initials = supplier.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  return (
    <UnstyledButton
      onClick={() => onClick(supplier)}
      style={{
        display: 'block',
        background: 'var(--app-surface)',
        border: supplier.preferred
          ? '1px solid var(--mantine-color-text)'
          : '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
        overflow: 'hidden',
        width: '100%',
        opacity: supplier.deletedAt ? 0.55 : 1,
      }}
    >
      <Box style={{ position: 'relative', padding: 16 }}>
        {supplier.preferred ? (
          <Box
            aria-hidden
            style={{
              position: 'absolute',
              insetInlineStart: 0,
              top: 0,
              bottom: 0,
              width: 3,
              background: 'var(--mantine-color-text)',
            }}
          />
        ) : null}

        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <Box
              aria-hidden
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--mantine-radius-sm)',
                background: supplier.preferred
                  ? 'var(--mantine-color-text)'
                  : 'var(--app-surface-muted)',
                color: supplier.preferred
                  ? 'var(--mantine-color-body)'
                  : 'var(--mantine-color-text)',
                border: '1px solid var(--app-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--app-font-mono)',
                letterSpacing: '-0.02em',
                flexShrink: 0,
              }}
            >
              {initials || '—'}
            </Box>
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text fz="sm" fw={600} lineClamp={1}>
                {supplier.name}
              </Text>
              {supplier.country ? (
                <Group gap={4} wrap="nowrap">
                  <MapPin size={12} weight="regular" />
                  <Text fz="xs" c="dimmed" lineClamp={1}>
                    {supplier.country}
                  </Text>
                </Group>
              ) : (
                <Text fz="xs" c="dimmed">
                  —
                </Text>
              )}
            </Stack>
          </Group>

          {supplier.rating !== null ? (
            <Group gap={4} wrap="nowrap">
              <Star size={12} weight="fill" />
              <Text className="app-numeric" fz="xs" fw={500}>
                {formatNumber(supplier.rating, { maximumFractionDigits: 1 })}
              </Text>
            </Group>
          ) : null}
        </Group>

        <Group gap="md" mt="md" wrap="wrap">
          {supplier.leadTimeDays !== null ? (
            <Group gap={4} wrap="nowrap">
              <Timer size={12} weight="regular" />
              <Text className="app-numeric" fz="xs" c="dimmed">
                {formatNumber(supplier.leadTimeDays)} {t('suppliers:units.leadDays')}
              </Text>
            </Group>
          ) : null}
          {supplier.paymentTerms ? (
            <Text fz="xs" c="dimmed">
              {supplier.paymentTerms}
            </Text>
          ) : null}
          {materialsCount !== undefined ? (
            <Text className="app-numeric" fz="xs" c="dimmed">
              {formatNumber(materialsCount)} {t('suppliers:units.materials', { count: materialsCount })}
            </Text>
          ) : null}
        </Group>

        {supplier.preferred ? (
          <Text
            fz="xs"
            fw={600}
            tt="uppercase"
            mt="sm"
            style={{ letterSpacing: '0.1em' }}
          >
            {t('suppliers:badges.preferred')}
          </Text>
        ) : null}
      </Box>
    </UnstyledButton>
  )
}
