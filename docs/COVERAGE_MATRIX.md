# Coverage Matrix — Contractor BOQ vs App Output

**Reference:** *Ahmed Ali Villa Finishes Quote Rev-01* (Triple A Technical Services, 2026-06-04).
G+1 Residential Villa, Plot No. 4357, Al Rahmaniya, Sharjah.

## How to read this doc

The contractor quotation is used **for coverage reference only**. From it we learn:
- ✓ which categories exist in a real UAE villa BOQ
- ✓ which units estimators use per category (rm / m² / lm / nr / item)
- ✓ which items real contractors price vs mark as P/S vs LS
- ✓ which contractor BOQ rows our app fails to emit (the coverage gap)

The contractor's **numbers are never used to populate** rates, quantities, totals, derived values,
or provisional-sum defaults in our app. Per project rules:
- **Quantities** originate from drawings (extraction pipeline)
- **Rates** originate from the user's rate library
- **Provisional sums** originate from user configuration

The AED columns below are *informational only* — they show the relative size of each category so
we can prioritise where to spend Sprint-1 effort. They do not seed the app.

**Total contractor quote: 2,059,000 AED** (priced finishes + provisional sums; **MEP excluded** —
MEP is a separate provisional on top).

---

## Headline coverage (category-level)

| Lane | Contractor (size ref) | App categorical coverage today |
|---|---:|---|
| Priced (measured / derived) | ~964k | Most categories emit a line, but several remain at `status=AI` (never reach BOQ) and several discrete items are missing entirely |
| Provisional Sums | ~1.10M | The major bucket categories emit collapsed P/S lines (psAmount=null until user sets); several sub-categories aren't recognised |
| MEP | 0 in this quote (separate) | Correctly absent (CLASSIFIER-4 PRECONDITION RULE — no MEP drawings → no MEP) |
| Discount | (–5,748) | Quotation-layer concern, not BOQ |

---

## Per-category matrix

**Legend:**
- ✅ App emits a line for this category at the right shape (status reaches BOQ)
- 🟡 App emits but lands at `status=AI` (never priced) or wrong section / unit
- 🟠 App emits a P/S placeholder with `psAmount=null` — correct shape, allowance pending user
- 🔴 App emits NOTHING for this category
- ⚪ Correctly absent

The "Sprint-1?" column flags Sprint-1 work. Sprint-1 actions are **structural** — they add line
emitters, rate-library slots, category enums, or auto-promote rules. None of them seed a number.

### 2.5 METAL WORKS — Contractor: 0 priced (everything → P/S in 4.0)

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Hatch access doors | item | N/A | ⚪ | — |
| Entrance gate | item | P/S (in 4.0) | 🟠 routed via METAL → PROVISIONAL_SUM | — |
| Boundary wall metalwork | LS | P/S | 🟠 same | — |
| Catladder | Item | P/S | 🟠 same | — |
| FN03 Aluminium screen | m² | P/S | 🟠 same | — |
| MT01/MT02 Louvers | m² | P/S | 🟠 same | — |

**Section verdict:** ✅ matches contractor behaviour. **Sprint-1:** nothing.

---

### 2.6 WOOD WORK — Contractor: ~186k priced

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Kitchen cabinet base unit | rm | Priced | 🟡 emits KITCHEN-BASE line at status=AI (vision opt-in) | **Auto-promote** to status=EDITED + ensure rate-library has a KITCHEN-BASE-LM entry the user can populate |
| Kitchen cabinet wall unit | rm | Priced | 🟡 emits KITCHEN-WALL line at status=AI | Same — auto-promote + rate-library slot |
| Vanity counters | item (per bath) | Priced | 🟡 emits VAN-{room} line at status=AI | **Auto-promote** VAN lines; add VANITY rate-library slot |
| Joinery (cabinets, wardrobes — LS) | LS | LS quoted | ✅ collapses as LUMP_SUM (psAmount=null until user sets) | — |
| MDF stair handrail (wall) | rm | Priced | 🔴 not emitted | **Add STAIR-HANDRAIL emitter** (driver = stair length from STAIRCASE detection) + add STAIR-HANDRAIL-RM rate-library slot |

**Sprint-1:** auto-promote 3 existing AI-status emissions + add stair handrail emitter + 4 new rate-library slots.

---

### 2.8 DOORS, WINDOWS & GLAZING — Contractor: ~70k priced + windows P/S

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Doors D01-A … D09-B (sub-typed) | nr | Priced per type | ✅ extracts counts + dims, preserves sub-types (BUG-DOOR-SUBTYPES) | Verify rate-library covers D01–D09 by type |
| Ironmongery (door hardware) | nr (per door) | Priced (PC-rate per door) | 🔴 not emitted | **Add IRONMONGERY emitter** (driver = DOOR_COUNT, unit nr) + IRONMONGERY-PC rate-library slot |
| Curtain walls CW01–CW20 | nr | P/S (in 4.0) | ✅ WINDOW → PROVISIONAL_SUM | — |
| Aluminium windows | item | P/S | ✅ same | — |

