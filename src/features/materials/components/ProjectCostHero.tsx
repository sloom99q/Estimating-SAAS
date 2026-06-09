import { Box, Group, Progress, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import type { ProjectBoq } from '../domain/boq'

interface ProjectCostHeroProps {
  boq: ProjectBoq
  /** Sum of floor m² across the project. */
  floorArea: number
  /** Sum of wall m² across the project. */
  wallArea: number
  /** Number of spaces inside the project. */
  spaceCount: number
}

/**
 * Editorial cost hero. Replaces the 4-tile KPI grid at the top of the project
 * workspace. The goal is to make the project's total cost feel like a single,
 * unmistakable headline — not a stat tile — and to make the user's progress
 * through "assign every surface" visible at a glance.
 *
 * Restraint rules applied:
 *   - One single dominant figure (mono, tight letter-spacing, lh 1)
 *   - One progress bar
 *   - A small chip strip of secondary facts at the bottom edge
 *   - Hairline border, no shadow, no gradient — pure editorial card
 *   - All numerics use `.app-numeric` so columns line up
 */
export function ProjectCostHero({
  boq,
  floorArea,
  wallArea,
  spaceCount,
}: ProjectCostHeroProps) {
  const { t } = useTranslation(['materials', 'spaces'])

  // Surfaces total = 3 per space (floor, wall, ceiling). Progress is what
  // share of those surfaces have a real material assigned. When the project
  // has no spaces yet we render 0% so the bar is honest about state.
  const totalSurfaces = spaceCount * 3
  const assignedSurfaces = Math.max(0, totalSurfaces - boq.unassignedSurfaceCount)
  const completion = totalSurfaces > 0 ? assignedSurfaces / totalSurfaces : 0
  const completionPct = Math.round(completion * 100)
  const distinctMaterials = boq.lines.length

  return (
    <Box
      style={{
        position: 'relative',
        padding: '32px 28px',
        borderRadius: 'var(--mantine-radius-lg)',
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        overflow: 'hidden',
      }}
    >
      {/* Subtle hairline grid behind the headline — gives the editorial /
          architectural-blueprint feel without resorting to glassmorphism. */}
      <Box
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(to right, var(--app-border) 1px, transparent 1px), linear-gradient(to bottom, var(--app-border) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.35,
          maskImage:
            'radial-gradient(circle at 30% 10%, black 0%, transparent 65%)',
          WebkitMaskImage:
            'radial-gradient(circle at 30% 10%, black 0%, transparent 65%)',
        }}
      />

      <Stack gap="xl" pos="relative">
        <Stack gap={6}>
          <Text
            fz="xs"
            c="dimmed"
            fw={600}
            tt="uppercase"
            style={{ letterSpacing: '0.12em' }}
          >
            {t('materials:boq.grandTotal')}
          </Text>
          <Text
            className="app-numeric"
            fw={500}
            style={{
              fontSize: 'clamp(40px, 6vw, 64px)',
              lineHeight: 1,
              letterSpacing: '-0.04em',
            }}
          >
            {formatCurrency(Number(boq.grandTotal), boq.currency, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Stack>

        <Stack gap="sm">
          <Group justify="space-between" align="baseline">
            <Text
              fz="xs"
              c="dimmed"
              fw={600}
              tt="uppercase"
              style={{ letterSpacing: '0.08em' }}
            >
              {t('materials:hero.completion')}
            </Text>
            <Text className="app-numeric" fz="sm" fw={500}>
              {completionPct}%{' '}
              <Text component="span" fz="xs" c="dimmed">
                · {assignedSurfaces}/{totalSurfaces}{' '}
                {t('materials:hero.surfacesShort')}
              </Text>
            </Text>
          </Group>
          <Progress
            value={completionPct}
            color={completionPct === 100 ? 'success' : 'ink'}
            size="md"
            radius="xl"
            animated={completionPct > 0 && completionPct < 100}
          />
        </Stack>

        <Group gap="lg" wrap="wrap">
          <ChipStat label={t('spaces:summary.spaces')} value={formatNumber(spaceCount)} />
          <ChipStat
            label={t('spaces:summary.floorArea')}
            value={`${formatNumber(floorArea)} m²`}
          />
          <ChipStat
            label={t('spaces:summary.wallArea')}
            value={`${formatNumber(wallArea)} m²`}
          />
          <ChipStat
            label={t('materials:hero.materialsUsed')}
            value={formatNumber(distinctMaterials)}
          />
        </Group>
      </Stack>
    </Box>
  )
}

function ChipStat({ label, value }: { label: string; value: string }) {
  return (
    <Group gap={6} align="baseline">
      <Text
        fz="xs"
        c="dimmed"
        tt="uppercase"
        fw={600}
        style={{ letterSpacing: '0.08em' }}
      >
        {label}
      </Text>
      <Text className="app-numeric" fz="sm" fw={500}>
        {value}
      </Text>
    </Group>
  )
}
