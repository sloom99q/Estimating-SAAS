# ADR-018 — Founder admin: read counts + provision, not tenant data

**Status:** Accepted
**Date:** 2026-06-13
**Related:** Sprint 10 S10-1 (founder visibility), ADR-015 (groundtruth
discipline), ADR-016 (text-layer-first principle)

## Context

The product now has more than one tenant. The founder (today: the
owner, `admin@estimator.app`) needs a way to:

- See what tenants exist on the platform
- Provision new tenants (org + owner invite) from a single endpoint
- Audit tenant counts from the terminal at any time

…without making it easy for the founder — or any future founder — to
read another tenant's *business data* (the contents of their drawings,
their BOQ rates, their material catalogue). The dev convention used so
far (`isSuperAdmin Boolean`) was an all-or-nothing escape hatch with no
documented boundary; we close that with an explicit role + an
endpoint-scope contract.

## Decision

**Founder admin is read+provision only.**

Three concrete rules:

1. **User.platformRole** is a nullable string. `'founder'` is the only
   value the codebase recognises today. Tenant users always carry
   `platformRole = null`. The legacy `isSuperAdmin Boolean` stays in
   the schema for backwards compatibility but the new authorisation
   path goes through `platformRole`.

2. **Admin endpoints live under `/api/admin/*`** and gate through
   `requireFounder(...)` middleware in `src/middleware/auth.ts`. The
   middleware refuses anything but a fresh-from-DB
   `platformRole === 'founder'`.

3. **Admin endpoints expose counts and provisioning only.**
   - `GET /api/admin/orgs` — `[{ id, name, slug, createdAt,
     memberCount, projectCount, documentCount }]`. No tenant business
     data.
   - `POST /api/admin/orgs` — creates `Organization` + `User` +
     owner `Membership` in one transaction. No side effects on
     existing tenant data.
   - `scripts/org-report.ts` — terminal version of the same
     read-only view (plus per-project counts).

   **What's forbidden**: an admin endpoint that returns
   `/api/admin/orgs/:id/documents`, `/api/admin/orgs/:id/boqs`, or any
   other proxy that exposes a tenant's actual content. The founder
   reads tenant data the same way an employee would — by being added
   as a member of that org, with the trail visible to the customer.

## Consequences

**Trust posture for future customers.** When we onboard a paying
tenant, we can say: the founder cannot read your data without
becoming an active member of your org. That guarantee shows up in
audit logs (the `Membership` row), is reversible by the tenant
(remove the member), and degrades gracefully if a future founder
turns malicious — they'd need a recorded membership to read
anything.

**One door for "is this isolated?"** `bun apps/api/scripts/
org-report.ts` prints the tree every developer wants to see during
multi-tenant testing. No SPA flag-flipping required.

**Migration path for `isSuperAdmin`.** Keep the column for now; mark
it deprecated in code review notes. When all consumers of the boolean
have moved to `platformRole`, drop it.

## Enforcement

- **Code review** of every PR that touches `/api/admin/*` — the
  reviewer asks "does this expose tenant data, or only counts /
  provisioning?".
- **Endpoint shape**: every new admin route lives in
  `apps/api/src/routes/admin.ts` and goes through `requireFounder`.
  Reviewers refuse cross-cutting admin handlers that import from
  `routes/projects.ts`, `routes/boq.ts`, etc.
- **CLAUDE.md** picks up a short note pointing engineers to this ADR
  when they propose an `/api/admin/*` endpoint.

## Non-goals

- We are not building a full role/permission matrix. The platform
  role today is binary (`founder` or null). Tenant-level RBAC is the
  existing `Membership.role` ({owner, admin, estimator, viewer}).
- We are not adding a generic "impersonate" feature. If the founder
  needs to act as a tenant user, they should be added to that org's
  membership openly.
