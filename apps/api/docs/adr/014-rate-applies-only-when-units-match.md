# ADR-014: A rate applies ONLY if the rate's unit matches the line's unit

Date: 2026-06-12
Status: Accepted (Sprint-5 amendment to ADR-009)

## Context

The Sprint-4 live BOQ priced **every** line — zero P/S. That is the wrong
outcome for a fit-out BOQ:

- 20 WINDOW takeoff items had `unit = 'nr'` (number of glazing units).
- The closest matching rate in the seed library, `curtain-wall-aluminium-m2`,
  carries `unit = 'm²'` and a rate of **1,150 AED/m²**.
- The Sprint-4 PRICE handler matched by category only and multiplied
  `nr × 1150 AED/m²`, producing nonsense quantities.

Zero-P/S on a live extraction means we're inventing rates for line shapes the
library cannot legitimately price. A P/S column is not a failure mode — it is
the honest signal to the commercial team that a category needs an explicit
rate before quoting.

ADR-009 set up the price waterfall; this ADR adds the **unit-match
precondition** to every tier of that waterfall.

## Decision

A rate (Assembly or RateLibraryItem) **applies to a BOQ line only when its
unit string is the same as the line's unit string** (case-insensitive,
trimmed).

- Tier 1 (Assembly): `assembly.outputUnit === line.unit` required. Mismatch
  → fall through.
- Tier 2 (preferred supplier price): supplier prices are quoted per the
  underlying Material's unit; the line must share that unit. Mismatch →
  fall through. (Tier 2/3 are no-ops in Sprint 5 because the takeoff doesn't
  yet link to Material; the precondition is wired for Sprint 6+.)
- Tier 3 (cheapest supplier price): same as tier 2.
- Tier 4 (org RateLibraryItem): `rateLibraryItem.unit === line.unit` required.
- Tier 5 (global RateLibraryItem): same.
- Tier 6 (P/S): if every prior tier was rejected — by unit mismatch OR by
  absence — the line becomes `isProvisional = true`, `rate = null`,
  `psAmount = null` (NOT zero — null signals the commercial team must enter
  the carry).

The handler stamps each priced line's `rateSource` exactly as before; lines
that land at P/S get `rateSource = 'provisional-sum'`.

## Why null `psAmount` (not zero)

In Sprint 3 we wrote `psAmount = 0` on every P/S row. That looked tidy in the
XLSX but masked the empty cell. The commercial team needs to SEE that a value
was never supplied. `null` renders as `—` in the exporter, matching the
disclaimer's intent.

## Consequences

- All four tier checks gain a unit-match precondition.
- WINDOW lines (unit `'nr'`) on this set will become P/S until an org adds
  a per-No glazing rate (`code: 'curtain-wall-aluminium-nr'` or similar).
- The Sprint-4 Sonnet BOQ's subtotal will change materially when re-priced:
  ~23,000 AED of fake window value drops out and is replaced by 20 P/S
  rows. The architect requested this re-price; results are in the closeout.
- Future rates added to the library MUST carry an honest `unit`. The seed
  file is the model.
- A zero-P/S output is now a smell, not a goal. The CATEGORY_SANITY
  validator (S4-5) already errors on zero windows; we may extend it later
  to error on zero-P/S as well.

## Test plan

- 1 WINDOW line at unit `'nr'`, library has only the `curtain-wall-aluminium-m2`
  rate → line becomes P/S, `rate=null`, `rateSource='provisional-sum'`.
- 1 WALL_FINISH line at unit `'m²'`, library has `paint-emulsion-2coat` at
  unit `'m²'` → line priced via tier 5.
- 1 DOOR line at unit `'nr'`, library has `door-single-supply-install` at
  unit `'nr'` → priced via tier 5.
- 1 WALL_FINISH line at unit `'m²'`, Jotun assembly at `outputUnit 'm²'` is
  the only candidate → priced via tier 1 (assembly).

All four cases land in the unit test that ships with the PRICE handler
update.
