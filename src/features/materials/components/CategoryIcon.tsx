import {
  Diamond,
  Drop,
  GridFour,
  Package,
  PaintBrush,
  Rows,
  Square,
  StackSimple,
} from '@phosphor-icons/react'
import type { IconProps } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import type { MaterialCategory } from '../domain/material.types'

/**
 * Phosphor icon per material category. Keeps `MaterialCard`, the gallery and
 * the preview modal anchored to a single visual identity for each category —
 * no scattered glyph choices.
 */
const CATEGORY_ICON: Record<MaterialCategory, ComponentType<IconProps>> = {
  tiles: GridFour,
  marble: Diamond,
  paint: PaintBrush,
  gypsum: Square,
  glue: Drop,
  grout: Rows,
  cladding: StackSimple,
  other: Package,
}

interface CategoryIconProps extends IconProps {
  category: MaterialCategory
}

export function CategoryIcon({ category, ...rest }: CategoryIconProps) {
  const Icon = CATEGORY_ICON[category]
  return <Icon {...rest} />
}
