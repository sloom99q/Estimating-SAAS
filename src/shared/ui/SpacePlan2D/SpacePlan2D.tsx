import { Box, Group, Stack, Text } from '@mantine/core'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/shared/utils/format'

/**
 * Visual primitive describing a surface inside the plan. Defined here (in the
 * spaces feature) on purpose — the materials feature resolves a Material into
 * one of these, but the plan itself stays material-agnostic so the spaces
 * feature does not import from materials. The contract:
 *
 *   - `label` — material or surface name, shown in the legend / corner tag
 *   - `accent` — Mantine theme color name; renders the tint + texture color
 *   - `pattern` — opaque key for the texture renderer; null falls back to a
 *     plain tinted fill
 *   - `imageUrl` — when set, the SVG `<image>` overlays the pattern
 */
export type SurfaceAccent = 'info' | 'gray' | 'warn' | 'ink' | 'success' | 'danger'

export interface SurfaceVisual {
  label: string
  accent: SurfaceAccent
  pattern: PlanPattern | null
  imageUrl: string | null
}

/** Pattern catalogue mirrors the materials feature's category-visuals output. */
export type PlanPattern =
  | 'grid'
  | 'veined'
  | 'wash'
  | 'panel'
  | 'dots'
  | 'lines'
  | 'planks'
  | 'solid'

export interface SpacePlan2DProps {
  /** Internal length in metres. */
  length: number
  /** Internal width in metres. */
  width: number
  /** Floor-to-ceiling height in metres. */
  height: number
  /** Optional floor surface — fills the room rectangle. */
  floor?: SurfaceVisual | null | undefined
  /** Optional wall surface — drawn as the perimeter band. */
  wall?: SurfaceVisual | null | undefined
  /** Optional ceiling surface — surfaced as a corner tag. */
  ceiling?: SurfaceVisual | null | undefined
  /** Visual size of the drawn plan in CSS pixels. */
  maxHeight?: number
  /** When false, the legend strip below the plan is suppressed. */
  showLegend?: boolean
}

/**
 * Top-down SVG plan of a room. Pure presentation — no data fetching, no
 * mutations. The composition layer (app/) resolves materials into
 * `SurfaceVisual` shapes and passes them in.
 *
 * Layout: a fixed 16:9 SVG viewport (560×340). The room rectangle is sized so
 * the longest dimension fills the inner padding; the other axis follows
 * aspect ratio. Dimension labels (L · W) sit outside the rectangle so they
 * never collide with the floor texture.
 */
