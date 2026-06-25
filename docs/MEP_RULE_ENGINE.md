# MEP Rule Engine — Design Doc

> **Status:** design, not built. Awaiting estimator sign-off on §3
> schema + the §4 HVAC worked example before code lands.
>
> **The shift:** MEP scope (HVAC / Electrical / Plumbing / ELV) is
> currently a manual P/S bucket the estimator types in per project.
> This doc proposes: derive MEP DETERMINISTICALLY from drawing-
> measurable properties (floor area, room count, bathroom count,
> entry count), using factors seeded from the engineer's takeoff as
> general UAE-villa norms. **Same pattern as paint**: the app reads
> what's drawn, applies a factor, emits a priced line. No human
> types MEP numbers per villa.

---

## 0. The insight

Your engineer's takeoff isn't the answer for THIS villa — it's the
training material for the **METHOD**. The numbers in it are functions
of building data the app already extracts:

| Discipline | Driver (app already measures) | Conversion | Output |
|---|---|---|---|
| **HVAC tonnage** | floor area (ft²) | ÷ 135 ft²/TR (industry norm, engineer-cited) | cooling tons |
| **HVAC ducting** | floor area (m²) | × m²-duct-per-m²-floor factor | duct m² |
| **Electrical sockets** | room count (by type) | × sockets-per-room-type | socket points |
| **Electrical light points** | room count (by type) | × lights-per-room-type | light points |
| **Electrical cabling** | (socket + light) points | × m-cable-per-point | cable m |
| **Plumbing fixture points** | bathroom + kitchen count | × points-per-bath / kitchen | WC / basin / shower / sink pts |
| **Plumbing pipe** | fixture points + floor area | × m-pipe-per-point | pipe m |
| **ELV data points** | room count | × data-per-room | data pts |
| **ELV cameras** | entry count + perimeter | × cameras-per-entry | camera nos |

Every cell on the right is `quantity = driver × factor`. Every cost
is `amount = quantity × rate`. The engineer's takeoff gives us
the factors + rates as **UAE-villa norms**; the app applies them
to any drawing.

Concretely for your Lami villa: 3,834 ft² → app already knows that
from the DXF rooms → 3,834 ÷ 135 = **28.4 TR cooling load** →
splits into AC units → AED. No human input beyond confirming the
factor at project type.

---

## 1. Why a rule engine (not hard-coded math)

Hard-coding `tonnage = area_ft2 / 135` in the QUANTIFY handler
works for THIS villa but breaks the moment a different building
type lands (commercial, hospitality, healthcare). The factor IS
the variable; the formula is constant.

A rule engine inverts the dependency: factors live as DATA, the
handler walks them generically. New project type = new ruleset, no
code change. Per-org overrides (your firm prefers 130 ft²/TR for
luxury villas) = one row.

This is the same play as the Material Library §11 sortOrder routing:
encode the variability as rows so the code stays small and the
estimator can tune without involving an engineer.

---

## 2. What already exists

- **TakeoffItem** has every measurable input we need: ROOM (with
  qtyAi = area), the bath/kitchen/bedroom name patterns
  (`estimateVanity` already uses these), DOOR/WINDOW counts.
- **QUANTIFY** already runs per-project, derives floor finishes /
  screed / skirting / vanities / paint from rooms — natural home
  for derived MEP.
- **AssemblyComponent** does material → labor → tool decomposition
  (Jotun paint pattern). MEP could compose into Assembly-shaped
  systems eventually but for v1 we keep MEP simpler: one rule = one
  emitted line.
- **PRICE** already handles `category=MEP_PROV` lines as
  provisional. We'll route the new derived MEP through real
  categories with real rates.

---

## 3. Schema — `MepRule`

One new model. Per-org, editable, evaluable in isolation.