**Sprint-1:** add ironmongery emitter + rate-library slot.

---

### 2.9 FINISHES — Contractor: ~688k priced — the dominant priced bucket

#### 2.9.A — Floor finishes

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Sand-cement floor screed | m² | Priced | ✅ SCREED-FLR emitter (interior Σ × rate-library SCREED-FLR) | Verify external-screed scope — contractor counts more than interior floor; ROOM-CLEANUP |
| Floor porcelain ST01 (White Marble) | m² | Priced | ✅ FF-ST01 per room | — |
| Floor porcelain ST02 (Grainy — stair only) | m² | Embedded in stair-tread row | 🔴 not emitted as floor (correct — it's stair-tread material) | See stair-tread row below |
| Floor porcelain PR01 (Marble texture) | m² | Priced | ✅ FF-PR01 per room | — |
| Floor porcelain PR03 (Grey service) | m² | Priced | ✅ FF-PR03 per room | — |
| Bathroom floors (FN22 / FN24 / FN33 / FN43) | m² | Priced per FN code | 🟡 app routes BATHROOM rooms to a single FF-BATHROOM rate, not per-FN-code | Phase 2 — per-FN finish-plan extraction |
| **Stair tread (Grainy ST02)** | lm | Priced | 🔴 not emitted | **Add STAIR-TREAD emitter** (driver = stair length) + STAIR-TREAD-LM rate-library slot |
| **Stair landing** | m² | Priced | 🔴 not emitted | **Add STAIR-LAND emitter** (driver = landing m² from STAIRCASE detection) + STAIR-LAND-M2 rate-library slot |
| **Threshold (per door opening)** | lm | Priced | 🔴 not emitted | **Add THRESHOLD emitter** (driver = DOOR_COUNT × per-door lm) + THRESHOLD-LM rate-library slot |

#### 2.9.B — Wall finishes + skirting

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Wall porcelain FN22 / FN23 / FN31 / FN32 / FN41 / FN42 (per FN code) | m² | Priced per FN code | 🔴 not emitted | Phase 2 — per-FN-code wall-tile extraction |
| Wall service PR03 | m² | Priced | 🔴 not emitted | Phase 2 |
| **Skirting (porcelain — SK01)** | lm | Priced | 🟠 emits SK-{room} via aspect prior but `status=AI` (never reaches BOQ) | **Sprint-1 — auto-promote SK lines to EDITED** + add SKIRTING-* rate-library slot |
| Skirting (PR03 — SK03) | lm | N/A | 🟠 same path | — (covered by SK auto-promote) |

#### 2.9.C — Wall plaster + paint

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Plaster smooth (under paint) | m² | P/S | ⚪ app treats as P/S | — |
| Plaster rough (under tile) | m² | P/S | ⚪ same | — |
| **Wall paint Fenomastic WL01** | m² | Priced | 🟡 PAINT-{room} emitter (aspect-prior perimeter × ceiling height × rate) — wall area drifts vs contractor | Phase 2 — re-tune aspect-ratio prior or compute wall area from a real perimeter source |
| GRC FN01 internal | m² | P/S (in 4.0) | ✅ collapse | — |
| Metallic FN02 internal | m² | P/S (in 4.0) | ✅ collapse | — |

#### 2.9.D — Ceilings

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Marmox CL01 (external) | m² | Priced | 🟡 CL-CL01 emitter exists but external-room routing untested | Verify external-area→CL01 mapping; ROOM-CLEANUP scope |
| Moisture-gypsum CL02 (kitchen / bath) | m² | Priced | ✅ CL-CL02 per room | — |
| Gypsum CL03 (everywhere else) | m² | Priced | ✅ CL-CL03 per room | — |

#### 2.9.E — External finishes

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Pavement ST03 around villa | m² | Priced | 🟡 if extracted as external ROOM with ST03 | Verify external-rooms extraction |
| Garage floor ST03 | m² | Priced | 🟡 same | Same |
| Screed for paving (external) | m² | Priced | 🔴 SCREED only counts interior | Phase 2 — extend SCREED-FLR to include ST03 areas, OR add SCREED-EXT category |
| External plaster, GRC, Stone | m² | P/S | ✅ collapsed | — |

#### 2.9.F — Catch-all

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Terrace floor ST03 | m² | Priced | 🟡 depends on terrace-room extraction | Out of scope |
| Parapet inside paint | m² | Priced | 🔴 parapet not classified | Phase 2 |

---

### 3.1 EXTERNAL WORKS — Contractor: ~21k priced

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Manholes 800×800 (drainage) | nr | Priced | 🔴 not emitted | Phase 2 — needs MEP drainage layout (PRECONDITION RULE applies) |
| Manholes 600×600 (drainage) | nr | Priced | 🔴 same | Same |
| Gully trap | nr | Priced | 🔴 same | Same |
| Manholes 600×600 (electrical / landscape) | nr | Priced | 🔴 same | Same |
| Entrance canopy | item | N/A | ⚪ | — |

**Sprint-1:** nothing — all require MEP/landscape drawings.

---

### 4.0 PROVISIONAL SUMS — Contractor: ~1.10M (allowances + 5–10% OH&P)

| Item | Unit | Contractor status | App today | Sprint-1? |
|---|---|---|---|---|
| Sanitary fittings | LS | P/S | 🟠 SANITARY collapse (psAmount=null) | — (user sets allowance) |
| Light fittings & switches | LS | P/S | 🔴 no electrical category emits today (no MEP) | Phase 2 — add ELECTRICAL_LIGHTING category (MANUAL-add UI exists) |
| **Windows & skylight** | LS | P/S | ✅ WINDOW → PROVISIONAL_SUM collapse (psAmount=null) | — (user sets allowance) |
| Soft scaping | LS | P/S | 🟠 EXTERNAL collapse | Add SOFT_SCAPING sub-category for finer P/S |
| External lighting | LS | P/S | 🔴 | Phase 2 — MEP-adjacent |
| **Stone cladding** | LS | P/S | 🔴 | **Sprint-1 — add STONE_CLADDING category enum** (P/S routing falls out of CLASSIFIER-2 collapse) |
| Garage gates | LS | P/S | 🔴 | Phase 2 |
| **3D façade feature screen** | LS | P/S | 🔴 | **Sprint-1 — add FACADE_SCREEN category enum** |
| **Home automation** | LS | P/S | 🔴 | **Sprint-1 — add HOME_AUTOMATION category enum** |
| Metal work general | LS | P/S | 🟠 METAL collapse | — |
| MT01 / MT02 louvers (sub-row) | LS | P/S | 🔴 (sub-detail of metal) | Phase 2 |
| GRC FN01 internal (sub-row) | LS | P/S | 🟠 GRC collapse | Acceptable at category level |
| Metallic FN02 (sub-row) | LS | P/S | 🟠 collapsed via WALL_FINISH path | Acceptable |
| GRC FN01 external (sub-row) | LS | P/S | 🟠 collapsed | Acceptable |
| **OH&P (5–10% per P/S row)** | — | Add-on | 🔴 not applied | Phase 2 — add per-row OH&P multiplier as a project setting |

---

## Sprint-1 punch list

Structural changes (no contractor numbers baked in):

1. **Skirting auto-promote** — flip SK-{room} emissions from `status=AI` to `EDITED` so they reach the BOQ; add SKIRTING-* rate-library slots (user populates).
2. **Stair finishes** — three new emitters:
   - `STAIR-TREAD` (driver: stair length from STAIRCASE detection, unit: lm)
   - `STAIR-LAND` (driver: stair landing m², unit: m²)
   - `STAIR-HANDRAIL` (driver: stair length, unit: rm)
   - + matching rate-library slots
3. **Threshold** — new emitter `THRESHOLD` (driver: DOOR_COUNT, unit: lm) + THRESHOLD-LM rate-library slot.
4. **Ironmongery** — new emitter `IRONMONGERY` (driver: DOOR_COUNT, unit: nr) + IRONMONGERY-PC rate-library slot.
5. **Vanity auto-promote** — flip VAN-{room} emissions to `status=EDITED`; ensure VANITY rate-library slot exists.
6. **Kitchen auto-promote** — same for KITCHEN-BASE / KITCHEN-WALL lines (when vision opt-in pass ran).
7. **Three new P/S categories** to TakeoffCategory enum + DEFAULT_ESTIMABILITY:
   - `STONE_CLADDING` → PROVISIONAL_SUM
   - `FACADE_SCREEN` → PROVISIONAL_SUM
   - `HOME_AUTOMATION` → PROVISIONAL_SUM
   - All collapse via CLASSIFIER-2 to a single P/S row with psAmount=null until user sets.

**Sprint-1 deliverable:** all the categorical rows above start emitting; the rate library + P/S
allowance values come entirely from user input — never the contractor quote.

---

## Out of Sprint-1 (parking lot)

- Per-FN wall-tile extraction (rooms × FN-code-per-surface)
- Wall paint quantity drift (aspect-ratio prior → real perimeter)
- External pavement + screed
- Drainage manholes (needs MEP drawings — PRECONDITION RULE)
- Per-discipline P/S sub-rows (MT01, FN01 internal vs external)
- Parapet inside paint (parapet classification missing)
- Misc terrace floors (terrace-room extraction)
- OH&P per-P/S multiplier (project setting)
- Discount line (quotation-layer, not BOQ)
