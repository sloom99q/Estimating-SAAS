import { Badge, Box, Group, Image, Stack, Text, UnstyledButton } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { formatCurrency, formatNumber } from '@/shared/utils/format'
import { categoryVisual } from '../domain/category-visuals'
import type { Material } from '../domain/material.types'
import { CategoryIcon } from './CategoryIcon'
import { CategoryTexture } from './CategoryTexture'

interface MaterialCardProps {
  material: Material
  onClick: (material: Material) => void
}

/**
 * Visual-first material tile. Image (or category swatch fallback) on top,
 * meta on the bottom. Theme-token only — works as-is in dark mode because
 * the swatch fallback uses `currentColor` for the texture and the surface
 * background comes from `var(--app-surface)`.
 */
export function MaterialCard({ material, onClick }: MaterialCardProps) {
  const { t } = useTranslation(['materials'])

  return (
    <UnstyledButton
      onClick={() => onClick(material)}
      style={{
        display: 'block',
        background: 'var(--app-surface)',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
        overflow: 'hidden',
        transition: 'transform 120ms ease, border-color 120ms ease',
        opacity: material.active ? 1 : 0.65,
      }}
      className="material-card"
    >
      <Box style={{ position: 'relative', aspectRatio: '4 / 3', overflow: 'hidden' }}>
        {material.imageUrl ? (
          <Image
            src={material.imageUrl}
            alt={t('materials:preview.imageAlt', { name: material.name })}
            h="100%"
            w="100%"
            fit="cover"
            fallbackSrc=""
          />
        ) : (
          <SwatchFallback category={material.category} />
        )}

        <Box
          style={{
            position: 'absolute',
            top: 10,
            insetInlineStart: 10,
            padding: '4px 8px',
            borderRadius: 999,
            background: 'var(--app-surface)',
            border: '1px solid var(--app-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--mantine-color-text)',
            lineHeight: 1,
          }}
        >
          <CategoryIcon category={material.category} size={12} />
          {t(`materials:categories.${material.category}`)}
        </Box>

        {!material.active ? (
          <Badge
            color="gray"
            size="sm"
            style={{ position: 'absolute', top: 10, insetInlineEnd: 10 }}
          >
            {t('materials:status.inactive')}
          </Badge>
        ) : null}
      </Box>

      <Stack gap={4} p="md">
        <Text fz="sm" fw={600} lineClamp={1} ta="start">
          {material.name}
        </Text>
        {material.supplier ? (
          <Text fz="xs" c="dimmed" lineClamp={1} ta="start">
            {material.supplier}
          </Text>
        ) : (
          <Text fz="xs" c="dimmed">
            —
          </Text>
        )}

        <Group justify="space-between" align="baseline" mt={6}>
          <Text className="app-numeric" fz="sm" fw={500}>
            {formatCurrency(material.unitPrice, material.currency, { maximumFractionDigits: 0 })}
            <Text component="span" fz="xs" c="dimmed" ml={4}>
              / {t(`materials:units.${material.unit}`)}
            </Text>
          </Text>
          <Text className="app-numeric" fz="xs" c="dimmed">
            {formatNumber(material.coverage)} m² · {formatNumber(material.wastePct)}%
          </Text>
        </Group>
      </Stack>
    </UnstyledButton>
  )
}

function SwatchFallback({ category }: { category: Material['category'] }) {
  const visual = categoryVisual(category)
  // Wrap CategoryTexture in a div whose `color` token = the category accent at
  // shade 8, so the texture inherits the right ink for the swatch + flips for
  // dark mode automatically. The thin tint underneath fills the bare areas.
  return (
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
        <CategoryTexture pattern={visual.pattern} width={320} height={240} opacity={0.45} />
      </Box>
      <Box
        style={{
          position: 'relative',
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--app-surface)',
          border: '1px solid var(--app-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CategoryIcon category={category} size={24} color="var(--mantine-color-text)" />
      </Box>
    </Box>
  )
}
