import { ActionIcon, Box, Group, Menu, Stack, Text } from '@mantine/core'
import {
  CaretDown,
  DotsThreeVertical,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SpacePlan2D, type SurfaceAccent, type SurfaceVisual } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { DEFAULT_RATES } from '../config/rates'
import { calcCost, calcMeasurements } from '../domain/calc'
import type { Space } from '../domain/space.types'
import type { SpaceCostEntry } from './SpacesTable'

interface SpaceCardProps {
  space: Space
  /** Optional material-aware cost override. Falls back to DEFAULT_RATES when absent. */
  cost?: SpaceCostEntry | undefined
  /** Resolved surface visuals; passed through to the embedded SpacePlan2D. */
  floorVisual?: SurfaceVisual | null | undefined
  wallVisual?: SurfaceVisual | null | undefined
  ceilingVisual?: SurfaceVisual | null | undefined
  onEdit: (space: Space) => void
  onDelete: (space: Space) => void
  onAssignMaterials?: ((space: Space) => void) | undefined
  /**
   * Optional per-space drill-down rendered inside a collapsible footer (the
   * existing material-aware cost breakdown). When omitted the chevron and
   * panel are hidden.
   */
  renderBreakdown?: ((space: Space) => ReactNode) | undefined
}

/**
 * The space-as-product-card. Stripe-style: a hairline-bordered surface with a
 * mini SpacePlan2D up top, surface-assignment chips in the middle and the
 * editorial cost number at the bottom. Cards over tables means measurements
 * read at a glance instead of buried in a spreadsheet column.
 */
export function SpaceCard({
  space,
  cost,
  floorVisual,
  wallVisual,
  ceilingVisual,
  onEdit,
  onDelete,
  onAssignMaterials,
  renderBreakdown,
}: SpaceCardProps) {
  const { t } = useTranslation(['spaces', 'materials'])
  const measurements = calcMeasurements(space)
  const resolved = cost ?? calcCost(measurements, DEFAULT_RATES)
  const [expanded, setExpanded] = useState(false)

  return (
    <Box
      style={{
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
        overflow: 'hidden',
      }}
    >
      {/* Header row — name, dimensions chip, actions menu */}
      <Group justify="space-between" align="flex-start" px="md" pt="md" pb={6} wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fz="md" fw={600} lineClamp={1}>
            {space.name}
          </Text>
          <Text className="app-numeric" fz="xs" c="dimmed">
            {formatNumber(space.length)} × {formatNumber(space.width)} ×{' '}
            {formatNumber(space.height)} m
          </Text>
        </Stack>
        <Menu position="bottom-end" withinPortal shadow="sm" width={220}>
          <Menu.Target>
            <ActionIcon aria-label={t('spaces:editSpace')}>
              <DotsThreeVertical size={18} weight="bold" />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<PencilSimple size={16} />} onClick={() => onEdit(space)}>
              {t('spaces:editSpace')}
            </Menu.Item>
            {onAssignMaterials ? (
              <Menu.Item onClick={() => onAssignMaterials(space)}>
                {t('materials:assign.title')}
              </Menu.Item>
            ) : null}
            <Menu.Item
              color="danger"
              leftSection={<Trash size={16} />}
              onClick={() => onDelete(space)}
            >
              {t('spaces:delete.confirm')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      {/* Plan thumbnail */}
      <Box px="md">
        <SpacePlan2D
          length={space.length}
          width={space.width}
          height={space.height}
          floor={floorVisual ?? null}
          wall={wallVisual ?? null}
          ceiling={ceilingVisual ?? null}
          maxHeight={180}
          showLegend={false}
        />
      </Box>

      {/* Surface chips — three lozenges showing which material covers each surface */}
      <Group gap={8} px="md" mt="md" wrap="wrap">
        <SurfaceChip label={t('materials:breakdown.floor')} visual={floorVisual} />
        <SurfaceChip label={t('materials:breakdown.walls')} visual={wallVisual} />
        <SurfaceChip label={t('materials:breakdown.ceiling')} visual={ceilingVisual} />
      </Group>

      {/* Cost footer — editorial mono number, optional drill-down chevron */}
      <Group
        justify="space-between"
        align="center"
        px="md"
        py="md"
        mt="md"
        style={{ borderTop: '1px solid var(--app-border)' }}
      >
        <Stack gap={2}>
          <Text
            fz="xs"
            c="dimmed"
            fw={600}
            tt="uppercase"
            style={{ letterSpacing: '0.08em' }}
          >
            {t('materials:breakdown.total')}
          </Text>
          <Text className="app-numeric" fz="xl" fw={600}>
            {formatCurrency(Number(resolved.totalAmount), resolved.currency, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Stack>
        {renderBreakdown ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            onClick={() => setExpanded((v) => !v)}
            aria-label={t('materials:breakdown.title')}
            aria-expanded={expanded}
            style={{
              transform: expanded ? 'rotate(180deg)' : undefined,
              transition: 'transform 160ms ease',
            }}
          >
            <CaretDown size={16} weight="bold" />
          </ActionIcon>
        ) : null}
      </Group>

      {expanded && renderBreakdown ? (
        <Box
          px="md"
          pb="md"
          style={{ borderTop: '1px solid var(--app-border)' }}
        >
          <Box pt="md">{renderBreakdown(space)}</Box>
        </Box>
      ) : null}
    </Box>
  )
}

function SurfaceChip({
  label,
  visual,
}: {
  label: string
  visual?: SurfaceVisual | null | undefined
}) {
  const { t } = useTranslation(['spaces'])
  const accent: SurfaceAccent = visual?.accent ?? 'gray'
  const name = visual?.label ?? t('spaces:plan.unassigned')
  const muted = !visual
  return (
    <Group
      gap={6}
      wrap="nowrap"
      style={{
        background: muted ? 'var(--app-surface-muted)' : 'var(--app-surface)',
        border: muted
          ? '1px dashed var(--app-border)'
          : '1px solid var(--app-border)',
        padding: '4px 10px',
        borderRadius: 999,
        maxWidth: '100%',
      }}
    >
      <Box
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: muted
            ? 'var(--app-surface-muted)'
            : `var(--mantine-color-${accent}-light)`,
          border: `1px solid var(--mantine-color-${accent}-filled)`,
          flexShrink: 0,
          opacity: muted ? 0.5 : 1,
        }}
      />
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Text fz="xs" fw={500} style={{ maxWidth: 140 }} truncate="end">
        {name}
      </Text>
    </Group>
  )
}
