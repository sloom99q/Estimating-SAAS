# ADR-015 — Ground truth changes only on document evidence

**Status:** Accepted
**Date:** 2026-06-12
**Supersedes:** —
**Related:** ADR-009 (pricing waterfall), ADR-014 (unit-match), Sprint 6 (live gate),
Sprint 7 (data integrity + the area gate)

## Context

`apps/api/fixtures/plot4357.groundtruth.json` is the accuracy harness fixture.
The harness scores every live extraction run against it. The list of expected
doors, windows, rooms, legend codes, and floor maps is the **contract** the
pipeline is supposed to satisfy.

Sprints 1-6 surfaced several moments where a quality miss would have been
easier to "fix" by softening the ground truth: drop the door tag the model
didn't find, relax the area tolerance the parser couldn't hit, accept a
legend code the schedule never printed. Every one of those moves would have
shipped a worse extractor while moving the score up.

Sprint 6 made the temptation concrete. The legend extractor — wired only to
the top-left quadrant — couldn't read I403/I404 because their legend tables
sit centre-right. The lazy patch was to remove FN22/FN23/FN24/FN31/FN32/FN33/
FN41/FN42/FN43 from `legendCodesExpected`. The actual fix was to render the
full page and add the codes as `optionalCodes` (Sprint 7 S7-2). The latter
is honest; the former hides the regression.

Sprint 7 S7-0 ran into the inverse: an idempotency bug had pushed 57 schedule
items into the live takeoff, half of them dups. Dropping the schedule items
to make `expectedTagCount: 9` pass would have produced a passing scorer
**and** a broken extractor. The right move was to dedupe, regenerate, and
re-score against the unchanged ground truth.

## Decision

**Ground truth changes only on document evidence.**

A change to `plot4357.groundtruth.json` (or any future fixture's groundtruth
file) is acceptable iff one of the following holds:

1. **Direct evidence in the source PDF.** The drawing or schedule shows
   something different from what the fixture currently asserts. The change
   is a faithful read of the document.

2. **Corroborated by the contractor's quote.** The contractor's BOQ /
   pricing document confirms the same fact (e.g., ST01 priced per m²
   against LIVING + DINNING + ENTRANCE LOBBY + PLAY ROOM corroborates the
   ST01 floorMap). This is "second-source" evidence.

3. **`$note` explaining a source conflict.** When the document itself
   contains two readings — e.g., the GF-05 area prints as 21.38 on the
   floor plan and 21.58 on the finish plan — the groundtruth accepts both
   via either a multi-value field or a documented `$note`, and the scorer
   tolerates either.

4. **A new `optionalCodes` (or equivalent) addition.** When extra items
   exist in the document but are not strictly required for a PASS, they
   land in an `optionalCodes` / `optional*` array, **not** by relaxing the
   required set. The scorer treats them as bonus, not as required.

**The following changes are forbidden:**

- Removing an item the document still shows, because the current extractor
  doesn't find it. ("D02 — the schedule says 4 leaves, our extractor returns
  5; let's change the truth to 5.")
- Widening a numeric tolerance specifically to make a failing case pass.
  ("LIVING area is 58.82; we return 58.50; let's widen tolerance to ±5%.")
- Removing a flag the document warrants. ("MISSING_DISCIPLINE always flags
  on this set; let's drop the assertion.")
- Adding a tag the document does not show, because the extractor is over-
  reporting. ("Our extractor returns 'MASTER BATHROOM' as a legend code;
  let's add it.")

A flag, a low score, or a partial PASS is the **signal** that the
extractor needs more work — not noise to be quieted.

## Consequences

- The scorer remains an honest measure of pipeline quality.
- "Fix the scorer" is no longer a shortcut available to engineering. The
  available shortcuts are: fix the extractor, document the source conflict,
  or accept the failing line and create a Sprint task.
- Every groundtruth edit requires a one-line justification in the commit
  message naming which clause above it falls under. PRs touching
  `*.groundtruth.json` are reviewed with this ADR in hand.
- New fixtures (Plot N+1, Plot N+2, …) inherit this rule by default. The
  rule is global, not Plot 4357-specific.

## Worked examples

### S7-2 — `optionalCodes`

I401-I404 print 12 core codes (ST01-ST03, PR01/PR03, WD01, FN01-FN04,
LS01-LS02). They also print 9 bathroom-series codes (FN22-FN43) that
appear only on specific bathroom drawings. Sprint 6's vision pass —
constrained to the TL quadrant — couldn't see all 9 reliably. Sprint 7
fixed the vision pass to read the full page; the 9 codes now land in
`optionalCodes`. PASS requires the core 12; bonus credit for finding the
optional 9. Falls under clause 4.

### S7-0 — schedule dedupe

A chain-handoff bug double-inserted the entire schedule. The fix was to
add an idempotent upsert and a chain guard (Sprint 7 S7-1), then dedupe
and regenerate BOQ/PRICE/XLSX. The groundtruth `expectedTagCount: 9`
stayed put — that's what the schedule prints. Falls under no clause; the
extractor was fixed.

### GF-05 DINNING area

The floor plan prints 21.38; the finish plan prints 21.58. The
groundtruth lists 21.58 with a `$note` flagging the conflict. The scorer
accepts either reading. Falls under clause 3 (source conflict, both
readings come from the document).

## Enforcement

- This document.
- Code review of `*.groundtruth.json` PRs.
- The scorer (`scripts/score-extraction.ts`) prints the violated clause
  when a groundtruth edit would otherwise be necessary, nudging the
  engineer back to the extractor.
