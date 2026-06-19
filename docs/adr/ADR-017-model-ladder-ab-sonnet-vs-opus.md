# ADR-017 — Model A/B verdict: sonnet-4-6 stays the room-vision tier

**Status:** Accepted
**Date:** 2026-06-12
**Supersedes:** —
**Related:** ADR-016 (text-layer-first extraction), Sprint 8 S8-8 rider
(model ladder + A/B)

## Context

The Sprint 7 / S7-5 live run failed FINISHES (0/12 codes; vision invented
"WM1"/"FM2" instead of reading the I401 ST01/PR01/FN0x set). Sprint 8 fixed
the *legend codes* via text-first parsing (S8-1: 12/12 codes for $0
tokens). The remaining gap is *room → finish code mapping*: with the right
vocabulary in hand, vision still labels only ~14–23 % of rooms correctly,
so QUANTIFY's floor-finish totals (ST01, PR01, PR03, BATHROOM, ST03) come
out at zero on the BOQ.

The S8-8 rider asked the data-driven question: **is the model the
bottleneck for room↔code mapping?** Rather than guess, run the same
document end-to-end on `claude-sonnet-4-6` as baseline, then re-run only
the rooms-vision stage on `claude-opus-4-8` (the strongest tier
publicly available at the time of this sprint) and compare on the
fixture's scorer.

## The A/B harness

R1 added per-stage model config (`ANTHROPIC_MODEL_CLASSIFY`,
`_VISION`, `_DEFAULT`, falling back to `ANTHROPIC_MODEL`). The worker
stamps the resolved model into `Job.aiModel` at claim time so each row
in the `jobs` table is self-describing. The boot banner now reports the
three-way model map when they differ.

Three procedural notes from running the A/B:

1. The first live attempt CLASSIFY-RUNNING blew up because the SQL
   `SET "aiMode" = ${config.aiMode}` interpolated `live` unquoted. Fixed
   by hand-quoting; the closed-enum value is safe.
2. `claude-opus-4-8` returns `400 invalid_request_error: "temperature is
   deprecated for this model"`. Added a `NO_TEMPERATURE_MODELS` regex
   that strips `temperature` from request bodies on opus-4-8 and newer.
3. Mid-CLASSIFY the Neon pooled DSN dropped the connection
   (`prisma:error Error in PostgreSQL connection: Closed`). The job was
   recovered by hand (mark CLASSIFY DONE — 58/58 sheets were already
   persisted — and enqueue EXTRACT_FINISH_LEGEND); the pipeline resumed
   from there. The tokens already spent on the partial CLASSIFY weren't
   re-spent.

## Method

- Fixture: Plot 4357 (58 pages, ARCH+ID, ~31 MB).
- Same document for both runs; rooms vision re-ran only after soft-
  deleting the prior run's ROOM TakeoffItems and takeoff Spaces, then
  enqueueing a fresh `EXTRACT_ROOMS` job.
- Scorer: `apps/api/scripts/score-extraction.ts` against
  `apps/api/fixtures/plot4357.groundtruth.json`.
- Cost arithmetic: actual sonnet rates ($3/M in, $15/M out); for the
  A/B delta we report both sonnet and opus pricing so the reader can
  see what the swap cost.

## Result

| Module | sonnet-4-6 (baseline) | opus-4-8 (rooms only) |
|---|---|---|
| REGISTER | **PASS** (58/58, [ARCH, ID]) | PASS (unchanged — same upstream) |
| DOORS | **PASS** (9/9; D08 acceptAlternates per ADR-015) | PASS (unchanged) |
| WINDOWS | **PASS** (20/20, CW02 found) | PASS (unchanged) |
| ROOMS | **PASS — 20/22 within ±2 %**, 33 unique spaces | **FAIL — 12/22 within ±2 %**, 31 spaces |
| FINISHES — legend codes | **12/12** (text-first, $0) | 12/12 (unchanged) |
| FINISHES — room→code mapping | **3/22 (14 %)** | **5/22 (23 %)** |
| Vision tokens (rooms stage) | 47,608 in / 8,525 out | 108,971 in / 10,841 out |
| Rooms-stage cost (at-rate) | ~$0.27 | **$2.45 (opus rates)** |
| Total run | $0.59 baseline + $0.30 restore | $0.59 + $2.45 + $0.30 ≈ $3.34 |

