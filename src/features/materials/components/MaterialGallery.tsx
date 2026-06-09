import { SimpleGrid } from '@mantine/core'
import type { Material } from '../domain/material.types'
import { MaterialCard } from './MaterialCard'

interface MaterialGalleryProps {
  materials: Material[]
  onOpen: (material: Material) => void
}

/**
 * Grid layout for the materials library. CSS Grid via Mantine's SimpleGrid —
 * no flexbox percentage math. The card aspect ratio handles every breakpoint.
 */
export function MaterialGallery({ materials, onOpen }: MaterialGalleryProps) {
  return (
    <SimpleGrid
      cols={{ base: 1, sm: 2, md: 3, lg: 4 }}
      spacing="lg"
      verticalSpacing="lg"
      p="lg"
    >
      {materials.map((material) => (
        <MaterialCard key={material.id} material={material} onClick={onOpen} />
      ))}
    </SimpleGrid>
  )
}
