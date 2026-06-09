import { Badge, Box, Grid, Group, Stack, Table, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useCostTraceEnabled } from '@/shared/store/uiStore'
import { SpacePlan2D } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { categoryVisual } from '../domain/category-visuals'
import type {
  CostSource,
  SpaceCostBreakdown,
  SurfaceCostLine,
} from '../domain/quantity'
import { CategoryIcon } from './CategoryIcon'
import { toSurfaceVisual } from './surface-visual'

interface SpaceCostBreakdownProps {
  breakdown: SpaceCostBreakdown
  /** Length / width / height — feeds the plan thumbnail rendered alongside. */
  spaceLength: number
  spaceWidth: number
  spaceHeight: number
}

/**
 * Per-space material cost breakdown. Rendered as the expand-panel under a
 * space row in the workspace table. Visual-first: plan thumbnail on the left,
 * surface table on the right. The plan reuses the same `SpacePlan2D`
 * primitive as the assignments modal so they read identically.
 */
export function SpaceCostBreakdownView({
  breakdown,
  spaceLength,
  spaceWidth,
  spaceHeight,
}: SpaceCostBreakdownProps) {
  const { t } = useTranslation(['materials'])

  return (
    <Stack
      gap="md"
      p="md"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--app-surface-muted)',
        border: '1px solid var(--app-border)',
      }}
    >
      <Grid gap="md" align="stretch">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <SpacePlan2D
            length={spaceLength}
            width={spaceWidth}
            height={spaceHeight}
            floor={toSurfaceVisual(breakdown.floor.material)}
            wall={toSurfaceVisual(breakdown.wall.material)}
            ceiling={toSurfaceVisual(breakdown.ceiling.material)}
            maxHeight={220}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="sm">
            <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
              {t('materials:breakdown.title')}
            </Text>
            <Table verticalSpacing={6} horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('materials:breakdown.surface')}</Table.Th>
                  <Table.Th>{t('materials:breakdown.material')}</Table.Th>
                  <Table.Th ta="end">{t('materials:breakdown.quantity')}</Table.Th>
                  <Table.Th ta="end">{t('materials:breakdown.amount')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <BreakdownRow line={breakdown.floor} label={t('materials:breakdown.floor')} />
                <BreakdownRow line={breakdown.wall} label={t('materials:breakdown.walls')} />
                <BreakdownRow line={breakdown.ceiling} label={t('materials:breakdown.ceiling')} />
              </Table.Tbody>
            </Table>

            <Group
              justify="space-between"
              pt="sm"
              style={{ borderTop: '1px solid var(--app-border)' }}
            >
              <Text fz="sm" c="dimmed">
                {t('materials:breakdown.total')}
              </Text>
              <Text className="app-numeric" fz="md" fw={600}>
                {formatCurrency(Number(breakdown.totalAmount), breakdown.currency, {
                  maximumFractionDigits: 0,
                })}
              </Text>
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}

interface BreakdownRowProps {
  line: SurfaceCostLine
  label: string
}

function BreakdownRow({ line, label }: BreakdownRowProps) {
  const { t } = useTranslation(['materials'])
  const traceEnabled = useCostTraceEnabled()
  const unitLabel = line.material ? t(`materials:units.${line.material.unit}`) : null
  const accent = line.material ? categoryVisual(line.material.category).accent : 'gray'

  return (
    <Table.Tr>
      <Table.Td>
        <Group gap="sm" wrap="nowrap" align="center">
          <Box
            style={{
              width: 22,
              height: 22,
              borderRadius: 'var(--mantine-radius-sm)',
              background: `var(--mantine-color-${accent}-light)`,
              color: `var(--mantine-color-${accent}-filled)`,
              border: '1px solid var(--app-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {line.material ? (
              <CategoryIcon category={line.material.category} size={12} />
            ) : null}
          </Box>
          <Stack gap={0}>
            <Text fz="sm" fw={500}>
              {label}
            </Text>
            <Text className="app-numeric" fz="xs" c="dimmed">
              {formatNumber(line.area)} m²
            </Text>
          </Stack>
        </Group>
      </Table.Td>
      <Table.Td>
        <Stack gap={4}>
          {line.material ? (
            <Text fz="sm">{line.material.name}</Text>
          ) : (
            <Text fz="sm" c="dimmed">
              {t('materials:breakdown.default')}
            </Text>
          )}
          {traceEnabled ? <CostSourceTag source={line.source} /> : null}
        </Stack>
      </Table.Td>
      <Table.Td ta="end">
        {line.material && line.quantity !== null ? (
          <Text className="app-numeric" fz="sm">
            {formatNumber(line.quantity)}
            <Text component="span" fz="xs" c="dimmed" ml={4}>
              {unitLabel}
            </Text>
          </Text>
        ) : (
          <Text fz="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
      <Table.Td ta="end">
        <Text className="app-numeric" fz="sm" fw={500}>
          {formatCurrency(Number(line.amount), line.currency, { maximumFractionDigits: 0 })}
        </Text>
      </Table.Td>
    </Table.Tr>
  )
}

/**
 * Tiny pill that reveals the provenance of the cost on a single line. Only
 * rendered when the dev-mode cost-trace toggle is enabled (see uiStore).
 */
function CostSourceTag({ source }: { source: CostSource }) {
  if (source.kind === 'material') {
    return (
      <Badge size="xs" color="info" variant="light" radius="sm">
        material · {source.materialId}
      </Badge>
    )
  }
  return (
    <Badge size="xs" color="warn" variant="light" radius="sm">
      default-rate · {source.surface} · {source.ratePerSqm}/m²
    </Badge>
  )
}
