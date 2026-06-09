import type { SurfaceVisual } from '@/shared/ui'
import { categoryVisual } from '../domain/category-visuals'
import type { Material } from '../domain/material.types'

/**
 * Convert a Material into the `SurfaceVisual` shape that the shared
 * `SpacePlan2D` primitive expects. Lives next to the components (not in
 * `domain/`) because it imports the `SurfaceVisual` type from `@/shared/ui` —
 * a Mantine-backed module that domain/ is forbidden from touching.
 */
export function toSurfaceVisual(material: Material | null | undefined): SurfaceVisual | null {
  if (!material) return null
  const visual = categoryVisual(material.category)
  return {
    label: material.name,
    accent: visual.accent,
    pattern: visual.pattern,
    imageUrl: material.imageUrl,
  }
}