```prisma
/// MEP-RULE — atomic conversion from a drawing-measurable driver
/// to a priced MEP scope line. The driver value comes from the
/// project's takeoff at QUANTIFY time; factor × rate are the
/// engineer-derived UAE norms (per-org overridable).
model MepRule {
  id             String    @id @default(cuid())
  organizationId String

  /// 'HVAC' | 'ELECTRICAL' | 'PLUMBING' | 'ELV'
  discipline     String

  /// Human label that becomes the BoqLine description.
  /// 'Split AC units (cooling load)', 'Wall sockets (wiring +
  /// switchplate)', 'WC fixture point', etc.
  name           String

  /// Which drawing-measurable quantity drives this rule.
  /// One of:
  ///   'AREA_FT2'           sum of all ROOM areas, converted to ft²
  ///   'AREA_M2'            sum of all ROOM areas
  ///   'BUA_M2'             Project.buaM2 if set, else AREA_M2
  ///   'ROOM_COUNT'         count of ROOMs matching driverFilter
  ///   'BATHROOM_COUNT'     ROOMs whose name matches BATH/POWDER/WC
  ///   'KITCHEN_COUNT'      ROOMs matching KITCHEN
  ///   'BEDROOM_COUNT'      ROOMs matching BEDROOM
  ///   'ENTRY_COUNT'        DOORs at the building perimeter (phase-2;
  ///                        v1 falls back to a per-project constant)
  ///   'FIXED'              constant 1 — for per-villa lumps that
  ///                        don't scale (main DB panel, water heater
  ///                        when one-per-villa, etc.)
  driver         String

  /// Optional regex for ROOM_COUNT scoping. e.g. driver='ROOM_COUNT'
  /// + driverFilter='BEDROOM' counts only bedrooms.
  driverFilter   String?

  /// Multiplier on the driver value to produce the output quantity.
  /// HVAC tonnage rule: driver=AREA_FT2, factor=0.00741 (=1/135),
  /// outputUnit='TR'. Sockets-per-bedroom rule: driver=ROOM_COUNT
  /// (filter=BEDROOM), factor=8, outputUnit='pt'.
  factor         Decimal   @db.Decimal(14, 6)

  /// Where this factor came from. Free text but please be
  /// specific — surfaces in the audit chip on each BoqLine
  /// (e.g. 'industry norm 135 ft²/TR per ASHRAE Table 6-5',
  /// 'engineer takeoff Lami villa 2026-04').
  factorSource   String?

  /// Output unit string. 'TR' / 'No' / 'm' / 'pt' / 'm²'.
  outputUnit     String

  /// Rate in AED per outputUnit. Multiplied by the computed
  /// quantity to produce the BoqLine amount.
  rate           Decimal   @db.Decimal(14, 2)

  /// Where this rate came from. Same audit purpose as factorSource.
  rateSource     String?

  /// 'MEP_HVAC' | 'MEP_ELEC' | 'MEP_PLUMB' | 'MEP_ELV' — for
  /// grouping in the BOQ. Maps to the relevant section in
  /// CATEGORY_TO_SECTION (extending the existing MEP_PROV bucket).
  takeoffCategory String

  /// When multiple rules apply to the same driver, all fire (each
  /// emits its own line). sortOrder controls display order within
  /// the discipline.
  sortOrder      Int       @default(100)

  /// Free-form notes for the operator (e.g. 'replace with chiller-
  /// based assembly for villas > 50 TR').
  notes          String?

  active         Boolean   @default(true)
  createdAt      DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt      DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt      DateTime? @db.Timestamptz(6)

  organization   Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, discipline, name])
  @@index([organizationId, discipline, active])
  @@index([organizationId, takeoffCategory])
  @@map("mep_rules")
}
```

Also add to the existing `TakeoffCategory` enum:
- `MEP_HVAC`
- `MEP_ELEC`
- `MEP_PLUMB`
- `MEP_ELV`

(The existing `MEP_PROV` stays as a manual catch-all for one-off
P/S the estimator wants to add outside the rule engine.)

CATEGORY_TO_SECTION mapping additions (in `boq.ts`):
- `MEP_HVAC` → section `2.7` "HVAC" (NEW section)
- `MEP_ELEC` → section `2.7E` or fold under existing `4.0`? See Q5.
- `MEP_PLUMB` → ditto
- `MEP_ELV` → ditto

---

## 4. Worked example — HVAC on your Lami villa

Drawing-measurable inputs the app already has:

```
ROOMs (DXF + vision):  23
Sum of room areas:     427.70 m² = 4,604.4 ft²
                       (1 m² = 10.764 ft²)
                       — actually 356.2 m² interior-only excluding
                       MEP/store/voids per the existing room selector;
                       your "3,834 ft²" figure suggests the engineer
                       used a slightly narrower definition. v1
                       allows the rule to specify
                       driver='AREA_FT2' or 'BUA_FT2' so the
                       estimator picks which area definition
                       feeds it.
```

For this worked example we use **3,834 ft²** matching the
engineer's basis.

### Rule set for HVAC

Seeded from your engineer's data + UAE-villa norms:

