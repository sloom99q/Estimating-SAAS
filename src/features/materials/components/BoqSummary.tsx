import {
  Accordion,
  Alert,
  Box,
  Card,
  Divider,
  Group,
  Image,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core'
import { Receipt } from '@phosphor-icons/react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, Section } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { categoryVisual } from '../domain/category-visuals'
import type { BoqLine, ProjectBoq } from '../domain/boq'
import type { Material, MaterialCategory } from '../domain/material.types'
import { CategoryIcon } from './CategoryIcon'
import { CategoryTexture } from './CategoryTexture'
import { MaterialCategoryBadge } from './MaterialCategoryBadge'

interface BoqSummaryProps {
  boq: ProjectBoq
  /**
   * Materials index — used to pull thumbnails for the line cards. Optional so
   * the BOQ still renders correctly while materials are loading (the swatch
   * fallback covers it).
   */
  materialsById?: ReadonlyMap<string, Material> | undefined
  /** Optional editorial step prefix forwarded to the Section heading. */
  step?: string | undefined
}

interface CategoryGroup {
  category: MaterialCategory
  lines: BoqLine[]
  amount: number
  currency: string
}

/**
 * Project Bill-of-Quantities — accordion grouped by category. Inside each
 * group, each material line is a card with a thumbnail (real image or
 * category swatch) + meta stack + cost. Designed for skimming first, drilling
 * second: closed accordions show category subtotal so you never need to open
 * a row just to compare.
 */
export function BoqSummary({ boq, materialsById, step }: BoqSummaryProps) {
  const { t } = useTranslation(['materials'])

  // Group BOQ lines by category, preserving the engine's largest-first order.
  const groups = useMemo<CategoryGroup[]>(() => {
    const map = new Map<MaterialCategory, CategoryGroup>()
    for (const line of boq.lines) {
      const entry = map.get(line.category)
      const amount = Number(line.totalAmount)
      if (entry) {
        entry.lines.push(line)
        entry.amount += amount
      } else {
        map.set(line.category, {
          category: line.category,
          lines: [line],
          amount,
          currency: line.currency,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [boq.lines])

  const hasLines = boq.lines.length > 0
  const defaultOpened = useMemo(() => groups.map((g) => g.category), [groups])

  return (
    <Section
      title={t('materials:boq.title')}
      description={t('materials:boq.description')}
      {...(step ? { step } : {})}
    >
      {!hasLines ? (
        <Card padding={0}>
          <EmptyState icon={Receipt} title={t('materials:boq.empty')} />
        </Card>
      ) : (
        <Card padding={0}>
          <Accordion
            multiple
            defaultValue={defaultOpened}
            variant="default"
            chevronPosition="right"
            styles={{
              item: {
                background: 'transparent',
                borderColor: 'var(--app-border)',
              },
              control: { paddingInline: 16, paddingBlock: 12 },
              content: { paddingInline: 0, paddingBottom: 16 },
              panel: { paddingInline: 0 },
            }}
          >
            {groups.map((group) => (
              <Accordion.Item key={group.category} value={group.category}>
                <Accordion.Control>
                  <GroupHeader group={group} />
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm" px="md">
                    {group.lines.map((line) => (
                      <LineCard
                        key={line.materialId}
                        line={line}
                        material={materialsById?.get(line.materialId)}
                      />
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Card>
      )}

      {hasLines ? (
        <Card>
          <Stack gap="md">
            <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
              {t('materials:boq.categoryTotals')}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
              {boq.categoryTotals.map((entry) => (
                <Group key={entry.category} justify="space-between">
                  <MaterialCategoryBadge category={entry.category} />
                  <Text className="app-numeric" fz="sm" fw={500}>
                    {formatCurrency(Number(entry.amount), entry.currency, {
                      maximumFractionDigits: 0,
                    })}
                  </Text>
                </Group>
              ))}
            </SimpleGrid>

            <Divider />

            <Group justify="space-between" align="center">
              <Text fz="sm" c="dimmed" fw={500}>
                {t('materials:boq.grandTotal')}
              </Text>
              <Text className="app-numeric" fz={26} fw={600}>
                {formatCurrency(Number(boq.grandTotal), boq.currency, {
                  maximumFractionDigits: 0,
                })}
              </Text>
            </Group>

            {boq.unassignedSurfaceArea > 0 ? (
              <Alert color="warn" variant="light" radius="md">
                {t('materials:boq.unassignedNote', {
                  area: formatNumber(boq.unassignedSurfaceArea),
                })}
              </Alert>
            ) : null}
          </Stack>
        </Card>
      ) : null}
    </Section>
  )
}

function GroupHeader({ group }: { group: CategoryGroup }) {
  const { t } = useTranslation(['materials'])
  const visual = categoryVisual(group.category)
  return (
    <Group justify="space-between" align="center" wrap="nowrap" w="100%" pr="sm">
      <Group gap="md" wrap="nowrap" align="center">
        <Box
          style={{
            width: 36,
            height: 36,
            borderRadius: 'var(--mantine-radius-sm)',
            background: `var(--mantine-color-${visual.accent}-light)`,
            color: `var(--mantine-color-${visual.accent}-filled)`,
            border: '1px solid var(--app-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CategoryIcon category={group.category} size={18} />
        </Box>
        <Stack gap={2}>
          <Text fz="sm" fw={600}>
            {t(`materials:categories.${group.category}`)}
          </Text>
          <Text fz="xs" c="dimmed">
            {t('materials:boq.categoryCount', { count: group.lines.length })}
          </Text>
        </Stack>
      </Group>
      <Text className="app-numeric" fz="md" fw={600}>
        {formatCurrency(group.amount, group.currency, { maximumFractionDigits: 0 })}
      </Text>
    </Group>
  )
}

function LineCard({ line, material }: { line: BoqLine; material: Material | undefined }) {
  const { t } = useTranslation(['materials'])
  const visual = categoryVisual(line.category)
  const unitLabel = t(`materials:units.${line.unit}`)

  return (
    <Box
      style={{
        display: 'flex',
        gap: 16,
        padding: 12,
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--app-surface-muted)',
        border: '1px solid var(--app-border)',
        alignItems: 'center',
      }}
    >
      <Box
        style={{
          position: 'relative',
          flexShrink: 0,
          width: 64,
          height: 56,
          borderRadius: 'var(--mantine-radius-sm)',
          overflow: 'hidden',
          border: '1px solid var(--app-border)',
        }}
      >
        {material?.imageUrl ? (
          <Image
            src={material.imageUrl}
            alt={t('materials:preview.imageAlt', { name: line.materialName })}
            h="100%"
            w="100%"
            fit="cover"
          />
        ) : (
          <Box
            style={{
              position: 'absolute',
              inset: 0,
              background: `var(--mantine-color-${visual.accent}-light)`,
              color: `var(--mantine-color-${visual.accent}-filled)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box style={{ position: 'absolute', inset: 0 }}>
              <CategoryTexture pattern={visual.pattern} width={64} height={56} opacity={0.5} />
            </Box>
            <CategoryIcon category={line.category} size={18} />
          </Box>
        )}
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text fz="sm" fw={500} lineClamp={1}>
          {line.materialName}
        </Text>
        <Group gap="xs" mt={4} wrap="wrap">
          <Stat label={t('materials:boq.lineLabels.area')}>
            <Text className="app-numeric" fz="xs">
              {formatNumber(line.totalArea)} m²
            </Text>
          </Stat>
          <Stat label={t('materials:boq.lineLabels.qty')}>
            <Text className="app-numeric" fz="xs">
              {formatNumber(line.quantity)} {unitLabel}
            </Text>
          </Stat>
          <Stat label={t('materials:boq.lineLabels.unit')}>
            <Text className="app-numeric" fz="xs">
              {formatCurrency(line.unitPrice, line.currency)}
            </Text>
          </Stat>
        </Group>
      </Box>

      <Text className="app-numeric" fz="md" fw={600}>
        {formatCurrency(Number(line.totalAmount), line.currency, { maximumFractionDigits: 0 })}
      </Text>
    </Box>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap={4} align="baseline">
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      {children}
    </Group>
  )
}
