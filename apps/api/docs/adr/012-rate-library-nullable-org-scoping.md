# ADR-012: RateLibraryItem — nullable organizationId for global seed rows

Date: 2026-06-11
Status: Accepted (Sprint-3 architect ruling)

## Context

`RateLibraryItem` is the deterministic fallback in the §4.7 PRICE waterfall
(see ADR-009): when no Assembly or supplier link matches a BOQ line, the
PRICE handler tries the project org's RateLibrary, then the **global** seed
rates, then marks the line as a Provisional Sum.

The global rates are baseline market data — published Triple-A Sharjah fit-out
rates synthesised for Sprint 3 (pending architect review). Every org sees
them by default. Per-org rows live alongside them and take precedence.

Two design tensions:

1. **One row or two?** Materialising a global rate into every org as a row
   per tenant would mean tens of thousands of duplicated rows the second
   we add a tenant. We want ONE physical row.

2. **Tenant scoping.** Every other domain model carries
   `organizationId String` and gets `tenantDb()` injection. If we make
   `RateLibraryItem.organizationId` non-null and add it to `TENANT_MODELS`,
   queries would never see global rows.

## Decision

- `RateLibraryItem.organizationId` is **`String?`** (nullable).
- A NULL value means the row is **global** — every org can read it.
- A non-null value means the row is **org-private** and follows the usual
  tenant scoping rules.
- `RateLibraryItem` is **NOT** in `TENANT_MODELS` in `apps/api/src/db/tenantDb.ts`.
  Blanket scoping would inject `organizationId = :org` into every query,
  silently hiding the global rows.
- Queries that read the rate library **explicitly** scope with
  `WHERE organizationId = :orgId OR organizationId IS NULL`
  and order by `organizationId NULLS LAST` so per-org overrides take precedence.
- Queries that mutate the rate library (`POST / PATCH / DELETE`) are
  **org-private only**: they require `organizationId = ctx.organizationId`
  AND `organizationId IS NOT NULL`. The platform team manages global rows by
  seed scripts, not by API.

## Why not move global rows out of the table?

Considered:
- **Separate `GlobalRateLibraryItem` model.** Doubles the query path (two
  reads merged by the handler). Forks the type. Same problem long-term:
  per-org overrides need a join, so the merge still happens.
- **Single org-id sentinel.** Reserve `'GLOBAL'` as the magic id. Loses null
  safety; new tenant code that reads `organizationId` as a non-null cuid
  would silently misinterpret. Refused.

The nullable column is the smallest deviation: tenant code already handles
nullable FKs (e.g. `Project.spaces`), and the single SQL idiom
`WHERE organizationId = :org OR organizationId IS NULL` is easy to grep and
audit.

## Consequences

- `apps/api/src/db/tenantDb.ts` excludes `RateLibraryItem` from
  `TENANT_MODELS`. The exclusion is now PART of the file's contract — comment
  added there pointing at this ADR so the line isn't deleted by accident.
- The PRICE handler (Sprint 3) issues the union query explicitly.
- A `GET /api/rate-library` endpoint returns the union too (with a per-row
  `isGlobal` flag for the SPA).
- A small per-org index `(organizationId, code)` covers both per-org reads
  and the global query (Postgres handles `IS NULL` lookups against the index).
- If we ever need bulk-global-mutation auditability (rate hikes), we add a
  separate `RateLibraryRevision` table; the `RateLibraryItem` rows still
  represent the *current* rate.

## Test plan

- Seed 26 global rows with `organizationId = NULL`.
- Sign in as org A; GET `/api/rate-library` returns 26 rows, all
  `isGlobal=true`.
- Create one org-A override for code 'paint-emul' at a higher rate.
  GET now returns 26 rows; the 'paint-emul' row carries the org-A id and
  `isGlobal=false`.
- Sign in as org B; GET still returns 26 rows, all global (org B sees A's
  override as if it didn't exist).
