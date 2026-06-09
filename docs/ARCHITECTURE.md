# Estimator — Phase 1 Architecture

Web SAAS for interior fit-out **estimating & cost intelligence**. This document
explains every major architectural decision in the Phase 1 foundation.

> **Phase 1 scope:** Login, Users, Dashboard layout, Database (reference schema),
> Design system, Arabic-ready architecture, Responsive UI. Nothing from future
> phases (materials/suppliers/estimates UI, AI, 3D) is built — only *supported*.

---

## 0. Design skill & design read

The project ships several taste-skills. The right fit for a premium B2B dashboard
is **`minimalist-ui`** ("Premium Utilitarian Minimalism & Editorial UI"). The
others were rejected on scope: `design-taste-frontend` is explicitly *"not for
dashboards / data tables"* and Tailwind-based; `brandkit`/`imagegen-*` are
image-generation skills, not app architecture.

**Design read:** *internal B2B estimating dashboard for estimators & owners, in a
premium-utilitarian minimalist language — warm monochrome canvas, white surfaces,
hairline borders, near-zero shadows, and monospace tabular numerals* (an
estimating tool is mostly numbers).

The skill's language is translated into a **Mantine theme** (not Tailwind),
because the stack is Mantine. See §4.

---

## 1. Stack & why

| Concern | Choice | Why |
|---|---|---|
| UI | **React 19.2** + **Mantine 9.3** | Mantine 9 *requires* React 19.2; choosing it now also unblocks R3F v9 (3D) later with zero migration. |
| Build | **Vite 8** + **Bun** | Bun = package manager + task runner; Vite = the documented Mantine host. |
| Language | **TypeScript 6** (strict+) | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` — a data-heavy domain rewards tight types. |
| Routing | **react-router 7** (data router) | `createBrowserRouter` + native `route.lazy` code-splitting. v7 imports from `react-router` (not `react-router-dom`). |
| Server state | **TanStack Query 5** | Caching, org-scoped keys, native job-polling for future AI. |
| Client state | **Zustand 5** | Session + UI prefs, with `partialize` persist and atomic selectors. |
| Forms | **@mantine/form 9** + **Zod 4** | Built-in schema validation; our `useZodForm` keeps the resolver out of `domain/`. |
| i18n | **i18next 26** + react-i18next | Per-feature namespaces; `i18n.dir()` drives RTL. |
| Icons | **@phosphor-icons/react** | Per the skill (thicker, technical) over thin-line sets. |

Every version was verified against the live registry/docs (the original brief
said "Mantine v7+" — the current stable is **9.3.1**; building on v7 would have
seeded a two-major migration on day one).

---

## 2. Folder structure

Feature-based **vertical slices** + **clean-architecture** layering. Dependency
direction is one-way: **`app → features → shared → theme`**.

```
src/
├── app/                      # Composition root — wires everything together
│   ├── providers/            #   AppProviders = I18n → Theme(Mantine+RTL) → Query
│   ├── layouts/              #   DashboardLayout (AppShell), AuthLayout
│   └── router/               #   createBrowserRouter, paths.ts, guards/, NotFoundPage
│
├── features/                 # Vertical slices — one folder per capability
│   ├── auth/                 #   login flow (writes the shared session)
│   ├── users/                #   users list
│   ├── dashboard/            #   KPI dashboard
│   ├── ai/                   #   FUTURE SEAM — contract.ts + README only
│   └── visualization/        #   FUTURE SEAM — contract.ts + README only
│        ├── api/             #   transport (Promise) + query/mutation hooks
│        ├── components/      #   feature-bound UI
│        ├── domain/          #   types + zod schemas + pure logic (framework-free)
│        ├── hooks/  store/    #   feature state
│        ├── pages/           #   route entry components
│        └── index.ts         #   public barrel (NOT used for lazy pages)
│
├── shared/                   # Feature-agnostic, reusable
│   ├── ui/                   #   design-system components (Logo, StatCard, …)
│   ├── store/                #   sessionStore (identity), uiStore (nav)
│   ├── lib/                  #   i18n, query (client + key factory), http client
│   ├── config/  types/  utils/  hooks/
│
├── theme/                    # Design system — single source of truth
│   ├── tokens/               #   colors, typography, radius, spacing, shadows
│   ├── components.ts         #   Mantine Component.extend overrides
│   ├── cssVariablesResolver.ts
│   └── index.ts              #   createTheme()
│
└── locales/{en,ar}/*.json    # Translations, one namespace per feature
```

### Why this shape

- **Vertical slices** mean a new capability (estimates, suppliers, AI, 3D) is a
  whole new folder — you never thread it through a layered `controllers/services/
  views` tree. Adding a phase touches *one* directory.
- **`domain/` is the dependency sink**: types, Zod schemas, pure logic — no React,
  no Mantine, no router. Business rules stay portable and testable.
- **`app/` is the only composer.** It may import features (to mount their pages)
  and shared. Features and shared never import `app`.

### Enforced, not just documented

The single biggest rot risk in slice architectures is silent boundary erosion.
ESLint zones ([`eslint.config.js`](../eslint.config.js)) make the rules *fail CI*:

| Layer | May NOT import |
|---|---|
| `theme/` | features, app, shared |
| `shared/` | features, app |
| `features/*` | app, **other features** (use relative within a slice; lift shared contracts to `shared/types`) |
| `**/domain/` | react, @mantine, react-router, @tanstack, zustand, i18next, app, features |

Verified live: a `shared → feature` import and a `domain → react` import both
error. Cross-feature sharing goes through `shared/types` (type-only) — which is
exactly why the **session** lives in shared (next section).

---

## 3. Session, RBAC & state management

### Where session lives — and why it's in `shared`, not `auth`

The **auth feature** owns the *login flow* (form, schema, mock API, mutation).
But the **session** (who am I, my org, my role) is read by guards, the layout,
and every future feature. If it lived in `features/auth`, everyone would need a
cross-feature import — which the boundary lint forbids.

So the **session store lives in `shared/store/sessionStore.ts`**; the auth
feature merely *writes* it on successful login. Guards/layout/features *read* it
via `useSession()` / `useCurrentUser()` / `useCan()`. This is the clean resolution
of "auth is a feature, but identity is infrastructure."

### State layering

| State kind | Tool | Notes |
|---|---|---|
| Server cache | TanStack Query | org-scoped keys; `staleTime 60s`; **no retry on 4xx**; devtools dev-only + lazy. |
| Identity/session | Zustand (`sessionStore`) | persisted; `partialize` stores only the raw session — derived `isAuthenticated`/permissions are **selectors**, so they can't desync on rehydrate. |
| UI prefs | Zustand (`uiStore`) | separate store so a nav toggle never re-renders auth consumers. |
| Color scheme | **Mantine's** color-scheme manager | single owner — *not* duplicated in Zustand. |
| Language | **i18next** | owned by the language detector. |
| Local UI | `useState` | — |
| Forms | `@mantine/form` + Zod | via `useZodForm`. |

RBAC: `Role → Permission` policy in `shared/lib/rbac.ts`, surfaced as `useCan()`.
The nav hides items the user can't access; the reference DB models org-scoped
`Membership` roles (a scalar `user.role` couldn't express multi-org membership).

---

## 4. Design system

The `minimalist-ui` language, encoded as Mantine tokens — so feature code never
hardcodes a hex or a radius.

- **Color** — warm monochrome. A custom near-black **`ink`** scale is the
  `primaryColor` (buttons land on `ink[8]`, `autoContrast` guarantees readable
  text). Semantic hues (`success/warn/danger/info`) are **muted pastels** used
  only on badges/statuses. Surface tokens are mapped onto Mantine's CSS variables
  by [`cssVariablesResolver.ts`](../src/theme/cssVariablesResolver.ts): bone
  canvas (`--app-canvas`) behind white surfaces (`--mantine-color-body`) with
  hairline `#eaeaea` borders. Full light **and** dark schemes.