| Rule name | Driver | Factor | Output unit | Rate (AED) | Note |
|---|---|---:|---|---:|---|
| Cooling load (split AC units) | AREA_FT2 | 1/135 = 0.00741 | TR | **2,800** | Engineer-cited 135 ft²/TR. Rate is mid-market for residential split units (1.5–3 TR) installed including F-gas + bracket + isolator. |
| HVAC ducting (insulated GI) | AREA_M2 | 1.518 | m² duct | 220 | Engineer takeoff 540 m² / 356 m² floor = 1.518. Rate = supply + return + insulation, installed. |
| Diffusers + grilles | AREA_FT2 | 0.0085 | No | 180 | 33 diffusers / 3,834 ≈ 0.0086; rate ~180 AED installed. |
| Thermostats | ROOM_COUNT (excl. balcony/garage) | 0.5 | No | 350 | ~1 stat per 2 rooms (master rooms have own; small rooms share). |
| Refrigerant piping (copper, insul.) | TR | 4.0 | m | 95 | ~4 m of piping per TR (condenser-to-FCU runs, typical villa). |
| Condenser concrete pads | FIXED | 1 | LS | 800 | One-time. |

### Computed for Lami (3,834 ft² = 356.2 m²)

```
1. Cooling load:
   3,834 × 1/135 = 28.4 TR
   28.4 × 2,800 = 79,520 AED
   → BoqLine: 'Split AC units (cooling load)' qty=28.4 TR  rate=2,800  amount=79,520

2. HVAC ducting:
   356.2 × 1.518 = 540.7 m² duct
   540.7 × 220 = 118,954 AED
   → BoqLine: 'HVAC ducting (insulated GI)' qty=540.7 m²  rate=220  amount=118,954

3. Diffusers + grilles:
   3,834 × 0.0085 = 32.6 → round to 33 No
   33 × 180 = 5,940 AED
   → BoqLine: 'Diffusers + grilles' qty=33 No  rate=180  amount=5,940

4. Thermostats:
   23 ROOMs (drop ~5 unhabited) = ~18 × 0.5 = 9 No
   9 × 350 = 3,150 AED
   → BoqLine: 'Thermostats' qty=9 No  rate=350  amount=3,150

5. Refrigerant piping:
   28.4 TR × 4 = 113.6 m
   113.6 × 95 = 10,792 AED
   → BoqLine: 'Refrigerant piping' qty=113.6 m  rate=95  amount=10,792

6. Condenser pads:
   1 × 800 = 800 AED
   → BoqLine: 'Condenser concrete pads' qty=1 LS  rate=800  amount=800

HVAC subtotal: 219,156 AED
```

This goes into a new BOQ section `2.7 HVAC`, displayed with the
same `[recipe]`-like chip that paint uses — clicking expands to
show "this number = floor area × 1/135 × 2,800 AED/TR" so the
estimator can audit + override.

**For ANY other villa**, the app re-runs the same rules with that
project's floor area / room counts / fixture counts. No human
input.

### Rule chaining (TR → refrigerant piping)

Note rule 5 uses **TR** as its driver, not floor area — its driver
value comes from rule 1's output. The schema doesn't yet support
multi-step chaining; for v1 we keep it linear: each rule reads
ONLY from the project's takeoff (room counts, areas, fixture
counts). Refrigerant piping would either:

(a) Use AREA_FT2 directly: factor = 4/135 = 0.0296 m/ft² (yields
    the same 113.6 m).
(b) Wait for v2 chaining when we add `driverRuleId` to MepRule.

**v1 picks (a)** — pre-multiply through the chain at seed time.
Cleaner schema, identical math for our cases.

---

## 5. Where this plugs into the pipeline

Two paths considered:

**A. Extend the existing QUANTIFY handler** with an MEP derivation
block after the existing skirting / paint / vanity passes. Same
pattern, same job, same chainGuard. ← **recommended for v1**.

**B. New `MEP_QUANTIFY` job type.** Separate job, separate runtime,
fine-grained re-runs. Cleaner separation but adds a chain step + a
new job type for marginal benefit.

Go with A. The MEP rules read takeoff state that QUANTIFY has
already produced (paint perimeter for cabling estimates? — not in
v1 actually; v1 reads ROOM directly). Adding ~80 lines of MEP
derivation alongside the existing ~500 lines of derivations keeps
the operational story simple.

