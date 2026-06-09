# `features/ai` — FUTURE SEAM (not built in Phase 1)

This slice is **reserved, not implemented**. Only the typed contract
([`contract.ts`](./contract.ts)) ships in Phase 1, so the architecture *supports*
AI without building it.

## What lands here later

Datasheet extraction, automated quantity takeoff, supplier intelligence — each
arrives as a normal vertical slice (`api/ components/ domain/ hooks/ pages/`)
under `features/ai`, touching no existing slice.

## The load-bearing decision: AI work is a JOB, not a request

Extraction/takeoff are long-running (seconds–minutes). The contract is therefore
**submit → poll status → read result**, never synchronous request/response:

```ts
const { jobId } = await aiService.submit(input)
// poll with TanStack Query; stop on a terminal status
useQuery({
  queryKey: ['org', orgId, 'ai', 'job', jobId],
  queryFn: () => aiService.getStatus(jobId),
  refetchInterval: (q) =>
    q.state.data?.status === 'succeeded' || q.state.data?.status === 'failed' ? false : 2000,
})
```

## Rules that keep the seam clean

- **Mock-adapter pattern** (same as auth): `features/ai/api` exposes the service
  interface; a mock implementation ships first, the real backend swaps in via
  one file built on [`shared/lib/http/client.ts`](../../shared/lib/http/client.ts)
  (which already supports per-request long/zero timeouts for uploads).
- **Provenance**: AI output writes to `materials`/`estimate_line_items` with a
  `job_id` + per-field `confidence` (see `documents.extractedData` in the schema)
  so estimators can review/override. Never silently overwrite human numbers.
- **No core → ai imports**: `auth`/`users`/`dashboard` must not import this slice,
  so AI stays an optional add-on (enforced by the boundary lint zones).
