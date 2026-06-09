import { Box, Group, Stack, Text, Tooltip } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import type { BoqCategoryTotal } from '../domain/boq'
import { categoryVisual } from '../domain/category-visuals'
import { CategoryIcon } from './CategoryIcon'

interface CategoryCompositionBarProps {
  totals: BoqCategoryTotal[]
  /** Grand-total amount used to compute each segment's share. Decimal string. */
  grandTotal: string
}

/**
 * Editorial "cost composition" — a single thin horizontal bar split into
 * category segments, each tinted by its theme accent. Reads at a glance: the
 * widest segment is the dominant cost driver. Below the bar sits an inline
 * legend with category icon + share %. Hairline dividers, no shadows, no
 * mesh gradients — pure editorial restraint.
 *
 * Renders nothing when the project has no priced lines yet (the hero
 * progress bar already communicates "nothing to spend on").
 */
export function CategoryCompositionBar({ totals, grandTotal }: CategoryCompositionBarProps) {
  const { t } = useTranslation(['materials'])
  const grand = Number(grandTotal)

  if (!Number.isFinite(grand) || grand <= 0 || totals.length === 0) {
    return null
  }

  const segments = totals.map((entry) => {
    const amount = Number(entry.amount)
    const share = amount / grand
    return {
      entry,
      amount,
      share,
      visual: categoryVisual(entry.category),
    }
  })

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="baseline">
        <Text
          fz="xs"
          c="dimmed"
          fw={600}
          tt="uppercase"
          style={{ letterSpacing: '0.08em' }}
        >
          {t('materials:hero.composition')}
        </Text>
        <Text fz="xs" c="dimmed">
          {t('materials:hero.compositionCount', { count: totals.length })}
        </Text>
      </Group>

      <Box
        style={{
          display: 'flex',
          width: '100%',
          height: 14,
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--app-surface-muted)',
          border: '1px solid var(--app-border)',
        }}
      >
        {segments.map(({ entry, share, visual }, index) => (
          <Tooltip
            key={entry.category}
            label={`${t(`materials:categories.${entry.category}`)} · ${formatCurrency(
              Number(entry.amount),
              entry.currency,
              { maximumFractionDigits: 0 },
            )} · ${Math.round(share * 100)}%`}
            position="top"
            withArrow
          >
            <Box
              style={{
                width: `${share * 100}%`,
                background: `var(--mantine-color-${visual.accent}-filled)`,
                opacity: 0.85,
                borderInlineEnd:
                  index === segments.length - 1 ? 'none' : '1px solid var(--app-surface)',
              }}
            />
          </Tooltip>
        ))}
      </Box>

      <Group gap="lg" wrap="wrap">
        {segments.map(({ entry, share, visual }) => (
          <Group key={entry.category} gap={8} align="center">
            <Box
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: `var(--mantine-color-${visual.accent}-light)`,
                color: `var(--mantine-color-${visual.accent}-filled)`,
                border: '1px solid var(--app-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CategoryIcon category={entry.category} size={11} />
            </Box>
            <Text fz="xs" fw={500}>
              {t(`materials:categories.${entry.category}`)}
            </Text>
            <Text className="app-numeric" fz="xs" c="dimmed">
              {formatNumber(share * 100, { maximumFractionDigits: 0 })}%
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  )
}
