# CLAUDE.md

Guidance for working in this repo. Full rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What this is

Estimator — a web SAAS for interior fit-out **estimating & cost intelligence**.
This is the **Phase 1 foundation**: Login, Users, Dashboard, design system,
Arabic-ready + responsive shell, and a reference DB schema. Future phases
(materials/suppliers/estimates UI, AI, 3D) are **not built** — only supported.

## Stack

React 19.2 · Mantine 9.3 · TypeScript 6 (strict) · Vite 8 · Bun · react-router 7
(data router) · TanStack Query 5 · Zustand 5 · @mantine/form + Zod 4 · i18next 26
· @phosphor-icons/react. UI is **Mantine, not Tailwind**.

## Commands

```bash
bun install
bun run dev         # vite dev server
bun run build       # tsc -b && vite build
bun run typecheck   # tsc -b
bun run lint        # eslint (includes architecture boundary rules)
```

Demo login: any email + password `estimator`.

## Architecture rules (enforced by ESLint — see eslint.config.js)

Dependency direction is one-way: **`app → features → shared → theme`**.

- `theme/` imports nothing but Mantine + its own tokens.
- `shared/` must not import `features/` or `app/`.
- `features/*` must not import `app/` or **other features**. Use **relative**
  imports *within* a slice; lift cross-feature contracts to `shared/types`.
- `**/domain/` is framework-free: only `zod` + pure TS (no react/mantine/router/
  query/zustand/i18next).

These fail CI, not just review. Don't work around them — they're the whole point
of Phase 1 ("so future phases don't become a mess").

## Where things live

- New capability → new folder under `src/features/<name>/` with
  `api/ components/ domain/ hooks/ pages/ index.ts`.
- Reusable UI → `src/shared/ui/`. Design tokens/overrides → `src/theme/`.
- **Session/identity is in `shared/store/sessionStore.ts`**, not the auth feature
  (it's cross-cutting). The auth feature only *writes* it; everyone else reads via
  `useSession()/useCurrentUser()/useCan()`.
- Routes → `src/app/router/router.tsx`; paths → `paths.ts`. Page modules are
  lazy-imported **directly** (not via a feature barrel) to keep chunks clean.
- Data model → `prisma/schema.prisma` (reference; no backend in Phase 1).

## Conventions / gotchas

- **No hardcoded hex** in components — use theme tokens / `--app-*` CSS vars.
- Numerics use the `.app-numeric` class (mono + `tabular-nums`, forced LTR).
- `Intl` formatters are pinned to Western digits (`latn`) even in Arabic; currency
  is a per-org setting, not per-locale. Use `shared/utils/format.ts`.
- i18n: never hardcode strings — add keys to `src/locales/{en,ar}/<ns>.json`.
  Direction is driven by i18next → don't set `dir` manually elsewhere.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports.
- `exactOptionalPropertyTypes` is on: don't pass `prop={cond ? x : undefined}` —
  render conditionally instead.
- Forms: define the Zod schema in `domain/` (pure), wire it via `useZodForm`
  (shared) in the component — never put the resolver in `domain/`.
- Money is a decimal **string** + currency; never `Number()` it for math.

## Secrets (Sprint-9 S9-4) — HARD RULE

`apps/api/.env.secrets` holds `ANTHROPIC_API_KEY` (and any future
credentials). Loaded by `apps/api/src/config.ts` after `process.env` so
shell exports still win. **Automated sessions never read, print, edit,
grep, or `cat` this file** — not for "just checking", not redacted, not
into a tmp file. The key in your context is a key in your context.

The only allowed operations are:
- Reference its existence in prose ("the key lives in `.env.secrets`")
- Confirm whether the file is present (`ls`/`test -f`, output is
  filename only)
- Tell the owner to add / rotate / remove a value, by hand

`AI_MODE`, model overrides, DSNs, ports, and other non-secret config
stay in `.env` — that file is fine to read and edit.

## Future seams (don't implement unless asked)

`features/ai` and `features/visualization` are typed contracts + READMEs only.
AI is an async-**job** contract; 3D is a lazy route with feature-local state.
