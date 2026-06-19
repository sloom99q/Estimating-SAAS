# ADR-013: Fair-claim — round-robin across organizations

Date: 2026-06-11
Status: Accepted (Sprint-3 architect review of Sprint-2 — SaaS-fairness fix)

## Context

Sprint 1's worker claim ordered ALL queued jobs globally:

```sql
SELECT id FROM "jobs"
WHERE status = 'QUEUED'
  AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
ORDER BY "createdAt" ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

That's correct for a single-tenant queue: oldest first. But Estimator is
multi-tenant — every job carries `organizationId`. Under global-FIFO, an org
that uploads 50 documents at 10:00:00 will keep the worker(s) busy for
minutes; an org that uploads ONE document at 10:00:05 sits behind all 50
jobs from the noisy org.

In a SaaS product where every tenant pays the same per-page rate, that's a
fairness failure — and a tail-latency disaster for small tenants.

## Decision

The Sprint-3 worker tick claims by **round-robin across orgs with due work,
weighted by recency of service**. SQL:

```sql
WITH due_jobs AS (
  SELECT id, "organizationId", "createdAt"
  FROM "jobs"
  WHERE status = 'QUEUED'
    AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
),
org_last_served AS (
  SELECT d."organizationId",
         COALESCE(MAX(j."startedAt"), 'epoch'::timestamptz) AS last_started
  FROM (SELECT DISTINCT "organizationId" FROM due_jobs) d
  LEFT JOIN "jobs" j
    ON j."organizationId" = d."organizationId"
   AND j."startedAt" IS NOT NULL
  GROUP BY d."organizationId"
),
fair_org AS (
  SELECT "organizationId" FROM org_last_served
  ORDER BY last_started ASC
  LIMIT 1
)
UPDATE "jobs"
SET status='RUNNING', "startedAt"=NOW(), attempts=attempts+1
WHERE id = (
  SELECT id FROM due_jobs
  WHERE "organizationId" = (SELECT "organizationId" FROM fair_org)
  ORDER BY "createdAt" ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

Interpretation:
- `due_jobs` — every queued job whose `scheduledFor` has passed.
- `org_last_served` — for each org with due work, when was its **most recent
  claim** (across all its jobs of any status). Never-served orgs sort at
  `'epoch'`.
- `fair_org` — the org whose last claim is the **earliest** wins this tick.
- Within that org, take the oldest queued job. Same `FOR UPDATE SKIP LOCKED`
  so concurrent workers can't collide.

Net effect: when 1 org has 50 jobs and another has 1, the tick alternates
between them — the 1-job org gets its job within a few worker ticks, not 50.

## Why not weighted-fair / per-org quotas?

Considered:
- **Token-bucket per org** — needs a `org_tokens` row + tick maintenance.
  Extra state and tuning.
- **Cap on RUNNING per org** — simpler but doesn't help when there's only
  one worker (which is Sprint 3's default).

The "least-recently-served" rule degenerates to FIFO when only one org has
queued work, so we lose nothing in the single-tenant case. It also degrades
gracefully to true round-robin when several orgs have continuous traffic.

## Cost

The CTE costs an extra read per tick (probably ~1ms on Neon — `jobs` has the
`(status, scheduledFor, createdAt)` index from Sprint 1 plus
`(organizationId, createdAt)`). Negligible vs the per-tick worker latency,
and it only runs when there IS due work.

## Consequences

- `apps/api/src/jobs/runner.ts` `tick()` updated; the previous global-FIFO
  query is removed. The handler/error/Usage paths are unchanged.
- Sprint-1's two existing job indexes are sufficient; no new indexes needed.
- A future multi-worker deployment (Sprint 4+ likely) inherits this fairness
  automatically because the SQL itself enforces the round-robin.
- If a noisy-neighbor situation ever needs hard caps, we layer per-org
  rate-limiting at the route boundary instead of touching the claim.

## Test plan

- Two orgs each enqueue 5 NOOP jobs at the same instant. Run the worker
  with TICK_MS=200; observe the `startedAt` order alternates between orgs
  rather than draining all of org A first.
- Single-org regression: one org with 10 queued jobs drains in
  oldest-first order (the CTE returns `fair_org` = that org every tick,
  and the inner SELECT does the FIFO).
