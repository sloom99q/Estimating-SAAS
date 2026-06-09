# `features/visualization` — FUTURE SEAM (not built in Phase 1)

Reserved slice for the 3D project-visualization module. Only the typed contract
([`contract.ts`](./contract.ts)) ships in Phase 1.

## What lands here later

A React-Three-Fiber (R3F) viewer for fit-out spaces, linked to takeoff data.

## Why Phase 1 already unblocks it

three.js/R3F is large and React-major-locked: **R3F v9 needs React 19**. Phase 1
is pinned to **React 19.2 + Mantine 9**, so the 3D module drops in as a pure
feature addition — no app-wide React/Mantine migration first. (Had we shipped on
React 18 / Mantine 8, adding 3D would have forced a full-app upgrade before a
single 3D component could mount.) Record this version triple as a hard constraint
before anyone downgrades.

## Rules that keep the seam clean

- **Lazy route, always.** Add the viewer as a code-split route so the heavy
  three.js bundle never touches the dashboard's first paint:

  ```ts
  {
    path: 'projects/:id/3d',
    lazy: async () => ({ Component: (await import('@/features/visualization/pages/ViewerPage')).ViewerPage }),
  }
  ```

- **Feature-local state.** Ephemeral viewer state (camera, selection, layer
  toggles — see `ViewerState` in the contract) lives in a Zustand store *inside
  this slice*, never in the global `session`/`ui` stores.
- **Persisted scene/takeoff data** flows through TanStack Query like any other
  server resource.
- **No core → visualization imports** (enforced by the boundary lint zones), so
  the module stays optional.
