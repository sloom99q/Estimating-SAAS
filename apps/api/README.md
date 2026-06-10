# Estimator API

Bun + Prisma + Postgres + JWT. Background job runner in-process via
`UPDATE … FOR UPDATE SKIP LOCKED`. Tenant isolation enforced centrally by a
Prisma client extension (`src/db/tenantDb.ts`) — application code physically
cannot forget `organizationId`.

## Quick start (Neon — zero install, recommended)

```bash
# 1. Create a free Postgres at https://neon.tech and copy the pooled DSN.
cp apps/api/.env.example apps/api/.env
# Edit DATABASE_URL = postgres://user:pass@host/db?sslmode=require

# 2. Install + migrate + seed
bun run api:install
bun run api:migrate
bun run api:seed

# 3. Run the API (background worker boots inside the same process)
bun run api:dev
```

Then start the SPA:

```bash
cp .env.example .env       # VITE_API_URL=http://localhost:4000 by default
bun run dev
```

Sign in at <http://localhost:5173> as `admin@estimator.app` / `estimator`.

## Other paths to a running Postgres

| Path        | When                                          | Command                                                              |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------- |
| **Neon**    | default; matches deploy target                | DSN from neon.tech → `DATABASE_URL` in `.env`                       |
| Supabase    | zero-install alternative                      | DSN from supabase.com → `DATABASE_URL` in `.env`                    |
| `brew`      | macOS, fully offline, no network calls        | `brew install postgresql@16 && brew services start postgresql@16`    |
| Docker      | full local stack incl. Minio (shipped, not the default) | `docker compose up -d` (uses repo-root `docker-compose.yml`) |

All four set the same `DATABASE_URL`. Nothing else in the API knows the
difference.

## Migrating SQLite (Phase 8A/8B) data into Postgres

```bash
bun apps/api/scripts/migrate-sqlite-to-postgres.ts
```

- Reads `apps/api/data/app.db` (configurable via `LEGACY_SQLITE_URL`).
- Inserts into the Postgres pointed at by `DATABASE_URL`.
- Idempotent (`upsert` by `id`).
- Prints a per-table row-count parity report. Exits non-zero on any mismatch.

After cutover, the SPA's `/materials` and `/suppliers` pages serve identical
data because both endpoints serve through the same `tenantDb` and the same
Prisma models — only the underlying engine changed.

## Endpoints