- **Type** — **Geist** (a non-Inter geometric sans) for UI, **Geist Mono** for
  numerics/IDs/currency, **IBM Plex Sans Arabic** appended to every stack so
  Arabic renders without conditional font logic. All self-hosted via Fontsource.
- **Shape & elevation** — crisp radii (6–8px, no pills on big containers);
  near-zero, ink-tinted shadows. Elevation = hairline border, not drop shadow.
- **Components** — `Component.extend` overrides ([`components.ts`](../src/theme/components.ts))
  bake the language in: flat bordered cards, restrained buttons, light pastel
  badges, subtle action icons.
- **CSS layers** — Mantine is imported via `*.styles.layer.css`; our `global.css`
  declares `@layer mantine, app-base` so overrides always win regardless of
  import order.

### Numerals & currency policy (an estimating-tool decision)

`Intl` is pinned to `numberingSystem: 'latn'` in **every** locale, including
Arabic. A B2B estimating tool wants Western digits in both languages so numeric
columns stay aligned/scannable; Latin monospace also has no Arabic glyphs.
Alignment comes from `tabular-nums` (the `.app-numeric` class), and currency is
decoupled from UI language (it's a per-org setting). See
[`format.ts`](../src/shared/utils/format.ts).

---

## 5. Routing

`createBrowserRouter` (data router). Paths are centralized in
[`paths.ts`](../src/app/router/paths.ts).

```
PublicOnlyRoute → AuthLayout
  /login                     (lazy)
ProtectedRoute → DashboardLayout
  /            → redirect to /dashboard
  /dashboard                 (lazy)
  /users                     (lazy)
*  → NotFoundPage
```

- **Guards** are tiny route elements that read the shared session and `<Navigate>`
  (preserving the intended path on login redirect).
- **Layouts render eagerly; pages are lazy** via the data-router-native
  `route.lazy` — so the shell paints instantly while the page chunk loads. Routes
  import page modules *directly* (not through a feature barrel) to keep the
  code-split boundary clean. The production build confirms one chunk per page.

---

## 6. Component architecture

Three tiers, by reusability:

1. **`shared/ui`** — design-system primitives/molecules built on Mantine
   (`Logo`, `PageHeader`, `StatCard`, `EmptyState`, `ThemeToggle`,
   `LanguageToggle`, `DirectionalIcon`). Feature-agnostic, fully reusable.
2. **`features/*/components`** — feature-bound compositions (`LoginForm`,
   `UsersTable`, `StatsGrid`).
3. **`app/layouts`** — page shells (`DashboardLayout`'s AppShell + Sidebar +
   Header; `AuthLayout`).

Conventions: pages compose, components present, hooks/`api` hold logic. Container
vs presentational is respected — data enters at the leaf that needs it via a
query hook, never prop-drilled from the page. Phosphor defaults (size/weight) are
set once via `IconContext` at the root.

---

## 7. Arabic-ready architecture (RTL)

Designed in now because retrofitting a built UI is the expensive path; *adding*
Arabic to a key-driven app is trivial.

- **One source of truth for direction.** i18next's `dir()` resolves `ar → rtl`.
  `I18nProvider` sets `document.documentElement.dir/lang` on language change;
  Mantine's `DirectionProvider` (wrapping `MantineProvider`) auto-follows the
  `dir` attribute and flips the whole UI. We never set direction in two places.
- **No flash.** `index.html` runs a pre-paint script that sets `dir`/`lang` and
  the color scheme from localStorage before React mounts.
- **Logical everything.** Mantine ships RTL styles; our CSS uses logical
  properties. Directional glyphs (carets/arrows) are mirrored via the
  `DirectionalIcon` wrapper (Mantine flips layout but not icon SVGs).
- **Keys, not strings.** All copy is i18n keys in per-feature namespaces
  (`common/auth/dashboard/users`), with full `en` **and** `ar` bundles shipped.
- **Locale-aware formatting** centralized in `format.ts`.

---

## 8. Future-proofing (without building it)

- **Database** — the full domain (suppliers, materials, datasheets, price lists,
  labor, projects, estimates, line-items, quotations, audit) is modeled now as a
  reference schema with price snapshots, composite tenant FKs, decimals, UoM
  conversions, and an RLS plan. See [`database.md`](./database.md). Phase 1's UI
  touches only org/users via the mock service.
- **Backend seam** — `auth.api.ts` is mock transport with the exact
  `Promise<Session>` shape the real API returns; `shared/lib/http/client.ts` is a
  thin core with per-request overrides (timeout/baseUrl/signal) ready for it.
- **AI** — typed async-**job** contract + rules in
  [`features/ai`](../src/features/ai/README.md). No code, just the seam.
- **3D** — typed viewer contract + lazy-route/feature-local-state rules in
  [`features/visualization`](../src/features/visualization/README.md). The React
  19 baseline is what makes R3F v9 drop-in.

---

## 9. Verification

The whole Phase 1 foundation **type-checks, builds, lints, and self-enforces its
own architecture**:

```
bun run typecheck   # tsc -b  → 0 errors
bun run build       # vite build → ok, pages code-split into separate chunks
bun run lint        # eslint → 0 errors; boundary violations fail (verified)
```
