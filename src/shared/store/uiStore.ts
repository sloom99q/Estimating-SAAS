import { create } from 'zustand'
import { env } from '@/shared/config/env'

/**
 * Ephemeral UI preferences. Kept separate from the session store so a
 * high-churn toggle (collapsing the nav) never re-renders auth consumers or
 * rewrites the session blob. Color scheme is owned by Mantine's color-scheme
 * manager and language by i18next — they intentionally do NOT live here.
 */
export type MaterialsView = 'gallery' | 'table'
export type SpacesView = 'cards' | 'table'

interface UiState {
  /** Desktop nav rail collapsed to icons-only. */
  navCollapsed: boolean
  toggleNav: () => void
  setNavCollapsed: (collapsed: boolean) => void
  /** Materials library presentation: visual cards (default) or dense table. */
  materialsView: MaterialsView
  setMaterialsView: (view: MaterialsView) => void
  /** Spaces presentation inside the workspace: editorial cards or dense table. */
  spacesView: SpacesView
  setSpacesView: (view: SpacesView) => void
  /**
   * Dev-only switch: when on, every cost number in the workspace renders a
   * `material:…` or `default:…` tag showing exactly where the rate came from.
   * The toggle button is rendered only in dev; the consumer hook
   * `useCostTraceEnabled` ALSO clamps to `false` in production builds so any
   * code path is automatically prod-safe even if the store ever leaks `true`.
   */
  costTraceEnabled: boolean
  toggleCostTrace: () => void
}

export const useUiStore = create<UiState>((set) => ({
  navCollapsed: false,
  toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
  setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
  materialsView: 'gallery',
  setMaterialsView: (materialsView) => set({ materialsView }),
  spacesView: 'cards',
  setSpacesView: (spacesView) => set({ spacesView }),
  costTraceEnabled: false,
  toggleCostTrace: () => set((s) => ({ costTraceEnabled: !s.costTraceEnabled })),
}))

export const useNavCollapsed = (): boolean => useUiStore((s) => s.navCollapsed)
export const useMaterialsView = (): MaterialsView => useUiStore((s) => s.materialsView)
export const useSpacesView = (): SpacesView => useUiStore((s) => s.spacesView)
/** Always false in production builds — defends against any leaked toggle state. */
export const useCostTraceEnabled = (): boolean =>
  useUiStore((s) => (env.isDev ? s.costTraceEnabled : false))