After QUANTIFY emits the MEP TakeoffItems (`category=MEP_HVAC`
etc., `qty=<computed>`, `basis=DERIVED`, `status=EDITED`), the
existing BOQ generate picks them up; PRICE looks up the rate
either via the rule's directly-attached rate (preferred) or via
the existing waterfall. Simpler: emit the BoqLine WITH the rate
already baked in, marking `rateSource = 'mep-rule:<ruleId>'`.

---

## 6. Seeding the rules

Two pathways:

(a) **Hand-author a starter ruleset** matching the §4 table from
    your engineer's takeoff + UAE norms. Same shape as the Jotun
    paint seed: `apps/api/scripts/seed-mep-rules.ts`,
    idempotent, --apply / --reseed.

(b) **AI-extract from the engineer's takeoff document**. If you
    upload the engineer's PDF + per-line breakdown, an AI pass
    proposes:
       - "this line `135 ft²/TR cooling` → MepRule(discipline=HVAC,
         driver=AREA_FT2, factor=1/135)"
       - "this line `26 sockets at 35 AED/each` →
         MepRule(driver=ROOM_COUNT[bedroom], factor=4,
         outputUnit=pt, rate=35) (factor derived: 26/6 bedrooms = 4)"
    Estimator confirms / overrides. Phase 2.

**v1 = (a) only**, with the seed pre-populated from the §4 table
+ a few more discipline rules I'll author based on common UAE
practice. Estimator edits in the Library UI (LIB-7, due after this
ships).

---

## 7. UI — editing the rules

