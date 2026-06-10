import { Box, Group, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatDate, formatNumber } from '@/shared/utils/format'
import type { PriceSnapshot } from '../domain/price.types'
import { snapshotsBySupplier } from '../domain/procurement'
import type { Supplier } from '../domain/supplier.types'

interface PriceTimelineChartProps {
  snapshots: ReadonlyArray<PriceSnapshot>
  suppliersById: ReadonlyMap<string, Supplier>
  preferredSupplierId: string | null
  cheapestSupplierId: string | null
  height?: number
}

/**
 * Hand-rolled SVG multi-line chart for supplier price history. No charting
 * library. Each supplier gets one polyline; the preferred supplier is drawn
 * with the ink stroke, cheapest with success-filled, others with dimmed.
 *
 * Editorial restraint: hairline horizontal gridlines only, dimension labels
 * in tabular mono, no axis decoration. The point is to communicate trend at
 * a glance, not to support analytical drill-down.
 */
export function PriceTimelineChart({
  snapshots,
  suppliersById,
  preferredSupplierId,
  cheapestSupplierId,
  height = 220,
}: PriceTimelineChartProps) {
  const { t } = useTranslation(['suppliers'])
  if (snapshots.length === 0) return null

  const grouped = snapshotsBySupplier(snapshots)
  const series = Array.from(grouped.entries())
    .map(([supplierId, points]) => ({
      supplierId,
      supplier: suppliersById.get(supplierId) ?? null,
      points,
    }))
    .filter((s) => s.points.length > 0)

  if (series.length === 0) return null

  // Domain
  const allPrices = snapshots.map((s) => s.price)
  const minPrice = Math.min(...allPrices)
  const maxPrice = Math.max(...allPrices)
  // Pad 10% at top + bottom so the line never hugs the edge.
  const padding = (maxPrice - minPrice) * 0.1
  const yMin = Math.max(0, minPrice - padding)
  const yMax = maxPrice + padding || maxPrice + 1
  const yRange = yMax - yMin || 1

  const allDates = snapshots.map((s) => new Date(s.effectiveDate).getTime())
  const xMin = Math.min(...allDates)
  const xMax = Math.max(...allDates)
  const xRange = xMax - xMin || 1

  // SVG viewport
  const W = 720
  const PAD_L = 56
  const PAD_R = 12
  const PAD_T = 12
  const PAD_B = 28
  const innerW = W - PAD_L - PAD_R
  const innerH = height - PAD_T - PAD_B

  const toX = (date: string): number => {
    const t = new Date(date).getTime()
    return PAD_L + ((t - xMin) / xRange) * innerW
  }
  const toY = (price: number): number => {
    return PAD_T + innerH - ((price - yMin) / yRange) * innerH
  }

  const horizontalLines = 4
  const gridYs = Array.from({ length: horizontalLines + 1 }, (_, i) => {
    const ratio = i / horizontalLines
    const price = yMin + ratio * yRange
    const y = PAD_T + innerH - ratio * innerH
    return { y, price }
  })

  return (
    <Stack gap="sm">
      <Box
        style={{
          background: 'var(--app-surface)',
          border: '1px solid var(--app-border)',
          borderRadius: 'var(--mantine-radius-md)',
          padding: 8,
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={t('suppliers:timeline.ariaLabel')}
        >
          {/* Horizontal gridlines + Y labels */}
          {gridYs.map((entry) => (
            <g key={entry.y}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={entry.y}
                y2={entry.y}
                stroke="var(--app-border)"
                strokeDasharray="2 4"
              />
              <text
                x={PAD_L - 8}
                y={entry.y}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={10}
                fontFamily="var(--app-font-mono)"
                fill="var(--mantine-color-dimmed)"
              >
                {formatNumber(entry.price, { maximumFractionDigits: 0 })}
              </text>
            </g>
          ))}

          {/* X labels — first and last */}
          <text
            x={PAD_L}
            y={height - 8}
            textAnchor="start"
            fontSize={10}
            fontFamily="var(--app-font-mono)"
            fill="var(--mantine-color-dimmed)"
          >
            {formatDate(new Date(xMin).toISOString(), { month: 'short', year: 'numeric' })}
          </text>
          <text
            x={W - PAD_R}
            y={height - 8}
            textAnchor="end"
            fontSize={10}
            fontFamily="var(--app-font-mono)"
            fill="var(--mantine-color-dimmed)"
          >
            {formatDate(new Date(xMax).toISOString(), { month: 'short', year: 'numeric' })}
          </text>

          {/* One polyline per supplier */}
          {series.map(({ supplierId, points }) => {
            const isPreferred = supplierId === preferredSupplierId
            const isCheapest = supplierId === cheapestSupplierId
            const strokeColor = isCheapest
              ? 'var(--mantine-color-success-filled)'
              : isPreferred
                ? 'var(--mantine-color-text)'
                : 'var(--mantine-color-dimmed)'
            const strokeWidth = isPreferred || isCheapest ? 2 : 1.25
            const opacity = isPreferred || isCheapest ? 1 : 0.55
            const pathPoints = points
              .map((p) => `${toX(p.effectiveDate)},${toY(p.price)}`)
              .join(' ')
            const lastPoint = points[points.length - 1]!
            return (
              <g key={supplierId}>
                <polyline
                  points={pathPoints}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={opacity}
                />
                {points.map((p, i) => (
                  <circle
                    key={`${supplierId}-${i}`}
                    cx={toX(p.effectiveDate)}
                    cy={toY(p.price)}
                    r={i === points.length - 1 ? 3 : 2}
                    fill={strokeColor}
                    opacity={opacity}
                  />
                ))}
                {/* Anchor label at the LAST point */}
                <text
                  x={toX(lastPoint.effectiveDate) + 6}
                  y={toY(lastPoint.price)}
                  fontSize={10}
                  fontFamily="var(--app-font-mono)"
                  fill={strokeColor}
                  opacity={opacity}
                  dominantBaseline="central"
                >
                  {formatNumber(lastPoint.price, { maximumFractionDigits: 0 })}
                </text>
              </g>
            )
          })}
        </svg>
      </Box>

      {/* Inline legend */}
      <Group gap="lg" wrap="wrap">
        {series.map(({ supplierId, supplier, points }) => {
          const isPreferred = supplierId === preferredSupplierId
          const isCheapest = supplierId === cheapestSupplierId
          const color = isCheapest
            ? 'var(--mantine-color-success-filled)'
            : isPreferred
              ? 'var(--mantine-color-text)'
              : 'var(--mantine-color-dimmed)'
          const newest = points[points.length - 1]!
          return (
            <Group key={supplierId} gap={6} align="center" wrap="nowrap">
              <Box
                aria-hidden
                style={{
                  width: 18,
                  height: 2,
                  background: color,
                  borderRadius: 999,
                }}
              />
              <Text fz="xs" fw={500}>
                {supplier?.name ?? t('suppliers:unknownSupplier')}
              </Text>
              <Text className="app-numeric" fz="xs" c="dimmed">
                {formatCurrency(newest.price, newest.currency, { maximumFractionDigits: 0 })}
              </Text>
            </Group>
          )
        })}
      </Group>
    </Stack>
  )
}
