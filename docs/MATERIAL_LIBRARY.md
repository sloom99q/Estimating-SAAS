# Material Library — Design Doc

> **Status:** design, not built. Awaiting sign-off on §3 schema +
> §11 open questions before code lands.
>
> **Position vs prior work:** the BOQ today is mostly extracted
> scope priced via a 6-tier waterfall whose 1st tier already
> consults `Assembly` (a multi-component recipe). The Library
> design is **not a rewrite** — it's filling 4 gaps that prevent
> the existing infrastructure from being the source of truth the
> estimator wants.

---

## 0. What this is, what it isn't

**Is:** a per-org, editable library of priced building systems
(paint, gypsum ceiling, screed, tiles, cabinetry, sanitary, lighting,
…). Each *system* is a recipe of MATERIAL + LABOR + TOOL line items
with coverage rates. Quantities measured from drawings (DXF rooms,
schedules, RCPs) get multiplied through a system to produce a
priced, **complete**, categorized BOQ that's traceable line-by-line
to a Library entry **and** to the source file/page.

**Isn't:**
- A marketplace or shared-tenant rate sheet — every org owns its
  library, prices are commercial decisions, no cross-org leakage.
- A replacement for the Material model (which represents discrete
  SKUs purchased from suppliers). The Library composes Materials
  into Systems; Materials stay as the SKU layer.
- A live price feed. Prices snapshot into the BOQ at generate time.
  Library edits affect future BOQs, not past ones (audit safety).

---

## 1. The Jotun example, modeled

Your scenario from the brief:

```
Brand:   Jotun
System:  Standard interior wall paint
Steps:
  1. Primer       — drum     65 AED /  100 m²
  2. Stucco       — bag      55 AED /   40 m²  × 2 coats
  3. Paint        — tin     270 AED /   50 m²  × 2 coats
  4. Labor        — labourer  6 AED /    1 m²
  5. Roller       — tool     10 AED /  100 m²
  6. Masking tape — tool      5 AED /   50 m²
```

Applied to a **50 m² wall**, the engine produces these BOQ rows
under one `2.9 Finishes — Paint` section group:

| Step | Qty calc | Unit | Cost |
|---|---|---|---:|
| Primer | 50 / 100 | 0.50 drum × 65 | 32.50 |
| Stucco × 2 coats | (50 / 40) × 2 | 2.50 bag × 55 | 137.50 |
| Paint × 2 coats | (50 / 50) × 2 | 2.00 tin × 270 | 540.00 |
| Labor | 50 | 50 m² × 6 | 300.00 |
| Roller | 50 / 100 | 0.50 set × 10 | 5.00 |
| Masking tape | 50 / 50 | 1.00 roll × 5 | 5.00 |
| **System line subtotal** | | | **1,020.00** |

Per m²: **20.40 AED/m²**. This is what the estimator wants to bake
once and reuse across projects.

---

## 2. What the schema already has

The existing models cover ~70% of this. **The Library design is
mostly Brand + UI + mapping, not new pricing tables.**

| Existing model | What it stores | Library role |
|---|---|---|
| `Material` | A discrete SKU: name, category, unit, **unitPrice**, **coverage**, wastePct, supplier (free-text), currency. Has `MaterialSupplierPrice` linkage for multi-supplier quotes. | The leaf "what we buy". Library `MATERIAL` components reference this. |
| `Assembly` | A named recipe with `appliesTo` ('WALL' \| 'FLOOR' \| 'CEILING' \| 'GENERIC') + `outputUnit`. Owned per org. | **This is "System".** Jotun Std Interior Paint = an `Assembly` with appliesTo='WALL', outputUnit='m²'. |
| `AssemblyComponent` | A recipe leaf: `kind` ('MATERIAL' \| 'LABOR' \| 'TOOL_FIXED'), label, unitPrice, coverage, coats, wastagePct, fixedCost, optional materialId pointer. | The recipe steps — Primer, Stucco, Paint, Labor, Roller, Tape rows above. |
| `RateLibraryItem` | A flat fallback rate by code/region (e.g. 'PAINT-INT-STD' = 20 AED/m²). Per-org or global. | Stays as the §4.7 PRICE waterfall fallback when no Assembly matches. |
| `Supplier` | Vendor profile. | Untouched — Library doesn't need new supplier concepts. |

The `AssemblyComponent` formula (from a code comment in schema.prisma):

```
MATERIAL  : (unitPrice / coverage) × coats × (1 + wastagePct/100)
LABOR     : unitPrice (per outputUnit)
TOOL_FIXED: fixedCost / projectQty (amortised over the run)
```

