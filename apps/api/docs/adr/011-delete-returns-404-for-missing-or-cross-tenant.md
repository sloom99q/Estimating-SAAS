# ADR-011: DELETE returns 404 for missing or cross-tenant rows

Date: 2026-06-11
Status: Accepted (Sprint-1 architect review, applied at Sprint-2 kickoff)

## Context

Through Sprints 8A/8B and Phase 9 Sprint 1, `DELETE /api/<resource>/:id` returned
**204 No Content** in every case — when the row existed and was soft-deleted,
*and* when the row was missing, already deleted, or owned by another tenant.
`PATCH /api/<resource>/:id`, in contrast, returned **404** for the same
missing / cross-tenant cases.

That inconsistency was flagged by the architect during Sprint-1 review. Two
problems:

1. **Mixed signal to clients.** A SPA action that deletes a row it just listed
   *should* succeed; one targeting a stale id *should* tell the user why. The
   old 204 swallowed every difference.
2. **Silent cross-tenant probe.** Org A could `DELETE /api/projects/<orgB-id>`
   and get a 204 back. The row was untouched (the tenant extension scoped the
   `where`), but the response was indistinguishable from a real delete. Useful
   for an attacker scanning for ids that *would* delete in their own org.

## Decision

`DELETE /api/<resource>/:id` returns:

- **204 No Content** when the row was successfully soft-deleted (the row
  existed, belonged to the caller's tenant, and was not already deleted).
- **404 Not Found** with `{ error: '<Resource> not found' }` when the id is
  missing, already soft-deleted, or owned by another tenant.

This matches `PATCH` exactly. Applied to all five Sprint-1 resources today:
projects, spaces, materials, suppliers, material-supplier-prices. Sprint-2
resources (documents, takeoff items, etc.) adopt the same shape from day one.

## Why the unified 404 (not 403)

We deliberately collapse "row doesn't exist" and "row exists but isn't yours"
into the same 404. Distinguishing them would leak ownership information across
tenants — an org B id would 403, a random id would 404, and an attacker could
enumerate which ids exist in other orgs. The tenant extension already filters
the lookup, so the route handler *can't* tell the two cases apart; we keep
that property.

## Consequences

- All five DELETE handlers updated in this commit; each carries a comment
  pointing back to this ADR.
- The cross-tenant isolation test from Sprint 1 DoD #2 changes its expectation:
  org A's DELETE against org B's project now returns **404** instead of 204.
  The data-side outcome (org B's row untouched) is unchanged.
- Resources created in Sprint 2+ are required to follow this shape.
- A successful DELETE still returns 204 with empty body (RFC 7231 §6.3.5).
