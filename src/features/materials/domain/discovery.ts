import type { Material, MaterialCategory } from './material.types'

/**
 * Pure (framework-free) material search + filter primitives. The same
 * functions back the materials library catalog AND the assign-materials
 * dialog so a material that's discoverable in one place is discoverable in
 * the other.
 */

export const USAGE_TARGETS = ['floor', 'wall', 'ceiling'] as const
export type UsageTarget = (typeof USAGE_TARGETS)[number]

/**
 * Map each material category to the surfaces it can plausibly cover. Derived
 * from typical building practice — adhesive and grout can support any surface,
 * cladding is wall-only, and gypsum is ceiling-dominant. Callers treat this as
 * a soft filter, not a constraint.
 */
const CATEGORY_USAGE: Record<MaterialCategory, ReadonlyArray<UsageTarget>> = {
  tiles: ['floor', 'wall'],
  marble: ['floor', 'wall'],
  paint: ['wall', 'ceiling'],
  gypsum: ['ceiling', 'wall'],
  glue: ['floor', 'wall', 'ceiling'],
  grout: ['floor', 'wall'],
  cladding: ['wall'],
  other: ['floor', 'wall', 'ceiling'],
}

export function categoryUsageTargets(category: MaterialCategory): ReadonlyArray<UsageTarget> {
  return CATEGORY_USAGE[category]
}

export interface MaterialFiltersInput {
  /** Free-text search across name + supplier + notes. Case-insensitive. */
  query?: string
  /** Restrict to a single category. Empty / undefined = all. */
  category?: MaterialCategory | 'all'
  /** Only show materials usable on the given surface(s). Empty = all. */
  usage?: UsageTarget | 'all'
  /** Inclusive minimum unit price. */
  minPrice?: number
  /** Inclusive maximum unit price. */
  maxPrice?: number
  /** When true, only active materials are returned. */
  activeOnly?: boolean
}

/**
 * Apply a `MaterialFiltersInput` against a list of materials. Pure — given the
 * same list + filters it always produces the same array (ordering preserved).
 */
export function filterMaterials(
  materials: ReadonlyArray<Material>,
  filters: MaterialFiltersInput,
): Material[] {
  const query = filters.query?.trim().toLowerCase() ?? ''
  const category = filters.category && filters.category !== 'all' ? filters.category : null
  const usage = filters.usage && filters.usage !== 'all' ? filters.usage : null
  const min = Number.isFinite(filters.minPrice) ? (filters.minPrice as number) : null
  const max = Number.isFinite(filters.maxPrice) ? (filters.maxPrice as number) : null
  const activeOnly = filters.activeOnly === true

  return materials.filter((material) => {
    if (activeOnly && !material.active) return false
    if (category && material.category !== category) return false
    if (usage && !CATEGORY_USAGE[material.category].includes(usage)) return false
    if (min !== null && material.unitPrice < min) return false
    if (max !== null && material.unitPrice > max) return false
    if (query) {
      const haystack = [
        material.name,
        material.supplier ?? '',
        material.notes ?? '',
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

/**
 * Derive the natural price range of a material set. Used to seed the
 * range-slider extremes in the UI so they're never arbitrary numbers.
 */
export function priceRange(materials: ReadonlyArray<Material>): { min: number; max: number } {
  if (materials.length === 0) return { min: 0, max: 0 }
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const material of materials) {
    if (material.unitPrice < min) min = material.unitPrice
    if (material.unitPrice > max) max = material.unitPrice
  }
  return {
    min: Math.floor(min),
    max: Math.ceil(max),
  }
}

/**
 * UI-facing filter state — stored locally by the page / modal that owns the
 * MaterialFinder. Kept here (in `domain/`) so it has zero React imports and
 * can be reset / serialised without a component round-trip.
 */
export interface MaterialFilterState {
  query: string
  category: MaterialCategory | 'all'
  usage: UsageTarget | 'all'
  priceRange: [number, number] | null
}

export function emptyFilterState(): MaterialFilterState {
  return { query: '', category: 'all', usage: 'all', priceRange: null }
}

export function toFiltersInput(state: MaterialFilterState): MaterialFiltersInput {
  const out: MaterialFiltersInput = {
    query: state.query,
    category: state.category,
    usage: state.usage,
  }
  if (state.priceRange) {
    out.minPrice = state.priceRange[0]
    out.maxPrice = state.priceRange[1]
  }
  return out
}
