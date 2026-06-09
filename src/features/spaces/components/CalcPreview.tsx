import { Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { DEFAULT_RATES } from '../config/rates'
import { calcCost, calcMeasurements } from '../domain/calc'

interface CalcPreviewProps {
  length: number
  width: number
  height: number
}

/**
 * Live measurement panel. Pure presentation over the pure-TS calc utilities —
 * the same primitives the service and project totals use, so there is exactly
 * one source of truth for what "wall area" means.
 *
 * Style note: no card / no shadow / no eyebrow. Hairline border + generous
 * gaps. Numerics are mono + tabular so digit columns align as they tick.
 */
export function CalcPreview({ length, width, height }: CalcPreviewProps) {
  const { t } = useTranslation(['spaces'])
  const measurements = calcMeasurements({ length, width, height })
  const cost = calcCost(measurements, DEFAULT_RATES)

  return (
    <Stack
      gap="md"
      p="md"
      style={{
        borderRadius: 'var(--mantine-radius-md)',
        border: '1px solid var(--app-border)',
        background: 'var(--app-surface-muted)',
      }}
    >
      <Group justify="space-between" align="center">
        <Text fz="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
          {t('spaces:preview.title')}
        </Text>
        <Text className="app-numeric" fz="xs" c="dimmed">
          {formatNumber(measurements.perimeter)} {t('spaces:units.m')} · {t('spaces:preview.perimeter')}
        </Text>
      </Group>

      <SimpleGrid cols={3} spacing="sm">
        <Metric label={t('spaces:preview.floor')} value={measurements.floorArea} unit={t('spaces:units.m2')} />
        <Metric label={t('spaces:preview.walls')} value={measurements.wallArea} unit={t('spaces:units.m2')} />
        <Metric label={t('spaces:preview.ceiling')} value={measurements.ceilingArea} unit={t('spaces:units.m2')} />
      </SimpleGrid>

      <Group
        justify="space-between"
        align="center"
        pt="sm"
        style={{ borderTop: '1px solid var(--app-border)' }}
      >
        <Stack gap={2}>
          <Text fz="xs" c="dimmed">
            {t('spaces:preview.floorCost')}
          </Text>
          <Text className="app-numeric" fz="sm" fw={500}>
            {formatCurrency(Number(cost.floorAmount), cost.currency, { maximumFractionDigits: 0 })}
          </Text>
        </Stack>
        <Stack gap={2} align="flex-end">
          <Text fz="xs" c="dimmed">
            {t('spaces:preview.wallCost')}
          </Text>
          <Text className="app-numeric" fz="sm" fw={500}>
            {formatCurrency(Number(cost.wallAmount), cost.currency, { maximumFractionDigits: 0 })}
          </Text>
        </Stack>
      </Group>

      <Text fz="xs" c="dimmed">
        {t('spaces:preview.ratesNote')}
      </Text>
    </Stack>
  )
}

function Metric({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Stack gap={4}>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Group gap={4} align="baseline" wrap="nowrap">
        <Text className="app-numeric" fz={22} fw={600} lh={1.1}>
          {formatNumber(value)}
        </Text>
        <Text fz="xs" c="dimmed">
          {unit}
        </Text>
      </Group>
    </Stack>
  )
}