export function SpacePlan2D({
  length,
  width,
  height,
  floor,
  wall,
  ceiling,
  maxHeight = 280,
  showLegend = true,
}: SpacePlan2DProps) {
  const { t } = useTranslation(['spaces'])

  const safeLength = Number.isFinite(length) && length > 0 ? length : 0
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0

  // SVG viewport. The 4:3 aspect ratio gives roughly the same drawing area
  // regardless of room shape, so the dimension labels never crowd.
  const VBW = 560
  const VBH = 340
  const PAD_X = 56
  const PAD_Y = 56

  // Scale the room so the longer side fills the inner box, then derive the
  // shorter side from the actual aspect ratio. When both sides are 0 we render
  // a placeholder square — the form is still being typed.
  const innerW = VBW - PAD_X * 2
  const innerH = VBH - PAD_Y * 2
  const aspect = safeLength > 0 && safeWidth > 0 ? safeLength / safeWidth : 1
  const fitWidth = aspect >= innerW / innerH
  const drawW = fitWidth ? innerW : innerH * aspect
  const drawH = fitWidth ? innerW / aspect : innerH
  const x = (VBW - drawW) / 2
  const y = (VBH - drawH) / 2

  const floorPatternId = useId().replace(/[:]/g, '')
  const wallPatternId = useId().replace(/[:]/g, '')

  const floorAccent = floor?.accent ?? 'gray'
  const wallAccent = wall?.accent ?? 'gray'

  return (
    <Stack
      gap="sm"
      p="md"
      style={{
        background: 'var(--app-surface-muted)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <Box
        style={{
          width: '100%',
          maxHeight,
          aspectRatio: `${VBW} / ${VBH}`,
          background: 'var(--app-surface)',
          border: '1px solid var(--app-border)',
          borderRadius: 'var(--mantine-radius-sm)',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox={`0 0 ${VBW} ${VBH}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          aria-label={t('spaces:plan.title')}
        >
          <defs>
            <PlanPatternDef id={floorPatternId} pattern={floor?.pattern ?? null} />
            <PlanPatternDef
              id={wallPatternId}
              pattern={wall?.pattern ?? null}
              opacity={0.55}
            />
            <clipPath id={`floor-clip-${floorPatternId}`}>
              <rect x={x} y={y} width={drawW} height={drawH} rx={4} ry={4} />
            </clipPath>
          </defs>

          {/* Subtle perimeter background — gives the page anchoring */}
          <rect
            x={x - 18}
            y={y - 18}
            width={drawW + 36}
            height={drawH + 36}
            rx={8}
            ry={8}
            fill="var(--app-canvas)"
            stroke="var(--app-border)"
            strokeDasharray="2 4"
          />

          {/* Floor base tint */}
          <g style={{ color: `var(--mantine-color-${floorAccent}-filled)` }}>
            <rect
              x={x}
              y={y}
              width={drawW}
              height={drawH}
              fill={`var(--mantine-color-${floorAccent}-light)`}
            />
            {/* Optional photographic overlay clipped to the floor rect */}
            {floor?.imageUrl ? (
              <image
                href={floor.imageUrl}
                x={x}
                y={y}
                width={drawW}
                height={drawH}
                preserveAspectRatio="xMidYMid slice"
                opacity={0.92}
                clipPath={`url(#floor-clip-${floorPatternId})`}
              />
            ) : null}
            {/* Pattern hint on top of the tint (skipped when image present) */}
            {!floor?.imageUrl && floor?.pattern ? (
              <rect
                x={x}
                y={y}
                width={drawW}
                height={drawH}
                fill={`url(#${floorPatternId})`}
              />
            ) : null}
            {/* Floor outline */}
            <rect
              x={x}
              y={y}
              width={drawW}
              height={drawH}
              fill="none"
              stroke="var(--app-border)"
              strokeWidth={1}
            />
          </g>

          {/* Wall band — a thin tinted perimeter ring sitting just outside the floor */}
          <g style={{ color: `var(--mantine-color-${wallAccent}-filled)` }}>
            {wall ? (
              <WallBand
                x={x}
                y={y}
                width={drawW}
                height={drawH}
                accent={wallAccent}
                patternId={wallPatternId}
                hasPattern={Boolean(wall?.pattern)}
              />
            ) : (
              <WallBand
                x={x}
                y={y}
                width={drawW}
                height={drawH}
                accent="gray"
                patternId={wallPatternId}
                hasPattern={false}
                dashed
              />
            )}
          </g>

          {/* Length / width labels */}
          <DimensionLabel
            text={`${formatNumber(safeLength)} m`}
            cx={x + drawW / 2}
            cy={y - 26}
          />
          <DimensionLabel
            text={`${formatNumber(safeWidth)} m`}
            cx={x - 26}
            cy={y + drawH / 2}
            rotate={-90}
          />

          {/* Height tag — top-right corner */}
          <g transform={`translate(${x + drawW - 4}, ${y + 8})`}>
            <foreignObject x={-110} y={-4} width={110} height={28}>
              <CornerTag
                label={t('spaces:plan.height')}
                value={`${formatNumber(safeHeight)} m`}
              />
            </foreignObject>
          </g>

          {/* Ceiling tag — bottom-left corner */}
          {ceiling ? (
            <g transform={`translate(${x + 4}, ${y + drawH - 26})`}>
              <foreignObject x={0} y={0} width={Math.max(120, drawW * 0.55)} height={22}>
                <CornerTag
                  label={t('spaces:plan.ceilingLegend')}
                  value={ceiling.label}
                  accent={ceiling.accent}
                />
              </foreignObject>
            </g>
          ) : null}
        </svg>
      </Box>

      {showLegend ? (
        <Group gap="md" wrap="wrap">
          <Legend label={t('spaces:plan.floorLegend')} surface={floor} />
          <Legend label={t('spaces:plan.wallLegend')} surface={wall} />
          <Legend label={t('spaces:plan.ceilingLegend')} surface={ceiling} />
        </Group>
      ) : null}
    </Stack>
  )
}

function PlanPatternDef({
  id,
  pattern,
  opacity = 0.35,
}: {
  id: string
  pattern: PlanPattern | null
  opacity?: number
}) {
  if (!pattern) return null
  switch (pattern) {
    case 'grid':
      return (
        <pattern id={id} width={26} height={26} patternUnits="userSpaceOnUse">
          <rect width={26} height={26} fill="currentColor" fillOpacity={opacity * 0.18} />
          <path
            d="M 26 0 L 0 0 0 26"
            fill="none"
            stroke="currentColor"
            strokeOpacity={opacity}
            strokeWidth={0.9}
          />
        </pattern>
      )
    case 'veined':
      return (
        <pattern id={id} width={120} height={70} patternUnits="userSpaceOnUse">
          <rect width={120} height={70} fill="currentColor" fillOpacity={opacity * 0.15} />
          <path
            d="M0 50 C 30 30 60 80 120 35"
            stroke="currentColor"
            strokeOpacity={opacity * 0.7}
            strokeWidth={1.2}
            fill="none"
          />
          <path
            d="M0 18 C 40 5 80 40 120 12"
            stroke="currentColor"
            strokeOpacity={opacity * 0.4}
            strokeWidth={0.8}
            fill="none"
          />
        </pattern>
      )
    case 'wash':
    case 'solid':
      return (
        <pattern id={id} width={1} height={1} patternUnits="userSpaceOnUse">
          <rect width={1} height={1} fill="currentColor" fillOpacity={opacity * 0.45} />
        </pattern>
      )
    case 'panel':
      return (
        <pattern id={id} width={64} height={64} patternUnits="userSpaceOnUse">
          <rect width={64} height={64} fill="currentColor" fillOpacity={opacity * 0.15} />
          <line
            x1={0}
            y1={32}
            x2={64}
            y2={32}
            stroke="currentColor"
            strokeOpacity={opacity}
            strokeWidth={0.8}
          />
        </pattern>
      )
    case 'dots':
      return (
        <pattern id={id} width={14} height={14} patternUnits="userSpaceOnUse">
          <rect width={14} height={14} fill="currentColor" fillOpacity={opacity * 0.18} />
          <circle cx={7} cy={7} r={1.2} fill="currentColor" fillOpacity={opacity} />
        </pattern>
      )
    case 'lines':
      return (
        <pattern id={id} width={10} height={10} patternUnits="userSpaceOnUse">
          <rect width={10} height={10} fill="currentColor" fillOpacity={opacity * 0.2} />
          <line
            x1={0}
            y1={5}
            x2={10}
            y2={5}
            stroke="currentColor"
            strokeOpacity={opacity}
            strokeWidth={0.6}
          />
        </pattern>
      )
    case 'planks':
      return (
        <pattern id={id} width={26} height={80} patternUnits="userSpaceOnUse">
          <rect width={26} height={80} fill="currentColor" fillOpacity={opacity * 0.22} />
          <line
            x1={13}
            y1={0}
            x2={13}
            y2={80}
            stroke="currentColor"
            strokeOpacity={opacity * 0.6}
            strokeWidth={0.8}
          />
        </pattern>
      )
  }
}

interface WallBandProps {
  x: number
  y: number
  width: number
  height: number
  accent: SurfaceAccent
  patternId: string
  hasPattern: boolean
  dashed?: boolean
}

function WallBand({ x, y, width, height, accent, patternId, hasPattern, dashed }: WallBandProps) {
  const BAND = 10
  const ox = x - BAND
  const oy = y - BAND
  const ow = width + BAND * 2
  const oh = height + BAND * 2
  // Outer rect minus inner room rect = perimeter band. Use evenodd fill rule.
  const path = `M ${ox} ${oy} h ${ow} v ${oh} h ${-ow} Z M ${x} ${y} h ${width} v ${height} h ${-width} Z`
  return (
    <>
      <path
        d={path}
        fillRule="evenodd"
        fill={`var(--mantine-color-${accent}-light)`}
        stroke="var(--app-border)"
        strokeWidth={1}
        {...(dashed ? { strokeDasharray: '3 3' } : {})}
      />
      {hasPattern ? (
        <path d={path} fillRule="evenodd" fill={`url(#${patternId})`} />
      ) : null}
    </>
  )
}

function DimensionLabel({
  text,
  cx,
  cy,
  rotate,
}: {
  text: string
  cx: number
  cy: number
  rotate?: number
}) {
  return (
    <g transform={rotate ? `translate(${cx}, ${cy}) rotate(${rotate})` : `translate(${cx}, ${cy})`}>
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontFamily="var(--app-font-mono)"
        fontWeight={500}
        fill="var(--mantine-color-dimmed)"
      >
        {text}
      </text>
    </g>
  )
}

function CornerTag({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: SurfaceAccent
}) {
  return (
    <Box
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--mantine-color-text)',
        lineHeight: 1,
      }}
    >
      {accent ? (
        <Box
          component="span"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: `var(--mantine-color-${accent}-filled)`,
          }}
        />
      ) : null}
      <Box component="span" style={{ color: 'var(--mantine-color-dimmed)' }}>
        {label}
      </Box>
      <Box
        component="span"
        className="app-numeric"
        style={{ color: 'var(--mantine-color-text)' }}
      >
        {value}
      </Box>
    </Box>
  )
}

function Legend({ label, surface }: { label: string; surface?: SurfaceVisual | null | undefined }) {
  const { t } = useTranslation(['spaces'])
  const accent = surface?.accent ?? 'gray'
  const display = surface?.label ?? t('spaces:plan.unassigned')
  return (
    <Group gap={6} wrap="nowrap">
      <Swatch accent={accent} muted={!surface} />
      <Stack gap={0}>
        <Text fz="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
          {label}
        </Text>
        <Text fz="xs" fw={500} lineClamp={1}>
          {display}
        </Text>
      </Stack>
    </Group>
  )
}

function Swatch({ accent, muted }: { accent: SurfaceAccent; muted: boolean }): ReactNode {
  return (
    <Box
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        background: muted
          ? 'var(--app-surface-muted)'
          : `var(--mantine-color-${accent}-light)`,
        border: muted
          ? '1px dashed var(--app-border)'
          : `1px solid var(--mantine-color-${accent}-filled)`,
      }}
    />
  )
}

