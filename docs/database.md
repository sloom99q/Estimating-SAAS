# Database structure

The canonical model is [`prisma/schema.prisma`](../prisma/schema.prisma). This
note explains the decisions that aren't obvious from the schema text. No backend
runs in Phase 1 — the schema is the **foundation** so Phase 2+ slot in without
migrating live tenant data.

## Multi-tenancy: shared database, shared schema

Every tenant-scoped row carries `organizationId`. This is the simplest model to
operate and the 2026 SAAS default. Three layers of isolation:

1. **App layer** — every query is org-scoped. On the frontend, the query-key
   factory ([`src/shared/lib/query/queryKeys.ts`](../src/shared/lib/query/queryKeys.ts))
   namespaces every cache entry by `org` so cached data can't bleed across
   tenants. The future API sets the org from the session, not the request body.
2. **Schema layer** — cross-tenant references are made *structurally impossible*
   with **composite foreign keys**: children reference `[organizationId, id]` of
   the parent (see `SupplierMaterial`, `EstimateLineItem`). A row in org A
   physically cannot reference a row in org B.
3. **Database layer (backstop)** — Postgres **Row-Level Security**. App code will
   eventually have a bug; RLS makes a leak impossible even then:

   ```sql
   ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON estimates
     USING (organization_id = current_setting('app.current_org')::text);
   ```

   The API sets `app.current_org` per transaction (Prisma client extension);
   platform-support uses a `BYPASSRLS` role.

## Money & quantities are `Decimal`, never `Float`

An estimate is a commercial/legal artifact. Floats drift across thousands of line
items and break total reconciliation. Every price/quantity column is
`Decimal(p, s)`; `Float` and the Postgres `money` type are banned. **Prisma
returns `Decimal` as a Decimal.js instance, not a JS number** — the frontend
formatters ([`format.ts`](../src/shared/utils/format.ts)) accept strings and only
parse for *display*; never `Number()` a decimal for math.

## Price snapshots (the #1 estimating-tool risk)

`EstimateLineItem` stores **frozen** `*_snapshot` columns (unit price, currency,
material/supplier name, uom, fx rate, line total) captured at estimate time. The
`source_*` FKs exist for traceability only and are **never read for math**. This
guarantees that editing a supplier price tomorrow cannot silently rewrite a
quotation sent to a client last week.

## Currency

Currency is **per-organization and per-document**, not per-locale (an Arabic user
may estimate in USD/SAR/AED). When a line pulls a price in a different currency
than the estimate, `fxRateSnapshot` + capture time are stored so historical
conversions stay reproducible.

## Units of measure

Fit-out estimating constantly converts purchase → consumption units (tiles per
box → m², paint per tin → m² at a coverage rate). `UnitOfMeasure` +
`UnitConversion` + per-material `purchaseUomId`/`consumptionUomId` model this so
takeoff math is deterministic, not hardcoded.

## Soft delete + audit + partial unique indexes

Tenant tables carry `createdAt/updatedAt/deletedAt`. Uniqueness that must coexist
with soft delete (e.g. supplier `code`) needs a **partial unique index** so a
deleted code can be reused. Prisma can't express partial indexes natively, so
these are added as raw-SQL migrations:

```sql
CREATE UNIQUE INDEX suppliers_org_code_live
  ON suppliers (organization_id, code) WHERE deleted_at IS NULL;
```

`AuditLog` records actor, entity, action and a JSON `diff`.

## IDs & time

`cuid()` string PKs (sortable, and they don't leak per-tenant row counts the way
sequential integers would). All timestamps are `Timestamptz(6)` (UTC).

## What Phase 1 actually uses

Only `Organization`, `User`, `Membership` are exercised — and only through the
mock service. The rest is modeled now precisely so the estimating/AI/3D phases
don't trigger a foundation rewrite.