This is exactly the Jotun example's math, already implemented in
`apps/api/src/pricing/assemblyEngine.ts` (function
`computeAssemblyUnitCost`) and consumed by `price.ts` as the 1st
tier of the rate waterfall.

---

## 3. The four gaps + concrete schema additions

### 3.1 Gap: no Brand entity

Today `Material.supplier` is a free-text string and `Assembly` has
no brand association. The estimator wants to filter the Library by
brand (Jotun vs Berger vs Asian Paints).

**Proposal — new `Brand` model:**

```prisma
model Brand {
  id             String    @id @default(cuid())
  organizationId String
  name           String       // 'Jotun'
  /// 'paint' | 'sanitary' | 'tile' | 'gypsum' | 'electrical' |
  /// 'lighting' | 'joinery' | 'mep' | 'other'
  category       String
  /// Optional contact + website fields; copied from Supplier model.
  website        String?
  notes          String?
  active         Boolean   @default(true)
  createdAt      DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt      DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt      DateTime? @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id])
  systems      Assembly[]
  materials    Material[]

  @@unique([organizationId, name, category])
  @@index([organizationId, category, active])
  @@map("brands")
}
```

Both `Assembly` and `Material` gain a nullable `brandId`. Existing
rows keep working (null brand = "ungrouped" in the UI).

### 3.2 Gap: no System ↔ takeoff-category default mapping

Today `Assembly.appliesTo` is one of WALL / FLOOR / CEILING /
GENERIC. The PRICE waterfall matches by appliesTo + line category
heuristics. The estimator wants finer control: "use Jotun Standard
for WALL_FINISH rows whose finish_code is in {WP01, WP02, default};
use Jotun Premium for finish_code='WP-PREMIUM'."

**Proposal — extend `Assembly` with two routing fields:**

```prisma
// add to Assembly
brandId        String?
/// Which TakeoffItem category this system bills against, when
/// PRICE has no per-line override. Replaces the loose appliesTo
/// string with the typed enum.
takeoffCategory TakeoffCategory?
/// Optional: a list of finish codes this system is the default
/// for. Null = applies to ANY code in that category (the org's
/// "house" system). Array stays inline since finish codes are
/// short and the list is small.
defaultForFinishCodes String[] @default([])
/// When multiple systems match a line, the lowest sortOrder wins.
/// Lets the user say "Jotun Premium beats Jotun Standard for
/// WP-PREMIUM rows" without code changes.
sortOrder      Int     @default(100)
```

Result: routing is data-driven. Adding a new system = one row +
one finish-code entry; no handler changes.

### 3.3 Gap: no wall-area derivation from rooms

DXF gives room area (m²); wall paint is billed by wall area
(perimeter × height). Today QUANTIFY uses an aspect-ratio prior to
guess perimeter from area; not great. The Library design assumes
each ROOM TakeoffItem carries:
- `meta.area_m2` (from DXF / vision)
- `meta.perimeter_m` (NEW — from DXF where polygons exist, else
  computed `2 × √area × aspect`)
- `meta.ceilingHeight_m` (NEW — per-project default 3.0, overridable
  per-room in the SPA)

QUANTIFY derives a new TakeoffItem at category=`PAINT` per room
with `qtyAi = perimeter_m × ceilingHeight_m`. The PRICE waterfall
then expands the Library system on top.

For DXF rooms (currently no polygon since LAMI files don't carry
them), perimeter is derived from area via the aspect prior — same
fallback as today's skirting derivation. Phase 2 of DXF (the
LINE-graph polygon reconstruction we shelved) would replace the
prior with measured perimeter.

**No schema change for this — it's QUANTIFY logic + 2 fields on
`Project` for ceilingHeight default.**

### 3.4 Gap: Library UI

There's no SPA today to browse / edit Brands, Systems, Components.
The materials feature has a gallery for Materials but no system-level
recipe editor.

