import { SimpleGrid } from '@mantine/core'
import { Coins, Cube, RectangleDashed, Stack as StackIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import type { CurrencyCode } from '@/shared/types'
import { StatCard } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { DEFAULT_RATES } from '../config/rates'
import { calcProjectTotals } from '../domain/calc'
import type { Space } from '../domain/space.types'

/**
 * The exact shape ProjectSummaryStats wants to display. Either the spaces
 * feature derives it locally via Phase-2 placeholder rates, or the
 * composition layer (app/) hands a material-aware version in via the
 * `totals` prop.
 */
export interface ProjectSummaryTotals {
  spaceCount: number
  floorArea: number
  wallArea: number
  estimatedAmount: string
  currency: CurrencyCode
}

interface ProjectSummaryStatsProps {
  spaces: Space[]
  /** Material-aware override produced by the workspace page. */
  totals?: ProjectSummaryTotals
}

const COLS = { base: 1, sm: 2, lg: 4 }

/**
 * The project's top-of-workspace KPI row. When `totals` is provided (Phase 3)
 * we render those directly; otherwise we derive a Phase-2 placeholder view
 * via the in-feature default rates. Either way the same component renders so
 * the visual rhythm is identical.
 */
export function ProjectSummaryStats({ spaces, totals }: ProjectSummaryStatsProps) {
  const { t } = useTranslation(['spaces'])
  const m2 = t('spaces:units.m2')

  const resolved: ProjectSummaryTotals = totals ?? (() => {
    const calculated = calcProjectTotals(spaces, DEFAULT_RATES)
    return {
      spaceCount: calculated.spaceCount,
      floorArea: calculated.floorArea,
      wallArea: calculated.wallArea,
      estimatedAmount: calculated.cost.totalAmount,
      currency: calculated.cost.currency,
    }
  })()

  return (
    <SimpleGrid cols={COLS} spacing="lg">
      <StatCard
        label={t('spaces:summary.spaces')}
        value={formatNumber(resolved.spaceCount)}
        icon={StackIcon}
        accent="ink"
      />
      <StatCard
        label={t('spaces:summary.floorArea')}
        value={`${formatNumber(resolved.floorArea)} ${m2}`}
        icon={RectangleDashed}
        accent="info"
      />
      <StatCard
        label={t('spaces:summary.wallArea')}
        value={`${formatNumber(resolved.wallArea)} ${m2}`}
        icon={Cube}
        accent="warn"
      />
      <StatCard
        label={t('spaces:summary.estimatedCost')}
        value={formatCurrency(Number(resolved.estimatedAmount), resolved.currency, {
          maximumFractionDigits: 0,
        })}
        icon={Coins}
        accent="success"
      />
    </SimpleGrid>
  )
}
