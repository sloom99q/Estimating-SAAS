import { SimpleGrid } from '@mantine/core'
import type { ReactNode } from 'react'
import type { ID } from '@/shared/types'
import type { SurfaceVisual } from '@/shared/ui'
import type { Space } from '../domain/space.types'
import { SpaceCard } from './SpaceCard'
import type { SpaceCostEntry } from './SpacesTable'

/**
 * Resolved visuals for the three surfaces of a single space. The composition
 * layer maps Material → SurfaceVisual (via `materials/toSurfaceVisual`) and
 * supplies a getter, so the spaces feature stays material-agnostic.
 */
export interface SpaceSurfaceVisuals {
  floor: SurfaceVisual | null
  wall: SurfaceVisual | null
  ceiling: SurfaceVisual | null
}

interface SpacesGridProps {
  spaces: Space[]
  costsBySpaceId?: ReadonlyMap<ID, SpaceCostEntry> | undefined
  getSurfaceVisuals?: ((space: Space) => SpaceSurfaceVisuals) | undefined
  onEdit: (space: Space) => void
  onDelete: (space: Space) => void
  onAssignMaterials?: ((space: Space) => void) | undefined
  renderBreakdown?: ((space: Space) => ReactNode) | undefined
}

/**
 * Card-grid layout for spaces in the workspace — the default Phase-6 view.
 * Each cell is a self-contained product-card; the table fallback remains
 * reachable via the segmented toggle in `SpacesSection`.
 */
export function SpacesGrid({
  spaces,
  costsBySpaceId,
  getSurfaceVisuals,
  onEdit,
  onDelete,
  onAssignMaterials,
  renderBreakdown,
}: SpacesGridProps) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg" verticalSpacing="lg">
      {spaces.map((space) => {
        const visuals = getSurfaceVisuals?.(space)
        return (
          <SpaceCard
            key={space.id}
            space={space}
            cost={costsBySpaceId?.get(space.id)}
            floorVisual={visuals?.floor}
            wallVisual={visuals?.wall}
            ceilingVisual={visuals?.ceiling}
            onEdit={onEdit}
            onDelete={onDelete}
            {...(onAssignMaterials ? { onAssignMaterials } : {})}
            {...(renderBreakdown ? { renderBreakdown } : {})}
          />
        )
      })}
    </SimpleGrid>
  )
}
