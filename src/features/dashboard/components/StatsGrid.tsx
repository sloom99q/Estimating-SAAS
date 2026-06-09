import { SimpleGrid, Skeleton } from '@mantine/core'
import { Buildings, Coins, FileText, TrendUp } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { StatCard } from '@/shared/ui'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import type { DashboardStats } from '../api/dashboard.api'

interface StatsGridProps {
  stats: DashboardStats | undefined
  loading: boolean
}

const COLS = { base: 1, sm: 2, lg: 4 }

export function StatsGrid({ stats, loading }: StatsGridProps) {
  const { t } = useTranslation(['dashboard'])

  if (loading || !stats) {
    return (
      <SimpleGrid cols={COLS} spacing="lg">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} h={132} radius="md" />
        ))}
      </SimpleGrid>
    )
  }

  return (
    <SimpleGrid cols={COLS} spacing="lg">
      <StatCard
        label={t('dashboard:stats.activeProjects')}
        value={formatNumber(stats.activeProjects)}
        icon={Buildings}
        accent="ink"
      />
      <StatCard
        label={t('dashboard:stats.openEstimates')}
        value={formatNumber(stats.openEstimates)}
        icon={FileText}
        accent="info"
      />
      <StatCard
        label={t('dashboard:stats.pipelineValue')}
        value={formatCurrency(Number(stats.pipelineValue.amount), stats.pipelineValue.currency, {
          maximumFractionDigits: 0,
        })}
        icon={Coins}
        accent="success"
      />
      <StatCard
        label={t('dashboard:stats.winRate')}
        value={`${formatNumber(stats.winRate * 100, { maximumFractionDigits: 0 })}%`}
        icon={TrendUp}
        accent="warn"
      />
    </SimpleGrid>
  )
}
