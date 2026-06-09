/**
 * FUTURE SEAM — 3D visualization module. NOT implemented in Phase 1.
 *
 * Types-only. Reserves where a React-Three-Fiber viewer plugs in. Constraints
 * (see features/visualization/README.md):
 *  - Routes are lazy chunks so the heavy three.js bundle never touches first paint.
 *  - Ephemeral viewer state lives in a feature-local store, never the global stores.
 *  - Persisted scene/takeoff data flows through TanStack Query like any resource.
 *  - The React 19 baseline chosen in Phase 1 lets R3F v9 drop in with no migration.
 */
import type { ID } from '@/shared/types'

export interface SceneRef {
  projectId: ID
  sceneId: ID
}

export type Vec3 = [number, number, number]

export interface ViewerState {
  camera: { position: Vec3; target: Vec3 }
  selectedElementId: ID | null
  visibleLayers: string[]
}