`src/features/library/` (the Material Library UI from LIB-7) gains
a new tab "MEP Rules". Same Brand→System pattern doesn't quite fit
(MEP rules don't have brands today), so:

- Tabbed view: HVAC · Electrical · Plumbing · ELV
- Per tab, a sortable table of rules: name, driver, factor, output
  unit, rate, source notes.
- Inline edit on factor / rate.
- "Add rule" button → modal with the schema fields.
- Live preview against the currently-open project ("on this villa
  this rule emits qty=X at rate=Y = Z AED").

Per-project overrides defer to phase 2 (matching the Material
Library Q2 verdict).

---

## 8. AI notes / concerns (BoqReviewNote)

The MEP rule engine emits standard `BoqReviewNote` entries for:
- A rule whose driver evaluates to zero on this project (rule
  defined but no applicable rooms — surface so the estimator
  re-checks the room classifier).
- A rule whose factor was last edited > 6 months ago (factors age
  in UAE pricing).
- A rule that produces a line > 50% above section average (sanity
  check on factor errors).

---

## 9. Open questions — please weigh in

| # | Question | Default I'd pick | Why I'd want your input |
|---|---|---|---|
| 1 | **Section for MEP lines: new sections (`2.7 HVAC`, `2.71 Elec`, etc.) or fold under existing `4.0 Provisional`?** | New sections, one per discipline. | New sections make the BOQ structure match real contractor BOQs — each discipline is its own page. `4.0 Provisional` becomes ONLY for genuine allowance items (the things the rule engine can't quantify). |
| 2 | **Area definition for HVAC tonnage: sum of ROOM areas, sum-excluding-MEP-rooms, or Project.buaM2?** | Add a `driver: 'AREA_FT2'` that sums interior ROOMs (excluding MEP/Stair/Garage by name pattern, same gates as `shouldSkirtRoom`). buaM2 is a project-level field that's optional. | Your "3,834 ft²" matches the engineer's interior definition, not raw sum-of-rooms. The selector exists; just need to pick it. |
| 3 | **Multi-step rule chains (TR → refrigerant piping)?** | Pre-multiply at seed time. v1 keeps every rule's driver as a primitive takeoff measure. Phase 2 adds `driverRuleId` for true chaining. | Chaining is more flexible but adds complexity; for the §4 example pre-multiplication produces the same result. |
| 4 | **HVAC unit split (28.4 TR → how many of each size)?** | v1 emits "Split AC units" as a single line at total TR. The estimator splits to specific 1.5/2/3 TR units manually if needed. Phase 2 adds a `splitTable` rule type. | The engineer's takeoff probably has explicit "5× 2-TR, 4× 3-TR, …" — that's finer than v1. v1 still gets the total cost right. |
| 5 | **Per-room-type detail (sockets-per-bedroom vs sockets-per-villa)?** | v1: per-room-type via `driverFilter` regex (`ROOM_COUNT` + filter='BEDROOM'/'BATHROOM'). The §4 table shows the principle on thermostats. | Real estimator practice IS per-room-type; villa-wide averages are too crude. The filter approach is one extra field per rule, worth the precision. |
| 6 | **Source of seed factors: the §4 table above OR your engineer's actual takeoff?** | **YOUR engineer's takeoff.** I'll author the schema + handler with PLACEHOLDER factors from §4; you hand me the engineer doc (or transcribed table) and I replace with the real ones in the same commit before merging. | The §4 numbers are educated guesses from your hints. Real estimator-confirmed numbers should land in the seed; otherwise the BOQ ships with my best-guess values that look authoritative but aren't. |
| 7 | **Rate source — bake into MepRule, or look up via existing Assembly system per discipline?** | Bake into MepRule for v1. Each rule = quantity × rate, one shot. Phase 2 evolves to "rule produces qty, Library Assembly prices it" once MEP brands/systems get formal. | Mirrors the paint Library pattern but lighter. Lets you ship MEP scope today without modeling Daikin / Carrier / Trane systems first. |
| 8 | **Edit UI: in the Library SPA (LIB-7) or a standalone MEP-Rules page?** | Tab inside the Library SPA. | Same surface as material systems; the estimator's mental model is "manage all derivation rules in one place." |

---

## 10. Build phases

### Phase 1 — the ruleset works end-to-end (~2-3 days)

1. Schema: `MepRule` model + 4 new TakeoffCategory enum values
   (MEP_HVAC, MEP_ELEC, MEP_PLUMB, MEP_ELV). One migration.
2. Seed: `apps/api/scripts/seed-mep-rules.ts` with the §4 HVAC
   ruleset + similar tables for Elec / Plumb / ELV (rates flagged
   as PLACEHOLDER pending your engineer's takeoff).
3. QUANTIFY extension: new derivation block reads MepRules,
   computes drivers from project takeoff state, emits MEP
   TakeoffItems with qty + rate + rateSource pointing at rule id.
4. BOQ generator: add MEP_* → section mapping. New sections 2.7 /
   2.71 / 2.72 / 2.73 (or whatever ordering you prefer in Q1).
5. PRICE: when line.rateSource starts with 'mep-rule:', skip the
   waterfall — the rate is already baked.
6. Verify on Lami: HVAC subtotal ~219k matches §4 expectation; full
   MEP scope rolls into the BOQ Summary alongside paint.

### Phase 2 — refinement (~1 week)

- Library SPA tab for editing rules + live preview per project.
- AI-extract from engineer takeoff PDF (factor + rate proposals
  with confirm UI).
- Multi-step chaining (`driverRuleId`) when a real case demands it.
- Per-project overrides.
- HVAC unit-split table (28.4 TR → discrete units).

### Out of scope (phase 3 or never)

- Detailed pipe routing / load balancing — that's an MEP engineer's
  software job, not a BOQ estimator's.
- Compliance verification (ASHRAE / UAE building code) — the
  engineer signs off on this; we just bill what they specify.

---

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wrong factor → MEP scope wildly off | High before seed is engineer-confirmed | High | Q6 — wait for your engineer's actual numbers before merging the seed. |
| Driver pattern misclassifies rooms (kitchen counted as bathroom) | Medium | Low | Reuse the existing `shouldSkirtRoom` / `estimateVanityForRoom` patterns; they're already proven on the Lami test set. |
| Rule emits qty=0 silently (rule defined but no matching driver) | Medium | Medium | BoqReviewNote `MEP_RULE_NO_DRIVER` per §8. |
| Estimator forgets a discipline (e.g. ELV missing entirely from rules) | Medium | High | Seed all 4 disciplines with at least one rule each so any gap is obvious in the BOQ Summary. |
| Different villa types have wildly different factors (commercial vs residential) | High | High | Phase-2 "project type" tag on MepRule so the engine picks villa-rules for villas, commercial-rules for offices. Currently single ruleset per org. |

---

## 12. What I need from you to build phase 1

1. **Sign off on the §3 schema + the §4 worked example.** If 28.4 TR
   → 79,520 AED at 2,800 AED/TR isn't representative, tell me the
   right rate range and I revise before coding.
2. **Answers to §9 Q1–Q8** (8 short calls, defaults are reasonable).
3. **The engineer's takeoff data** — for ANY of the 4 disciplines.
   Even a partial table is enough to seed real factors. Without it
   I'll seed §4-style placeholders flagged as "to be confirmed
   from engineer takeoff", and the BOQ ships with estimator-tunable
   defaults rather than authoritative numbers.

Mark up §9 + (1) + (3) and I build phase 1.
