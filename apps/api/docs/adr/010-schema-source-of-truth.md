# ADR-010: `apps/api/prisma/schema.prisma` is the live schema; root is reference

Date: 2026-06-10
Status: Accepted (architect ruling, Phase-9 Sprint-1 kickoff)

## Context

Two Prisma schemas exist in the repo:

- `prisma/schema.prisma` at the repo root — written for Phase-1 documentation.
  Targets PostgreSQL, uses `@db.Timestamptz(6)`, `@db.Decimal(p,s)`,
  `@db.Char(3)`, composite FKs `references: [organizationId, id]` everywhere.
- `apps/api/prisma/schema.prisma` — the schema the running API uses. Until
  Sprint 1 it targeted SQLite and omitted PG-specific attributes.

Drift was tolerated through Phases 8A/8B because no live deployment depended
on the root schema. Phase 9 introduces real workers + a Postgres production
target — only one of these can be the authority going forward.

## Decision

`apps/api/prisma/schema.prisma` is the **live** schema. The root
`prisma/schema.prisma` stays as a longer-form **reference** of the original
Phase-1 contract.

Phase 9 Sprint 1 brings the live schema closer to the reference by:

- Switching `provider = "postgresql"`.
- Applying `@db.Timestamptz(6)` to every `DateTime`.
- Promoting `Membership.role` from `String` to `enum MembershipRole`
  (`owner | admin | estimator | viewer`) — matching the root enum.
- Using `Decimal` on **new** money columns (Sprint 1: `Supplier.creditLimitAed`;
  Sprint 2+: every takeoff money / qty column).

Existing 8A/8B Float columns (`Material.unitPrice`, `Space.length`, etc.)
stay Float to keep the SPA wire-shape stable. Promotion to Decimal is a
follow-up cleanup, not Sprint 1.

## Consequences

- Sprint 1+ migrations originate in `apps/api/prisma/migrations/`. The root
  has no migrations folder.
- New takeoff models (Sprint 2: `Document`, `Sheet`, `TakeoffItem`,
  `ValidationFlag`; Sprint 3: `Boq`, `BoqLine`, `Assembly`,
  `AssemblyComponent`, `RateLibraryItem`, `Quotation`; Sprint 4:
  `Correction`) adopt root conventions: cuid PKs, Timestamptz(6), Decimal
  for money/qty, composite FKs where cross-refs exist, full audit columns
  (`createdAt / updatedAt / deletedAt`).
- If we need to bring the root schema back in sync at a phase boundary,
  that is a documentation update, not a migration.
- The root schema is no longer touched by Prisma tooling. It is read-only.
