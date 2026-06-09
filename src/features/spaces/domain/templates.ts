/**
 * Pure catalogue of space templates. Reads like a small "starter pack" so a
 * new project can be roughed-out in a few clicks. Each template carries:
 *
 *   - a stable `id` (for keyed React lists and analytics)
 *   - i18n keys (resolved at render time)
 *   - default dimensions in metres
 *   - a soft hint of which material category fits each surface — the assign
 *     dialog can use these later to highlight a suggested category, but the
 *     user always picks the actual Material.
 *
 * Framework-free: no react, no mantine, no i18next. The picker UI imports
 * this catalogue and resolves labels via its own translator.
 */

export type SpaceTemplateCategoryHint = 'tiles' | 'marble' | 'paint' | 'gypsum' | 'cladding'

export interface SpaceTemplate {
  id: string
  /** i18n key under `spaces:templates.<id>.name`. */
  nameKey: string
  /** i18n key under `spaces:templates.<id>.subtitle`. */
  subtitleKey: string
  /** Default length × width × height in metres. */
  dimensions: { length: number; width: number; height: number }
  /**
   * Soft category suggestions per surface. Optional — when present the
   * assign dialog can pre-highlight materials in that category.
   */
  suggested: {
    floor: SpaceTemplateCategoryHint | null
    wall: SpaceTemplateCategoryHint | null
    ceiling: SpaceTemplateCategoryHint | null
  }
}

export const SPACE_TEMPLATES: ReadonlyArray<SpaceTemplate> = [
  {
    id: 'bedroom-small',
    nameKey: 'bedroom-small.name',
    subtitleKey: 'bedroom-small.subtitle',
    dimensions: { length: 3.2, width: 2.8, height: 2.7 },
    suggested: { floor: 'tiles', wall: 'paint', ceiling: 'paint' },
  },
  {
    id: 'bedroom-medium',
    nameKey: 'bedroom-medium.name',
    subtitleKey: 'bedroom-medium.subtitle',
    dimensions: { length: 4, width: 3.6, height: 2.8 },
    suggested: { floor: 'tiles', wall: 'paint', ceiling: 'paint' },
  },
  {
    id: 'bedroom-luxury',
    nameKey: 'bedroom-luxury.name',
    subtitleKey: 'bedroom-luxury.subtitle',
    dimensions: { length: 5.5, width: 4.5, height: 3 },
    suggested: { floor: 'marble', wall: 'cladding', ceiling: 'gypsum' },
  },
  {
    id: 'living-room',
    nameKey: 'living-room.name',
    subtitleKey: 'living-room.subtitle',
    dimensions: { length: 6, width: 4.5, height: 2.9 },
    suggested: { floor: 'marble', wall: 'paint', ceiling: 'gypsum' },
  },
  {
    id: 'bathroom',
    nameKey: 'bathroom.name',
    subtitleKey: 'bathroom.subtitle',
    dimensions: { length: 2.5, width: 1.8, height: 2.6 },
    suggested: { floor: 'tiles', wall: 'tiles', ceiling: 'paint' },
  },
  {
    id: 'office',
    nameKey: 'office.name',
    subtitleKey: 'office.subtitle',
    dimensions: { length: 4.2, width: 3.5, height: 2.8 },
    suggested: { floor: 'tiles', wall: 'paint', ceiling: 'gypsum' },
  },
  {
    id: 'retail',
    nameKey: 'retail.name',
    subtitleKey: 'retail.subtitle',
    dimensions: { length: 8, width: 6, height: 3.4 },
    suggested: { floor: 'marble', wall: 'cladding', ceiling: 'gypsum' },
  },
]

export function findTemplate(id: string): SpaceTemplate | null {
  return SPACE_TEMPLATES.find((template) => template.id === id) ?? null
}