| Method | Path                                  | Auth | Sprint | Notes                                            |
| ------ | ------------------------------------- | ---- | ------ | ------------------------------------------------ |
| POST   | `/api/auth/login`                     | —    | 8A     | bcrypt verify → HS256 JWT (12h TTL)             |
| GET    | `/api/auth/me`                        | JWT  | 8A     | Current user + org + role                        |
| GET    | `/api/projects`                       | JWT  | 8A     | Org-scoped via `tenantDb`                        |
| GET    | `/api/projects/:id`                   | JWT  | 8A     |                                                  |
| POST   | `/api/projects`                       | JWT  | 8A     |                                                  |
| PATCH  | `/api/projects/:id`                   | JWT  | 8A     |                                                  |
| DELETE | `/api/projects/:id`                   | JWT  | 8A     | Soft-delete; cascades to its spaces              |
| POST   | `/api/projects/:id/restore`           | JWT  | 8A     |                                                  |
| GET    | `/api/spaces?projectId=…`             | JWT  | 8A     |                                                  |
| GET    | `/api/spaces/:id`                     | JWT  | 8A     |                                                  |
| POST   | `/api/spaces`                         | JWT  | 8A     |                                                  |
| PATCH  | `/api/spaces/:id`                     | JWT  | 8A     | Updates either dimensions OR material ids        |
| DELETE | `/api/spaces/:id`                     | JWT  | 8A     |                                                  |
| POST   | `/api/spaces/:id/restore`             | JWT  | 8A     |                                                  |
| GET    | `/api/materials`                      | JWT  | 8A     |                                                  |
| GET    | `/api/materials/:id`                  | JWT  | 8A     |                                                  |
| POST   | `/api/materials`                      | JWT  | 8A     |                                                  |
| PATCH  | `/api/materials/:id`                  | JWT  | 8A     |                                                  |
| DELETE | `/api/materials/:id`                  | JWT  | 8A     |                                                  |
| POST   | `/api/materials/:id/restore`          | JWT  | 8A     |                                                  |
| GET    | `/api/suppliers`                      | JWT  | 8B     | Preferred sorted first                           |
| GET    | `/api/suppliers/:id`                  | JWT  | 8B     |                                                  |
| POST   | `/api/suppliers`                      | JWT  | 8B     | Accepts `creditLimitAed` (ADR-009)               |
| PATCH  | `/api/suppliers/:id`                  | JWT  | 8B     |                                                  |
| DELETE | `/api/suppliers/:id`                  | JWT  | 8B     | Cascades to its price links (snapshots immortal) |
| POST   | `/api/suppliers/:id/restore`          | JWT  | 8B     |                                                  |
| GET    | `/api/material-supplier-prices?materialId=…` | JWT | 8B |                                                  |
| POST   | `/api/material-supplier-prices`       | JWT  | 8B     | Upserts link + writes snapshot in one tx         |
| PATCH  | `/api/material-supplier-prices/:id`   | JWT  | 8B     | Metadata only (preferred / MOQ / lead / notes)   |
| DELETE | `/api/material-supplier-prices/:id`   | JWT  | 8B     | Soft-delete link; snapshots stay                  |
| GET    | `/api/price-snapshots?materialId=…`   | JWT  | 8B     | Immutable history                                |
| GET    | `/api/users`                          | JWT  | 8A     | Org members + their membership role/status       |
| **POST** | **`/api/jobs/_test`**               | JWT  | **9**  | Enqueue `NOOP` or `FORCE_FAIL` (lifecycle proof) |
| **GET**  | **`/api/jobs/:id`**                 | JWT  | **9**  | Tenant-scoped job status                         |
| **GET**  | **`/api/jobs`**                     | JWT  | **9**  | Recent jobs for this org                         |
| **GET**  | **`/api/jobs/_types`**              | JWT  | **9**  | All registered handler names                     |
| **GET**  | **`/api/usage`**                    | JWT  | **9**  | Per-org metering (`pagesProcessed`, jobs…)       |
| GET    | `/health`                             | —    | 8A     | Liveness                                         |

## Phase 9 Sprint 1 — what's new

- **Postgres** is now the live engine. SQLite is retired; the migration
  script ports existing data.
- **`tenantDb(orgId)`** — Prisma client extension that injects
  `organizationId` into every read and write for tenant-owned models. Routes
  call `const db = tenantDb(ctx.organizationId)` and the extension does the
  rest. Cross-org reads are structurally impossible.
- **Background job runner** — `apps/api/src/jobs/runner.ts`. Boots inside
  the API process; claims jobs via `UPDATE … FOR UPDATE SKIP LOCKED`;
  retries with exponential backoff (2^attempt × 2s, max 3). NOOP +
  FORCE_FAIL handlers are wired; Sprint 2+ replaces the `notImplemented`
  shims with the AI takeoff pipeline.
- **BlobStore abstraction** — `apps/api/src/blob/`. Filesystem driver ships
  for dev with the same canonical key format
  (`org/{orgId}/projects/{projectId}/documents/{docId}/...`) S3 / R2 will
  use in production. Includes `exists()` for idempotent INGEST retries.
- **Usage metering** — `Usage` row per org. The runner upserts
  `jobsRun / jobsFailed` automatically; Sprint 2's CLASSIFY handler will
  bump `pagesProcessed` + `tokensIn / tokensOut`.

## ADRs

- `docs/adr/009-8b-pricing-model-supersedes-spec-2.md` — keep 8B model;
  add `Supplier.creditLimitAed`.
- `docs/adr/010-schema-source-of-truth.md` — `apps/api/prisma/schema.prisma`
  is now the live schema; root is reference.

## Worker

A second worker process can be started later by booting `src/jobs/runner.ts`
on its own; `SKIP LOCKED` makes concurrent claiming safe. For Sprint 1 the
worker runs inside the same Bun process as the HTTP server.
