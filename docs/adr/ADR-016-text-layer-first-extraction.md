# ADR-016 — Text-layer-first extraction

**Status:** Accepted
**Date:** 2026-06-12
**Supersedes:** —
**Related:** ADR-015 (groundtruth changes only on document evidence),
Sprint 4 S4-3 (220 DPI quadrant vision), Sprint 7 S7-4 (bbox spatial parser),
Sprint 7 S7-5 (live re-run that surfaced this principle)

## Context

The Sprint 7 live re-run (S7-5) reproduced a pattern that has now bitten three
sprints in a row. The extractor was given a vendor-grade vector PDF whose
text layer contains the exact strings the scorer was asked to recover, and
the pipeline ignored that text layer in favour of vision passes that
**hallucinated short codes**.

The smoking gun was the I401 finish-legend sheet. The text layer of that
page prints `ST01 ST02 ST03 PR01 PR03 WD01 FN01 FN02 FN03 FN04 LS01 LS02` —
the exact 12 codes the scorer asks for. The vision pass — handed a 110 DPI
full-page image downsampled to Anthropic's 1568 px ceiling — returned WM1,
FM2, MM3, PM4 etc. The model read the description column ("White Marble",
"Wood Panel / Veneer") correctly but invented the code labels because they
were too small at the rendered resolution. The strict S7-2 regex correctly
dropped the hallucinations, so we paid tokens, got nothing useful, and
failed the scorer 0/12.

The same pattern showed up earlier:
- S7-4 (room areas) — the text layer + bbox-layout had every area printed
  next to every room name. The vision pass returned area_m2 = null for
  most rooms. The bbox spatial parser recovered 20/20 area pairs in the
  next live run *for $0 tokens*.
- S4-3 (rooms quadrant tiling) — the team tiled at 220 DPI specifically
  because vision could not read A1 plan-tag text at INGEST's 110 DPI.
  Quadrant tiling helped, but the underlying premise (read everything with
  vision) was already the wrong default for vector PDFs.

The principle is the same in each case: when the source document has a
machine-readable text layer, **vision is the wrong primary tool**. It's
slower, it costs tokens, and it produces guesses where the text layer
produces facts.

## Decision

**On sheets with a text layer, every extraction stage's primary pass is
deterministic text / bbox parsing. Vision is a secondary tool with three
specific roles.**

### Primary: deterministic text / bbox

For each stage, identify what the text layer (and `pdftotext -bbox-layout`
for spatial questions) can answer on its own:

| Stage | Text-layer primary |
|---|---|
| CLASSIFY | drawingNo, title, sheetType keywords |
| EXTRACT_FINISH_LEGEND | legend codes via regex `/^[A-Z]{2}\d{2}$/` + nearby description lines |
| EXTRACT_SCHEDULES | door/window tag tables (columnar text) |
| EXTRACT_ROOMS | room name / code / area triples via bbox-spatial pairing |

Each primary pass runs with **zero token cost** and is the source of truth
for the fields it covers.

### Secondary: vision, with three specific roles

Vision still exists on every stage. Its three roles, in order:

1. **Scanned-set fallback.** When `Document.hasTextLayer` is false (or a
   specific sheet's text layer is empty / garbled), the text-first path
   has nothing to consume and vision takes over as primary. The pipeline
   must not silently degrade — it raises an INFO flag saying which stage
   fell back.
2. **Enricher for what text can't carry.** Hatch fills, line styles,
   colour codes, spatial relations across drawn elements, the
   *description* column of a legend table when the text layer fragments
   it across line breaks. Vision adds these fields to rows the text layer
   already populated.
3. **Cross-check feeding the reconciler.** Independent second opinion. If
   vision disagrees with text on a numeric or categorical field, the
   reconciler records the mismatch as a `ROW_MISMATCH` ValidationFlag and
   the text reading wins by default. Disagreements are surfaced for human
   review, not silently resolved.

### Per-field provenance

Each TakeoffItem records, in `meta.provenance`, **which pass sourced each
field**. Shape:

```ts
meta.provenance = {
  code:     'text-layer' | 'vision' | 'bbox-spatial' | 'reconciler',
  name:     'text-layer' | 'vision' | 'bbox-spatial' | ...,
  area_m2:  'text-layer' | 'vision' | 'bbox-spatial' | ...,
  // ...
}
```

This makes downstream debugging tractable ("why is ST01 here? — text
layer of I401") and makes the scorer's "0/12 codes" failure mode visible
at the row level next time.

## Consequences

**Cost.** Text-first is materially cheaper. The S7-5 LEGEND stage cost
$0.09 to recover 0 of the 12 required codes; the text layer of I401 alone
has all 12. Generalising the pattern, we expect total per-run cost on
vector PDFs to drop ~30–40% as legend and parts of rooms move off
vision.

**Quality.** The deterministic passes don't hallucinate. The cases vision
*does* matter for (scanned-set documents, hatch-pattern keying,
description copy) become well-scoped enrichers instead of "ask the LLM to
read this drawing."

**Engineering.** Each stage handler grows a clearly separated
`textLayerPass()` and `visionPass()`. The reconcile step that already
exists in extractRooms.ts (vision rows vs text rows, ROW_MISMATCH flag)
becomes the standard shape for every stage. Handlers report
`textLayerHits` and `visionHits` in their result so the runtime mix is
visible.

**Scope.** This is a principle, not a rewrite. Concrete migrations land
sprint-by-sprint: S8-1 moves LEGEND; S8-2/S8-3 lean on text/bbox for
ROOMS; SCHEDULES already has a text-first reconciler from earlier sprints
and stays as-is.

## Non-goals

- We are not removing vision from any stage. Anthropic stays in the loop
  for the three roles above. The change is **what runs first** and
  **what the source of truth is for each field**.
- We are not adding OCR. If `Document.hasTextLayer` is false, vision is
  the primary path for that document.
- We are not gating per-sheet on hasTextLayer-ness in this ADR. The
  flag at the document level is enough for the initial rollout; per-sheet
  routing is a future refinement if specific sheets in a generally-vector
  set turn out to be raster.

## Enforcement

- Each stage handler's PR is reviewed against the table above: does the
  primary pass come from text/bbox? Does vision serve one of the three
  defined roles?
- `meta.provenance` is required on rows the migrated stages emit. The
  scorer surfaces rows missing provenance.
- `Job.result` for each stage reports `textLayerHits` and `visionHits`.
  A run that is 100% vision on a vector document is a regression.
