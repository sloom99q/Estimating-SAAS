import type { MaterialCategory } from './material.types'

/**
 * Pure (framework-free) visual vocabulary for material categories. Maps each
 * category to a Mantine theme color name + an SVG pattern key. NO hardcoded
 * hex values here — components resolve the color name through Mantine and the
 * pattern key through `CategoryTexture` so light/dark mode flips automatically.
 *
 * The `accent` color is also the `Badge` color used in `MaterialCategoryBadge`,
 * so the entire visual identity of a category — chip, swatch, plan tint — is
 * defined in one place.
 */
export type CategoryPattern =
  | 'grid' // crisp 4×4 grid — tiles
  | 'veined' // organic vein hint — marble
  | 'wash' // flat colour wash — paint
  | 'panel' // wide-spaced horizontal lines — gypsum panels
  | 'dots' // small dotted matrix — adhesive
  | 'lines' // tight horizontal lines — grout
  | 'planks' // vertical board hint — cladding
  | 'solid' // flat colour — other

export interface CategoryVisual {
  /** Mantine theme color name; consumed by Badge / ThemeIcon / swatches. */
  accent: 'info' | 'gray' | 'warn' | 'ink' | 'success' | 'danger'
  pattern: CategoryPattern
}

const VISUALS: Record<MaterialCategory, CategoryVisual> = {
  tiles: { accent: 'info', pattern: 'grid' },
  marble: { accent: 'gray', pattern: 'veined' },
  paint: { accent: 'warn', pattern: 'wash' },
  gypsum: { accent: 'ink', pattern: 'panel' },
  glue: { accent: 'success', pattern: 'dots' },
  grout: { accent: 'danger', pattern: 'lines' },
  cladding: { accent: 'info', pattern: 'planks' },
  other: { accent: 'gray', pattern: 'solid' },
}

export function categoryVisual(category: MaterialCategory): CategoryVisual {
  return VISUALS[category]
}