Proposal:
- New feature folder `src/features/library/` (folder name lives in
  shared/, exposed at app level since it's cross-cutting like dxf/)
- Three nav levels: **Brands** → **Systems** → **Components**
- Each Component edit row: kind (MATERIAL / LABOR / TOOL), label,
  unitPrice, coverage, coats, wastagePct, optional Material picker
- Live preview per System: "applied to 50 m² → 1,020 AED → 20.40
  AED/m²"
- Org-level read/write; per-project overrides come later (phase 2)

---

## 4. Pricing flow (with worked example: LIVING wall paint)

Given DXF rooms from A101:

```
GF-04 LIVING  area 58.82 m²  basis MEASURED
```

QUANTIFY emits derived takeoff items:

```
ROOM     GF-04 LIVING            58.82 m²   (input)
SCREED   SCREED-FLR-GF-04         58.82 m²
PAINT    PAINT-WALL-GF-04        86.10 m²  ← derived: perimeter × ceilingHeight
                                              perimeter ≈ 4 × √58.82 = 30.7 m (square-prior)
                                              × 2.8 m height = 86.0 m²
CEILING  CL01-GF-04              58.82 m²  (if ceiling type confirmed)
SKIRTING SK-GF-04                 30.7 m   (perimeter)
```

PRICE walks each line:

```
PAINT-WALL-GF-04  →  86.10 m²  →  rate waterfall
  Tier 1: org Assembly where takeoffCategory='PAINT'
          AND ('WP01' in defaultForFinishCodes OR list is empty)
          → "Jotun Standard interior wall paint" (sortOrder 100)
  → computeAssemblyUnitCost(assembly, qty=86.10) → 20.40 AED/m²
  → line.rate = 20.40, amount = 86.10 × 20.40 = 1,756.44 AED
  → rateSource = 'assembly:jotun-std'
```

The BOQ row in section 2.9 reads:

```
2.9/NNN  Wall paint (Jotun Standard) — LIVING
         qty 86.10 m²   rate 20.40 AED/m²   = 1,756.44 AED
         [view recipe]  [source: A101.dxf p1 + room GF-04]
```

`[view recipe]` opens a side-panel showing all 6 sub-components +
the math; `[source]` jumps to the underlying DXF doc + room
TakeoffItem.

---

## 5. Source reference per line

Every BoqLine today has `takeoffItemId` (when generated from
extraction) or NULL (manual P/S). The schema already supports
provenance — the SPA just doesn't surface it well.

**Proposal:**
- Render `[source]` chip per priced line. Hovers shows
  `<filename> · <page/sheet> · <takeoff tag>`.
- Click → opens the document viewer at the relevant sheet, with the
  room polygon / schedule row highlighted (phase 2 — needs the
  document viewer that doesn't exist yet; phase 1 = open the PDF in
  a new tab at the right page via pdf.js anchor).
- For manual P/S: chip reads `[manual]` instead.

**No schema change.** TakeoffItem already has `sourceSheetId`,
`sourceNote`, and the meta blob holds page/position.

---

## 6. AI notes / concerns at the end

Today `ValidationFlag` rows already capture rule violations
(missing finish codes, area-vs-BUA mismatches, label-pair-distance
variance, etc.). The BOQ XLSX doesn't render them.

**Proposal:**
- New section in the SPA BOQ view: **"Review before signing off"**
- Pulls every unresolved ValidationFlag for the project + adds new
  pricing-time concerns:
  - Lines priced via `RateLibraryItem` global (org has no per-org
    rate or Assembly — "you may want to add this to your library")
  - Lines that fell to P/S because no rate matched
  - Lines where the Library system's component is missing
    `unitPrice` (incomplete recipe)
  - Lines whose `meta.suggestedSystem` differs from the system
    actually used (estimator override)
- Each item is **dismissible** (writes a row to a new `BoqReviewNote`
  with `resolvedAt` timestamp). Dismissed notes don't show on the
  next regenerate; new ones do.

**New tiny model:**

```prisma
model BoqReviewNote {
  id             String   @id @default(cuid())
  organizationId String
  projectId      String
  boqId          String
  /// Stable hash of (rule + boqLineId) — lets re-generate carry
  /// dismissal forward.
  noteKey        String
  rule           String   // e.g. 'PRICE_FALLBACK_TO_GLOBAL'
  severity       String   // 'WARN' | 'INFO'
  message        String
  boqLineId      String?
  resolvedAt     DateTime? @db.Timestamptz(6)
  resolvedBy     String?
  createdAt      DateTime  @default(now()) @db.Timestamptz(6)

  @@unique([projectId, boqId, noteKey])
  @@index([projectId, resolvedAt])
  @@map("boq_review_notes")
}
```

---

## 7. Upload flow change — no auto-pipeline

Today: PDF upload immediately enqueues INGEST → chains through
CLASSIFY → LEGEND → SCHEDULES → ROOMS. Same for DXF when the layer
map is saved.

**Proposed:**
- Upload routes set Document.status='UPLOADED' and do NOT enqueue.
- Add a per-document **Start** button in DocumentsListCard.
- The button enqueues INGEST (PDF) or PARSE_DXF (DXF) for that
  single doc. A project-level **"Start all"** button fires for
  every UPLOADED doc.
- Multi-doc gate releases when every doc is (READY | FAILED |
  SKIPPED).
- BOQ generation is already user-triggered (Generate button). No
  change there.

This gives the estimator a moment to delete obviously-wrong uploads
before tokens spend. Cost: one extra click per project. The current
auto-start is convenient but the estimator wants control.

**No schema change.** Just the SPA + route changes.

---

## 8. In-UI BOQ rendering

Today the BOQ is database-only — the SPA shows a summary card
("BOQ v12 ready · subtotal X AED") and a download button.
Estimator wants to **see** the BOQ in the browser, scroll through
it, edit inline, then export.

**Proposal:**
- New page route `/projects/:id/boq` (or a tab on the workspace).
- Sectioned table layout matching XLSX: 1.0 General, 2.5 Metal,
  2.6 Wood, 2.8 Doors/Windows, 2.9 Finishes, 3.1 External, 4.0
  Provisional Sums.
- Each section: collapsible, with subtotal in the header.
- Each row: itemRef, description, brand (NEW), unit, qty (inline
  editable), rate, amount, `[source]` chip, `[recipe]` chip,
  `[delete]` icon.
- Footer: grand total + currency.
- Export buttons stay (client XLSX, internal XLSX) — but viewing is
  the primary affordance, downloading is the secondary.

---

## 9. Wall paint specifically — phase 1 acceptance

Demonstrating the Library end-to-end against the LAMI test project:

1. Seed Library: one Brand (Jotun), one System (Std Interior Wall
   Paint) with the 6 components from §1. Add a basic ceiling
   gypsum system + a basic floor screed system so all rooms get
   priced via Library, not RateLibrary fallback.
2. Upload A101 + A102 DXFs (modal opens, save LayerMap, PARSE_DXF
   runs — already working).
3. QUANTIFY emits PAINT rows for each room: qty =
   perimeter_aspect × 2.8 m height (perimeter aspect prior, same
   today's skirting derivation).
4. PRICE matches PAINT lines to the Jotun system → 20.40 AED/m²
   line rate.
5. Generate BOQ. Inspect the SPA view (§8): every PAINT line shows
   "(Jotun Standard)" in the description, the recipe chip expands
   to show the 6 component lines.
6. Edit Brand → System → Primer price from 65 to 70 in the Library
   UI. Re-run BOQ. PAINT rate becomes 20.55 AED/m². Audit:
   `BoqLine.rateSource` shows `'assembly:jotun-std@v2'` (new
   version after edit — see §10).

---

## 10. Versioning & audit safety

Library edits MUST NOT silently change historical BOQ totals.
Today the schema doesn't version Assembly / AssemblyComponent
rows.

**Proposal — snapshot at generate time:**
- Add `Boq.libraryFingerprint` (JSON) capturing every Assembly +
  Components used in the generation. Stored at BOQ creation, never
  mutated.
- Library edits are free; the next regenerate uses the new prices.
- "View recipe" on a historical BOQ reads from
  `libraryFingerprint`, not the live Library row.
- A SHA of the fingerprint is shown in the XLSX header so two
  exports can be diff'd.

**Schema:**

```prisma
// add to Boq
libraryFingerprint Json?
```

---

## 11. Open questions — please weigh in

| # | Question | Default I'd pick | Why I'd want your input |
|---|---|---|---|
| 1 | **Brand model: new entity, or extend `Material.supplier` to a relation?** | New `Brand` entity. | Brand and Supplier are different concepts (Jotun the brand, Ace Hardware the supplier). New entity keeps both clean. Extending supplier conflates them. |
| 2 | **System overrides per project, or org-only for phase 1?** | Org-only. Project-level overrides phase 2. | Org-only is simpler and matches what "library" usually means. Per-project overrides are useful when a specific client demands a non-standard system; can wait. |
| 3 | **Wall paint: derive `perimeter × height` in QUANTIFY, or wait for DXF polygon reconstruction?** | Derive now via aspect prior; tighten later. | Aspect prior is 5-15% off but unblocks the biggest missing scope today. Polygon reconstruction is its own multi-day project. |
| 4 | **Coats stored on AssemblyComponent (current) or on the recipe step?** | Stays on AssemblyComponent. | Current: each component carries coats. Alternative: separate "step" table with coats once + multiple components per step. AssemblyComponent works for the Jotun example as-is — don't add a layer unless real systems need it. |
| 5 | **Lighting / MEP — auto-counted from RCP, or P/S until we have a fixtures schedule extractor?** | P/S for phase 1. Auto-count phase 2. | Counting fixtures from RCP needs INSERT-counting on the I101 DXFs (which auto-skip today because no room labels). Manual P/S with a Library "Lighting allowance" system row gets the estimator there immediately. |
| 6 | **Upload "Start" button: per-doc, project-level, or both?** | Both. | Per-doc lets the estimator hand-pick (skip a doc that's mis-uploaded). Project-level "Start all" is the one-click happy path. |
| 7 | **`BoqReviewNote` table for AI concerns, or render ValidationFlag inline?** | New table. | ValidationFlag is broader (validators across the whole pipeline). Notes are pricing/BOQ-time concerns with dismissal semantics. Keeping them separate avoids mixing the lifecycles. |
| 8 | **Library seed: hand-author a starter library for your org, or empty + you populate?** | Hand-author a Jotun paint + KP gypsum + standard screed + standard tile + a "general lighting allowance" so the first BOQ has rates from day 1. You override. | Without seed, the BOQ falls to global RateLibrary or P/S until you build the library — slower to demo. With seed, you start with realistic numbers you can edit. |

---

## 12. Build phases

### Phase 1 (the foundation, ~3-4 days)

1. **Schema**: add `Brand`, `Assembly.brandId/takeoffCategory/defaultForFinishCodes/sortOrder`, `Material.brandId`, `Project.defaultCeilingHeightM` + per-room `meta.ceilingHeight_m`, `Boq.libraryFingerprint`. One migration.
2. **Library CRUD routes**: `/api/library/brands`, `/api/library/systems`, `/api/library/systems/:id/components`.
3. **Library SPA**: `src/features/library/` with Brand → System → Components navigator + editor + live preview.
4. **Seed**: one paint system (Jotun Std), one gypsum (KP CL02), one screed, one tile (default ST01).
5. **QUANTIFY wall area**: derive PAINT lines per room (perimeter × height). Adds 1 new TakeoffCategory entry.
6. **PRICE routing**: extend Assembly match to use `takeoffCategory` + `defaultForFinishCodes`. Backward-compatible with existing `appliesTo`.
7. **BOQ fingerprint**: snapshot library at generate time.
8. **In-UI BOQ page** (§8): the sectioned scrollable view with inline qty edit + source/recipe chips.

### Phase 2 (polish, ~1 week)

- Project-level system overrides (Q2).
- Auto-counted lighting/MEP from RCP DXFs (Q5).
- Upload "Start" gate (§7).
- Document viewer for `[source]` chip (§5 phase 2).
- Library import/export (CSV) for bulk pricing updates.
- Library audit log (who changed what, when).

### Out of scope (forever or much later)

- Cross-org library sharing.
- Live price feeds (Anthropic / supplier APIs).
- AI-generated systems from a brand's product catalog.

---

## 13. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wall area off by aspect-prior error (5-15%) | High | Medium | Disclose in the BOQ line: "wall area derived from aspect prior — re-measure for billing accuracy". Phase-2 polygon reconstruction tightens. |
| Estimator builds a 50-system library, regenerates BOQ, prices change retroactively | Low | High | `Boq.libraryFingerprint` snapshot is the answer (§10). Past BOQs immutable. |
| Library + RateLibrary diverge over time | Medium | Low | PRICE waterfall already prefers Assembly over RateLibrary, so Library wins by construction. RateLibrary stays as the bootstrap fallback. |
| Brand naming inconsistency across orgs (we don't standardize "Jotun" vs "JOTUN" vs "Jotun Paints") | High | Low | Per-org Brand, case-insensitive uniqueness on (org, name, category). |
| Estimator misclicks the system on a high-value BOQ line | Medium | Medium | Inline `[source]` + `[recipe]` chips make it auditable. Plus the AI notes (§6) flag fallback-to-RateLibrary cases. |

---

## 14. References

- Existing models: `apps/api/prisma/schema.prisma` (Material 280, Assembly 605, AssemblyComponent 630, RateLibraryItem 662, Boq 685, BoqLine 736)
- Existing pricing engine: `apps/api/src/pricing/assemblyEngine.ts`
- Existing PRICE handler: `apps/api/src/jobs/handlers/price.ts`
- Existing materials SPA: `src/features/materials/`
- DXF design (sibling): `docs/DXF.md`
