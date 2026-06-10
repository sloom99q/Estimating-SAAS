# Estimator API (Phase 8A)

Bun + Prisma + SQLite + JWT.

## Quick start

```bash
# from the repo root
bun run api:install      # install dependencies
cp apps/api/.env.example apps/api/.env  # adjust JWT_SECRET before deploy
bun run api:migrate      # create the SQLite db + apply migrations
bun run api:seed         # seed admin user + demo org + demo materials
bun run api:dev          # start the API on http://localhost:4000
```

Then start the SPA in another terminal:

```bash
cp .env.example .env     # VITE_API_URL=http://localhost:4000 by default
bun run dev
```

Sign in at <http://localhost:5173> with:

- **Email**: `admin@estimator.app`
- **Password**: `estimator`

## Endpoints

| Method | Path                                | Auth | Notes                                          |
| ------ | ----------------------------------- | ---- | ---------------------------------------------- |
| POST   | `/api/auth/login`                   | —    | `{ email, password }` → `Session`              |
| GET    | `/api/auth/me`                      | JWT  | Current user + org + role                      |
| GET    | `/api/projects`                     | JWT  | Org-scoped; `?includeDeleted=true` opts in     |
| GET    | `/api/projects/:id`                 | JWT  |                                                |
| POST   | `/api/projects`                     | JWT  |                                                |
| PATCH  | `/api/projects/:id`                 | JWT  |                                                |
| DELETE | `/api/projects/:id`                 | JWT  | Soft-delete; cascades to its spaces            |
| POST   | `/api/projects/:id/restore`         | JWT  |                                                |
| GET    | `/api/spaces?projectId=…`           | JWT  | `?projectId` filters; org always from JWT      |
| GET    | `/api/spaces/:id`                   | JWT  |                                                |
| POST   | `/api/spaces`                       | JWT  |                                                |
| PATCH  | `/api/spaces/:id`                   | JWT  | Updates either dimensions OR material ids      |
| DELETE | `/api/spaces/:id`                   | JWT  | Soft-delete                                    |
| POST   | `/api/spaces/:id/restore`           | JWT  |                                                |
| GET    | `/api/materials`                    | JWT  |                                                |
| GET    | `/api/materials/:id`                | JWT  |                                                |
| POST   | `/api/materials`                    | JWT  |                                                |
| PATCH  | `/api/materials/:id`                | JWT  |                                                |
| DELETE | `/api/materials/:id`                | JWT  | Soft-delete                                    |
| POST   | `/api/materials/:id/restore`        | JWT  |                                                |
| GET    | `/api/users`                        | JWT  | Org members + their membership role/status     |
| GET    | `/health`                           | —    | Liveness                                       |

Every authenticated route ignores any client-supplied `organizationId` and
scopes its query to the org embedded in the JWT.

## Architecture

- **Bun.serve** with a small handwritten router (no framework).
- **Prisma** for type-safe DB access. Schema lives in `prisma/schema.prisma`.
- **SQLite** for now; `DATABASE_URL` swap → PostgreSQL (Phase 8 final).
- **JWT** signed with `JWT_SECRET` via `jose` (HS256). 12h TTL by default.
- **bcryptjs** for password hashing (pure JS — no native compile).
- **zod** for request validation (same library the SPA already uses).

## Migrations

```bash
bun run api:migrate          # create + apply a dev migration
bun run api:generate         # regenerate the Prisma client only
cd apps/api && bunx prisma migrate reset --force   # wipe + reseed (DESTRUCTIVE)
```

Migrations live under `apps/api/prisma/migrations/`. SQLite + the dev database
files live under `apps/api/data/` and are gitignored.
