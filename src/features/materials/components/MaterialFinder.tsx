import {
  Box,
  Group,
  RangeSlider,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/shared/utils/format'
import { DEFAULT_CURRENCY } from '@/shared/config/constants'
import { categoryVisual } from '../domain/category-visuals'
import {
  USAGE_TARGETS,
  emptyFilterState,
  priceRange,
  type MaterialFilterState,
} from '../domain/discovery'
import {
  MATERIAL_CATEGORIES,
  type Material,
} from '../domain/material.types'
import { CategoryIcon } from './CategoryIcon'

interface MaterialFinderProps {
  materials: Material[]
  state: MaterialFilterState
  onChange: (next: MaterialFilterState) => void
  /** Hide the usage filter when picking a specific surface (already constrained). */
  hideUsageFilter?: boolean | undefined
}

/**
 * Catalog-style filter cluster: search field, category chips, usage chips
 * (floor/wall/ceiling), price range slider. Encodes the discovery vocabulary
 * once; reused by `MaterialsListPage` AND `AssignMaterialsModal` so the
 * search/filter UX is identical wherever materials are surfaced.
 */
export function MaterialFinder({
  materials,
  state,
  onChange,
  hideUsageFilter,
}: MaterialFinderProps) {
  const { t } = useTranslation(['materials'])
  const naturalRange = useMemo(() => priceRange(materials), [materials])
  const range: [number, number] = state.priceRange ?? [
    naturalRange.min,
    naturalRange.max,
  ]
  const sliderEnabled = naturalRange.max > naturalRange.min

  const setQuery = (query: string) => onChange({ ...state, query })
  const setCategory = (category: MaterialFilterState['category']) =>
    onChange({ ...state, category })
  const setUsage = (usage: MaterialFilterState['usage']) =>
    onChange({ ...state, usage })
  const setRange = (next: [number, number]) =>
    onChange({ ...state, priceRange: next })
  const clearRange = () => onChange({ ...state, priceRange: null })

  const hasCustomFilters =
    state.query.trim().length > 0 ||
    state.category !== 'all' ||
    state.usage !== 'all' ||
    state.priceRange !== null

  return (
    <Stack gap="md">
      <Group gap="sm" align="center" wrap="wrap">
        <TextInput
          value={state.query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('materials:discovery.searchPlaceholder')}
          leftSection={<MagnifyingGlass size={14} />}
          style={{ flex: 1, minWidth: 240 }}
        />
        {hasCustomFilters ? (
          <UnstyledButton
            onClick={() => onChange(emptyFilterState())}
            style={{
              fontSize: 13,
              color: 'var(--mantine-color-dimmed)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <X size={12} weight="bold" />
            {t('materials:discovery.clear')}
          </UnstyledButton>
        ) : null}
      </Group>

      <Stack gap={6}>
        <Text
          fz="xs"
          c="dimmed"
          fw={600}
          tt="uppercase"
          style={{ letterSpacing: '0.08em' }}
        >
          {t('materials:filter.category')}
        </Text>
        <Box style={{ overflowX: 'auto' }}>
          <Group gap={8} wrap="nowrap" pb={4}>
            <FilterChip
              label={t('materials:filter.all')}
              active={state.category === 'all'}
              onClick={() => setCategory('all')}
            />
            {MATERIAL_CATEGORIES.map((category) => {
              const visual = categoryVisual(category)
              return (
                <FilterChip
                  key={category}
                  label={t(`materials:categories.${category}`)}
                  icon={<CategoryIcon category={category} size={12} />}
                  accent={visual.accent}
                  active={state.category === category}
                  onClick={() => setCategory(category)}
                />
              )
            })}
          </Group>
        </Box>
      </Stack>

      {!hideUsageFilter ? (
        <Stack gap={6}>
          <Text
            fz="xs"
            c="dimmed"
            fw={600}
            tt="uppercase"
            style={{ letterSpacing: '0.08em' }}
          >
            {t('materials:filter.usage')}
          </Text>
          <Group gap={8} wrap="wrap">
            <FilterChip
              label={t('materials:filter.all')}
              active={state.usage === 'all'}
              onClick={() => setUsage('all')}
            />
            {USAGE_TARGETS.map((usage) => (
              <FilterChip
                key={usage}
                label={t(`materials:filter.usageTarget.${usage}`)}
                active={state.usage === usage}
                onClick={() => setUsage(usage)}
              />
            ))}
          </Group>
        </Stack>
      ) : null}

      {sliderEnabled ? (
        <Stack gap={6}>
          <Group justify="space-between">
            <Text
              fz="xs"
              c="dimmed"
              fw={600}
              tt="uppercase"
              style={{ letterSpacing: '0.08em' }}
            >
              {t('materials:filter.priceRange')}
            </Text>
            <Text className="app-numeric" fz="xs" c="dimmed">
              {DEFAULT_CURRENCY} {formatNumber(range[0])} — {DEFAULT_CURRENCY}{' '}
              {formatNumber(range[1])}
            </Text>
          </Group>
          <RangeSlider
            min={naturalRange.min}
            max={naturalRange.max}
            step={1}
            value={range}
            onChange={setRange}
            onChangeEnd={(next) => {
              // Treat range = full extent as "no filter" so it doesn't keep
              // counting as a custom filter when the user resets implicitly.
              if (next[0] === naturalRange.min && next[1] === naturalRange.max) {
                clearRange()
              }
            }}
            label={null}
            color="ink"
            radius="xl"
            size="sm"
          />
        </Stack>
      ) : null}
    </Stack>
  )
}

interface FilterChipProps {
  label: string
  icon?: React.ReactNode
  accent?: string
  active: boolean
  onClick: () => void
}

function FilterChip({ label, icon, accent, active, onClick }: FilterChipProps) {
  const background = active
    ? 'var(--mantine-color-text)'
    : accent
      ? `var(--mantine-color-${accent}-light)`
      : 'var(--app-surface)'
  const color = active
    ? 'var(--mantine-color-body)'
    : accent
      ? `var(--mantine-color-${accent}-filled)`
      : 'var(--mantine-color-text)'
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 999,
        background,
        color,
        border: '1px solid',
        borderColor: active ? 'var(--mantine-color-text)' : 'var(--app-border)',
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      {icon}
      <span>{label}</span>
    </UnstyledButton>
  )
}