### Why opus regressed ROOMS

The rooms vision pass on Plot 4357 returns floor plans / finish plans at
220 DPI quadrant tiles. With sonnet:
- 83 room rows extracted across 17 sheets
- bbox-spatial parser overrode `area_m2` for vision-null rows, lifting
  the GT match rate to 20/22

With opus on the same images:
- 47 room rows — opus is markedly more conservative, returning fewer
  rooms with `area_m2=null` more often
- the bbox-parser still recovered the same physical pairs, but **fewer
  vision rows existed to merge with**, so room rows that vision dropped
  entirely never made it to the post-reconciler stage
- net: 12/22 within ±2 % vs sonnet's 20/22

opus's caution on a downsampled drawing isn't an asset here — sonnet's
"see-and-report" behaviour is exactly what the bbox merger needs. The
+9 percentage points of room→code mapping (14 → 23 %) doesn't buy
back the regression on the gating ROOMS module.

### Why opus didn't fix FINISHES

The mapping problem is **not vision reading the codes more correctly**.
It's that the legend codes are printed in a fixed *legend table* off to
the side of the floor plan, while the rooms themselves are hatched
with patterns whose colour at 220 DPI compresses to indistinct grey.
A model that's better at fine perception doesn't have more pixels to
work with — both tiers read "hatched grey" and guess. The fix has to
come from somewhere other than swapping the model:

- bbox-spatial room↔hatch pairing (the analogue of S7-4's room↔area
  pairer, applied to the I401-I404 hatches)
- vendor-side: ask the architect for the floor-finish *floorMap*
  spreadsheet (most contractors deliver one); skip the inference
- escalate by *DPI*, not by model: render the legend region at 600 DPI
  and feed JUST the legend + ONE room at a time

## Decision

1. **Keep `claude-sonnet-4-6` as the vision tier for rooms.** Opus 4-8
   regressed ROOMS at 5× the cost on this fixture.
2. **Do not implement the R4 escalation rule.** The A/B did not show
   model-tier lift; gating cheap calls behind a low-confidence threshold
   to promote them to opus would systematically spend more for worse
   results on this workload.
3. **Per-stage model config (R1) stays in place.** It's useful for
   future stage-specific routing (e.g. a CLASSIFY-only tier swap), and
   the `Job.aiModel` column lets us run A/B harnesses cheaply going
   forward.
4. **Next sprint's room→code fix is structural, not a model swap.**
   The two candidates above (bbox-hatch parser; vendor floorMap) are
   the right next steps. Vision is necessary for the *fine perception
   tasks vision is good at* (door/window dimension reading), not for
   the *fine perception tasks the architect intentionally encoded
   spatially* (room↔finish hatching).

## Non-goals / future revisits

- We are not declaring opus-tier models "bad". They may well outperform
  on tasks where the bottleneck IS visual ambiguity (e.g. handwritten
  schedule notes; multi-language plans). This ADR only covers the rooms
  vision pass on this fixture's CAD-rendered drawings.
- We will re-run this A/B when (a) a stronger Anthropic vision tier ships
  with native >1568 px image support, or (b) we move the rooms pass to a
  per-room cropped image instead of quadrant tiling. Either change
  invalidates this verdict.

## Evidence (artifacts in `$CLAUDE_JOB_DIR`)

- `baseline_cost.json` — sonnet baseline: 111,467 in / 17,327 out / $0.594
- `ab_cost.json` — opus A/B: 108,971 in / 10,841 out / $0.490 at sonnet
  rates, $2.448 at opus rates
- `boq-S8-8-baseline-sonnet.xlsx` — the produced BOQ (236,061 AED
  subtotal; CL03 ceiling line over-reports because room↔code mapping
  failed; documented gap for the next sprint)
- `usage_pre_baseline.json`, `usage_pre_ab.json` — usage snapshots
  bracketing the runs

The data, not vibes, decided the question. ADR-017 is the record of
that.
