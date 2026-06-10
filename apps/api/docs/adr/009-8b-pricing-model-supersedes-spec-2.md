# ADR-009: Phase-8B pricing model supersedes Phase-9 spec §2

Date: 2026-06-10
Status: Accepted (architect ruling, Phase-9 Sprint-1 kickoff)

## Context

Phase 9's procurement-takeoff spec §2 describes the database shape for
suppliers and per-material pricing as:

```prisma
model Supplier {
  // ... contact fields, paymentTermsDays, creditLimitAed
}
model SupplierPrice {
  materialId, supplierId, price, unit, preferred, validFrom
}
```

This was authored before the spec author had repo access. The repo already
contains a strictly richer model from Phase 8B (`apps/api/prisma/schema.prisma`):

- `MaterialSupplierPrice` — the live link with `isPreferred`, `leadTimeDays`,
  `minimumOrderQuantity`, `currency`, composite unique
  `(organizationId, materialId, supplierId)`.
- `PriceSnapshot` — immutable history written on every price change. The 8B
  ruling was: "prices must never overwrite history".

Adopting spec §2 literally would (a) lose `isPreferred` as a per-material
flag, (b) lose MOQ + lead-time on the price link, (c) destroy the entire
`PriceSnapshot` history table.

## Decision

**Keep the 8B model. Spec §2 is shorthand for the pricing engine's consumer
shape, not a directive to replace the persistence layer.**

Specifically:

1. `MaterialSupplierPrice` + `PriceSnapshot` stay as authoritative. No
   schema deletes; no rename to `SupplierPrice`.
2. `Supplier` gains `creditLimitAed Decimal? @db.Decimal(14, 2)` — this was
   in the original phase brief and absent from 8B. Sprint 1 adds it via the
   `init_postgres` migration.
3. The §4.7 rate-resolution waterfall is amended to read:
   org Assembly → `MaterialSupplierPrice WHERE isPreferred = true` →
   cheapest current `MaterialSupplierPrice.unitPrice` → org
   `RateLibraryItem` → global seed → P/S.
4. `PriceSnapshot` is also the future substrate for takeoff rate calibration
   (spec §7 — confidence rubric needs price stability over time). Do not
   redesign it for that now; just do not break it.

## Consequences

- `apps/api/prisma/schema.prisma` ships Sprint 1 with the 8B model intact +
  `creditLimitAed` added. The legacy `prisma/schema.prisma` at the repo root
  stays as the longer-form reference contract (see ADR-010).
- Sprint 3's PRICE handler reads from `MaterialSupplierPrice`. It does not
  read from a `SupplierPrice` table — that table does not exist and will
  not be created.
- Spec §2 paragraph defining `Supplier` and `SupplierPrice` is officially
  superseded by this ADR and the live `apps/api/prisma/schema.prisma`.
