# Estimator

A web-based **estimating & cost intelligence** platform for interior fit-out
companies. It helps estimators, project managers, and owners calculate
quantities, material consumption, labor costs, and quotations against a central
database of materials, suppliers, datasheets, labor profiles, and price history.

> **This repository is the Phase 1 foundation** — Login, Users, a premium
> dashboard shell, the design system, an Arabic-ready + responsive UI, and a
> reference database schema. It deliberately ships *no* future-phase features
> (materials/suppliers/estimates UI, AI extraction, 3D). It exists so those
> phases don't become a mess.

## Quick start

```bash
bun install
bun run dev
```

Open the printed URL and sign in with **any email** and the password
**`estimator`**.

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the Vite dev server |
| `bun run build` | Type-check then build for production |
| `bun run preview` | Preview the production build |
| `bun run typecheck` | `tsc -b` (no emit) |
| `bun run lint` | ESLint, incl. architecture boundary rules |

> Bun is the package manager + task runner. To run Vite through Bun's own
> runtime instead of Node, use `bunx --bun vite`.

## Stack

React 19 · Mantine 9 · TypeScript 6 · Vite 8 · Bun · react-router 7 ·
TanStack Query 5 · Zustand 5 · Zod 4 · i18next 26 · Phosphor Icons.

## What's inside

- **Premium dashboard shell** — responsive `AppShell` (desktop-first, mobile
  drawer), collapsible nav, light/dark, a warm-monochrome minimalist design
  system with monospace numerics.
- **Auth** — login form (Zod-validated), mock service, persisted session.
- **Users** — org users table with role/status.
- **Dashboard** — KPI cards + reserved layout for future charts.
- **Arabic-ready** — full English/Arabic i18n, RTL that flips the whole UI, no
  flash on load.
- **Reference DB schema** — the full estimating domain modeled in
  [`prisma/schema.prisma`](prisma/schema.prisma).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — every major decision explained.
- [`docs/database.md`](docs/database.md) — tenancy, price snapshots, RLS.
- [`CLAUDE.md`](CLAUDE.md) — working conventions & boundary rules.
- `src/features/{ai,visualization}/README.md` — future-phase seams.

## Project layout

```
src/
  app/        composition root: providers, layouts, router, guards
  features/   vertical slices: auth, users, dashboard (+ ai, visualization seams)
  shared/     reusable: ui, stores, lib (i18n/query/http), config, types, utils
  theme/      design system: tokens, component overrides, createTheme
  locales/    en/ + ar/ translations
prisma/       reference data model
docs/         architecture & database notes
```

## License

Private / unpublished.
