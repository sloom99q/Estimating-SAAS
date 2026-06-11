# FITOUT OS — AI Drawing Takeoff & Cost Breakdown Engine
## Implementation Spec v1.0 — built from the Plot 4357 pilot (AI takeoff vs Triple-A actual quote)

**Scope of this spec:** ONLY the money path — `Upload Drawings → AI Takeoff → Review → BOQ → Priced Cost Breakdown → Quotation (xlsx/pdf)`.
Calendar, invoicing, tasks, dashboards, visuals: explicitly out of scope until this works end-to-end.

**Existing stack (keep):** Bun API, Prisma, JWT auth, React + Zustand + React Query, Organizations/Users/Projects/Spaces/Materials models.
**Required changes:** SQLite → PostgreSQL; add object storage (S3/Cloudflare R2); add a background job runner; add Anthropic API integration.

---

## 0. Why this architecture (evidence from the pilot)

The pilot processed the real 58-sheet villa set and was compared line-by-line against Triple-A's actual quote (Ref Qo/202605/221 Rev-01, AED 2,059,000):

| Extraction method | Pilot accuracy vs real QS | Product implication |
|---|---|---|
| Read from schedule tables / printed room labels | ±5–15% | Automate fully, light review |
| Derived arithmetic on labeled values | ±10–25% | Automate, show confidence |
| Visually estimated from raster | ±30–50% | Must be replaced by measurement or marked clearly |
| Parametric (no source drawing) | order-of-magnitude | Always label PROVISIONAL |
| Provisional sums | n/a | Normal practice — 53% of the REAL quote was P/S |

Two empirical bugs that define hard requirements:
1. **Adjacent-row count swap** — whitespace-layout text extraction swapped window quantities between neighboring schedule rows (CW09↔CW10, CW11↔CW12, CW15↔CW16) and dropped CW02 entirely. → Requirement: schedule extraction must be **vision-anchored (per-cell from the rendered image)** AND cross-checked against the text layer; any disagreement creates a ValidationFlag instead of a silent pick.
2. **Plan-area vs developed-area** — stairs measured as plan m² when the trade prices tread/riser linear meters. → Requirement: a deterministic **rules engine** owns all quantity math; the LLM never computes quantities, it only extracts labeled facts.

**Division of labor (the core design rule):**
- LLM (Claude API): classify sheets, read schedules/legends/labels/notes → structured JSON facts with provenance.
- Deterministic TypeScript: all arithmetic, all quantity rules, all validation, all pricing.
- Human: reviews flagged + low-confidence items in a table UI; every edit is logged and becomes training/calibration data.

---

## 1. Multi-tenancy (answer to "each user must have their own database")

**Pattern: single PostgreSQL database, shared schema, row-level tenancy via `organizationId`.**
NOT database-per-user. Database-per-tenant means N× migrations, N× backups, connection-pool exhaustion, and no cross-tenant rate intelligence. It is an enterprise add-on for year 3, not the foundation.

Rules:
1. Every tenant-owned table has `organizationId String` + index. All unique constraints are composite: `@@unique([organizationId, code])`.
2. Tenancy is enforced **once**, centrally — a Prisma client extension injects the org filter so application code cannot forget it:

```ts
// db/tenantClient.ts
import { PrismaClient } from '@prisma/client'

const TENANT_MODELS = new Set(['Project','Space','Document','Sheet','TakeoffItem','ValidationFlag',
  'Material','Supplier','SupplierPrice','LaborRate','Assembly','Boq','BoqLine','Quotation','Job','Correction'])

export function tenantDb(orgId: string) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && TENANT_MODELS.has(model)) {
            if (['findMany','findFirst','findUnique','update','updateMany','delete','deleteMany','count','aggregate'].includes(operation)) {
              args.where = { ...(args.where ?? {}), organizationId: orgId }
            }
            if (['create'].includes(operation)) {
              args.data = { ...(args.data ?? {}), organizationId: orgId }
            }
            if (operation === 'createMany') {
              args.data = (args.data as any[]).map(d => ({ ...d, organizationId: orgId }))
            }
          }
          return query(args)
        },
      },
    },
  })
}
// In every route handler: const db = tenantDb(jwt.orgId)
```

3. JWT payload: `{ userId, orgId, role }`. Role ∈ OWNER | ESTIMATOR | VIEWER.
4. File storage: S3/R2 keys are `org/{orgId}/projects/{projectId}/documents/{docId}/...`. Signed URLs only; never public.
5. Anthropic API key is **yours** (server-side env), never per-tenant, never exposed to the browser. Meter usage per org (`pagesProcessed`) for billing later.
6. Migration: `prisma migrate` from SQLite → Postgres now, while the schema is small. Postgres is required because the pipeline workers write while users read (SQLite = single writer).

---

## 2. Data model (Prisma) — full schema delta

Keep existing User/Organization/Project. Add/replace the following:

```prisma
model Membership {
  id             String @id @default(cuid())
  userId         String
  organizationId String
  role           Role   @default(ESTIMATOR)
  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@unique([userId, organizationId])
}
enum Role { OWNER ESTIMATOR VIEWER }

// ---------- DRAWING TAKEOFF ----------
model Document {
  id             String  @id @default(cuid())
  organizationId String
  projectId      String
  filename       String
  storageKey     String
  pageCount      Int?
  status         DocStatus @default(UPLOADED) // UPLOADED→PROCESSING→READY|FAILED
  project        Project @relation(fields: [projectId], references: [id])
  sheets         Sheet[]
  createdAt      DateTime @default(now())
  @@index([organizationId, projectId])
}
enum DocStatus { UPLOADED PROCESSING READY FAILED }

model Sheet {
  id           String  @id @default(cuid())
  documentId   String
  pageNo       Int
  drawingNo    String?   // "A101"
  title        String?   // "GROUND FLOOR PLAN"
  discipline   String?   // ARCH | ID | STR | MEP | UNKNOWN
  sheetType    String?   // cover|register|plan|elevation|section|schedule|legend|detail|rcp|finish_plan|other
  scaleNote    String?   // "1:75"
  hasTextLayer Boolean  @default(false)
  rawTextKey   String?   // storage key of extracted text
  imageKey     String?   // storage key of rendered jpeg
  aiJson       Json?     // raw classification payload
  document     Document @relation(fields: [documentId], references: [id])
  @@unique([documentId, pageNo])
}

model TakeoffItem {
  id             String  @id @default(cuid())
  organizationId String
  projectId      String
  category       TakeoffCategory
  tag            String?      // "CW09", "D01", "ST01", "Master Bedroom"
  description    String
  unit           String       // m2, m, No, Set, Item, Sum
  qtyAi          Decimal?     // what the pipeline produced
  qtyFinal       Decimal?     // after human review (null = not reviewed)
  basis          Basis        // MEASURED|DERIVED|VISUAL|PARAMETRIC|PLACEHOLDER
  confidence     Int          // 0-100, from rubric §7
  sourceSheetId  String?
  sourceNote     String?      // "A551 schedule row 4" / "sum of labeled rooms"
  status         ItemStatus   @default(AI) // AI→EDITED→APPROVED
  meta           Json?        // dims, floor, finishCode, etc.
  @@index([organizationId, projectId, category])
}
enum TakeoffCategory { ROOM DOOR WINDOW SKYLIGHT FLOOR_FINISH WALL_FINISH CEILING SCREED PAINT PLASTER BLOCKWORK WATERPROOFING METAL GRC JOINERY SANITARY EXTERNAL STRUCTURE_PROV MEP_PROV OTHER }
enum Basis { MEASURED DERIVED VISUAL PARAMETRIC PLACEHOLDER }
enum ItemStatus { AI EDITED APPROVED }

model ValidationFlag {
  id            String @id @default(cuid())
  organizationId String
  projectId     String
  takeoffItemId String?
  rule          String   // "ROW_SWAP_SUSPECT", "TAG_NOT_ON_PLAN", ...
  severity      String   // ERROR | WARN | INFO
  message       String
  resolved      Boolean @default(false)
  @@index([organizationId, projectId, resolved])
}

// ---------- COST ENGINE ----------
model Supplier {
  id             String @id @default(cuid())
  organizationId String
  name           String
  contact        String?
  email          String?
  phone          String?
  paymentTermsDays Int?    // 30/60/90
  creditLimitAed Decimal?
  prices         SupplierPrice[]
}

model SupplierPrice {
  id         String @id @default(cuid())
  organizationId String
  materialId String
  supplierId String
  price      Decimal
  unit       String
  preferred  Boolean @default(false)
  validFrom  DateTime @default(now())
  material   Material @relation(fields: [materialId], references: [id])
  supplier   Supplier @relation(fields: [supplierId], references: [id])
  @@index([materialId])
}

model LaborRate {
  id             String @id @default(cuid())
  organizationId String
  trade          String   // Painter, Tiler, Carpenter...
  unit           String   // m2 | day | hr | lm
  rate           Decimal
  quality        String @default("STANDARD") // BUDGET|STANDARD|PREMIUM
}

// ASSEMBLY = the "Jotun system" insight: a recipe, not a material
model Assembly {
  id             String @id @default(cuid())
  organizationId String
  name           String      // "Jotun Interior Paint System A"
  appliesTo      String      // WALL|FLOOR|CEILING|GENERIC
  outputUnit     String      // m2
  components     AssemblyComponent[]
  @@unique([organizationId, name])
}
model AssemblyComponent {
  id          String @id @default(cuid())
  assemblyId  String
  kind        String    // MATERIAL | LABOR | TOOL_FIXED | TOOL_PER_UNIT
  materialId  String?
  laborRateId String?
  coverage    Decimal?  // m2 per unit of material (e.g. 100 sqm/drum)
  coats       Int @default(1)
  wastagePct  Decimal @default(5)
  fixedCost   Decimal?  // for TOOL_FIXED
  assembly    Assembly @relation(fields: [assemblyId], references: [id])
}
// unitCost(assembly) = Σ material: (price/coverage)*coats*(1+wastage) + Σ labor.rate + Σ tools

model RateLibraryItem {       // org-level learned rates + global seed
  id             String @id @default(cuid())
  organizationId String?     // null = global seed visible to all
  code           String      // "FLR-ST01", "DOOR-1000x3000"
  description    String
  unit           String
  rate           Decimal
  source         String      // "Triple-A quote 06/2026", "PO #...", "manual"
  region         String @default("SHJ")
  capturedAt     DateTime @default(now())
  @@index([code])
}

// ---------- BOQ / QUOTE ----------
model Boq {
  id             String @id @default(cuid())
  organizationId String
  projectId      String
  version        Int @default(1)
  status         String @default("DRAFT") // DRAFT|REVIEWED|LOCKED
  currency       String @default("AED")
  sections       BoqSection[]
}
model BoqSection {
  id      String @id @default(cuid())
  boqId   String
  code    String  // "2.6", "2.8", "2.9", "3.1", "4.0"  (Triple-A bill structure)
  title   String
  sortOrder Int
  lines   BoqLine[]
  boq     Boq @relation(fields: [boqId], references: [id])
}
model BoqLine {
  id            String @id @default(cuid())
  organizationId String
  sectionId     String
  itemRef       String   // "A", "B", ...
  description   String
  unit          String
  qty           Decimal?
  rate          Decimal?
  rateSource    String?  // ORG_RATE|SUPPLIER|ASSEMBLY|LIBRARY|MANUAL|PS
  amount        Decimal? // qty*rate, or psAmount
  isProvisional Boolean @default(false)
  psAmount      Decimal?
  confidence    Int?
  takeoffItemId String?
  assemblyId    String?
  section       BoqSection @relation(fields: [sectionId], references: [id])
}
model Quotation {
  id             String @id @default(cuid())
  organizationId String
  projectId      String
  boqId          String
  ref            String   // "Qo/YYYYMM/serial Rev-NN"
  clientName     String
  discount       Decimal @default(0)
  vatPct         Decimal @default(5)
  total          Decimal?
  validityDays   Int @default(30)
  status         String @default("DRAFT")
}

model Correction {   // THE LEARNING LOOP — every human edit
  id             String @id @default(cuid())
  organizationId String
  entity         String   // "TakeoffItem" | "BoqLine"
  entityId       String
  field          String   // "qty" | "rate" | "description"
  aiValue        String?
  humanValue     String?
  reason         String?
  createdAt      DateTime @default(now())
}

model Job {
  id             String @id @default(cuid())
  organizationId String
  projectId      String?
  type           String   // INGEST|CLASSIFY|EXTRACT_SCHEDULES|EXTRACT_ROOMS|QUANTIFY|VALIDATE|PRICE|EXPORT_XLSX
  payload        Json
  status         String @default("QUEUED") // QUEUED|RUNNING|DONE|FAILED
  attempts       Int @default(0)
  error          String?
  result         Json?
  createdAt      DateTime @default(now())
  startedAt      DateTime?
  finishedAt     DateTime?
  @@index([status, createdAt])
}
```

---

## 3. Background job runner (no Redis needed at this stage)

Long AI jobs must NEVER run inside an HTTP request. Use a **Postgres-backed queue**: the `Job` table + a worker loop in the same Bun process (or a second Bun process).

```ts
// worker/loop.ts
const HANDLERS: Record<string, (job: Job) => Promise<any>> = {
  INGEST, CLASSIFY, EXTRACT_SCHEDULES, EXTRACT_ROOMS, QUANTIFY, VALIDATE, PRICE, EXPORT_XLSX,
}
async function tick() {
  const job = await base.$queryRaw`
    UPDATE "Job" SET status='RUNNING', "startedAt"=now(), attempts=attempts+1
    WHERE id = (SELECT id FROM "Job" WHERE status='QUEUED' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`     // SKIP LOCKED = safe with multiple workers, another reason for Postgres
  if (!job) return
  try { const result = await HANDLERS[job.type](job)
        await done(job.id, result)
        await enqueueNext(job) }            // pipeline chaining
  catch (e) { await fail(job.id, e) }       // retry up to 3, then FAILED + user-visible error
}
setInterval(tick, 1500)
```

Pipeline chain per document: `INGEST → CLASSIFY → EXTRACT_SCHEDULES + EXTRACT_ROOMS → QUANTIFY → VALIDATE → (user review) → PRICE → EXPORT_XLSX`.
Frontend polls `GET /documents/:id` (React Query refetchInterval 2000) and shows per-stage progress.

---

## 4. The pipeline jobs (the LOGIC)

### 4.1 INGEST
- Save PDF to storage. Run `pdfinfo` (page count, page size), `pdffonts` (text layer present?).
- Per page: `pdftotext -layout` → store text; `pdftoppm -jpeg -r 110` → store image (≤ ~2000px long edge for API calls; render plan/schedule sheets again at 200 DPI later when needed).
- Create `Sheet` rows. PDF without text layer ⇒ mark every sheet `hasTextLayer=false` (vision-only mode, lower confidence ceiling).

### 4.2 CLASSIFY (Claude API, 1 call per page, batchable)
Model: claude-sonnet (cost/speed) — upgrade per-sheet to a stronger model only when extraction conflicts occur.
Send the page image + first 1,500 chars of its text. Force JSON via tool use:

```json
{ "drawing_no":"A101", "title":"GROUND FLOOR PLAN", "discipline":"ARCH",
  "sheet_type":"plan", "scale":"1:75", "floor":"GF", "confidence":0.95 }
```
Output: completed Sheet rows = the **drawing register**. Immediately tell the user what's missing:
"No STRUCTURAL or MEP sheets detected → those sections will be PROVISIONAL." (This honesty is a feature, proven by the pilot.)

### 4.3 EXTRACT_SCHEDULES (the highest-value extraction — and where the row-swap bug lives)
For each sheet classified `schedule|legend` (doors A551, glazing A501/A502, finishes legend I401):
1. Render that page at 200 DPI; crop the table region if locatable.
2. Claude vision call with a strict tool schema, instruction: *"Read the table CELL BY CELL from the image. For each row return every column value AND the row's visual y-order. Do not infer missing values."*
   - doors: `{tag, count, width_mm, height_mm, panel_height_mm, finish, description}`
   - windows: `{tag, count, width_mm, height_mm, type, floor}`
   - finishes: `{code, name, material, size, finish, usage}`
3. **Cross-check against the text layer** parsed independently. Field-level compare:
   - match → basis=MEASURED, confidence 90–95
   - mismatch → keep BOTH values in `meta`, basis=MEASURED, confidence 60, `ValidationFlag(ROW_MISMATCH, ERROR)` → forced human review. *(This single rule catches the CW09↔CW10 swap class of error.)*
4. Persist as TakeoffItems (category DOOR/WINDOW/...).

### 4.4 EXTRACT_ROOMS → auto-create Spaces
Plans + finish plans carry labeled room tags ("MASTER BEDROOM / FF-11 / 38.35 m²") — pilot showed these sum to within 6–15% of the real QS.
1. Text-layer regex pass: `/(?<name>[A-Z][A-Z' \/0-9-]{2,})\s+(?:[A-Z]{2}-\d+\s+)?(?<area>\d+\.\d{2})\s*m²/` per plan sheet.
2. Vision pass on the same sheet returns `{room, code, floor, area_m2}` list.
3. Reconcile (same rule as 4.3). Create **Space** rows: `{name, code, floor, areaM2, source:TAKEOFF, confidence}` — this replaces manual L×W×H entry (your Step 4). Height defaults from section sheets (GF 4.00 m floor-to-floor found on sections) else org default; wall/ceiling areas computed when perimeter is known, else flagged PARAMETRIC.

### 4.5 QUANTIFY (deterministic TypeScript — zero LLM)
Rules engine mapping facts → quantities. Examples (encode exactly these, they are the pilot's lessons):

```ts
// floors: finish plan color/legend mapping per room
floorQty(rooms, finishCode) = Σ room.areaM2 where room.floorFinish === finishCode   // basis DERIVED, conf 85-92

// skirting: perimeter-based, NOT guessed
skirtingLm = Σ room.perimeterM − Σ doorWidthsInRoom                                  // if perimeter unknown → PARAMETRIC flag

// stairs: NEVER plan area (pilot error)
stairTreadLm   = risers × stairWidthM            // priced per lm like the real quote (40 lm @ 800)
stairRiserArea = risers × (treadM + riserM) × widthM

// walls (when measurable): centerline × height − openings(from schedules)
// openings deduction uses door/window schedule dims — already MEASURED data

// paint via Assembly: qty = wallArea; cost from assembly recipe (§6)

// anything with no source sheet (structure, MEP): generate as PARAMETRIC/PLACEHOLDER
// with explicit ± range text in description. Never silent precision.
```

### 4.6 VALIDATE (the rules that would have caught every pilot error)
| Rule | Catches |
|---|---|
| `ROW_MISMATCH` text-vs-vision field compare | CW09↔CW10 count swaps, dropped CW02 |
| `TAG_COVERAGE` every schedule tag appears on ≥1 plan, and every plan tag exists in schedule | missing/extra schedule rows |
| `FITS_FACADE` Σ(width×qty) per window tag ≤ host wall length | impossible counts (CW09 ×5 = 57 m of window) |
| `EXTERNAL_BUDGET` Σ external finish areas ≤ plotArea − footprint | pilot over-allocated externals by 25% |
| `BUA_CLOSURE` Σ floor areas vs stated BUA within ±10% | slab/ceiling under/over-measure |
| `STAIR_DEVELOPED` stair items must be lm or developed-area, never plan m² | pilot stair error |
| `UNIT_SANITY` door 0.5–2.5 m wide, ceiling ≤ room area, rate ranges per code | typos, unit slips |
| `DUPLICATE_TAG` same tag twice in one schedule | OCR doubles |
Severity ERROR blocks BOQ lock; WARN requires acknowledge.

### 4.7 PRICE (rate resolution waterfall)
For each BoqLine:
`org Assembly → preferred SupplierPrice → cheapest SupplierPrice → org RateLibraryItem → global RateLibraryItem (seed) → mark P/S`.
Record `rateSource` on the line. Cost-intelligence later is just queries over this + Corrections
("Supplier B is 18% above your 6-month average for ST01") — deterministic SQL, exactly as your doc demands ("NOT ChatGPT").

### 4.8 EXPORT_XLSX
Generate with `exceljs` in the Triple-A bill structure the client already recognizes:
Sections 1.0 General / 2.5 Metal / 2.6 Wood / 2.8 Doors-Windows-Glazing / 2.9 Finishes / 3.1 External / 4.0 Provisional Sums / Summary / Discount / Grand Total.
Columns: ITEM REF | DESCRIPTION | UNIT | QTY | RATE | AMOUNT (+ internal-only CONFIDENCE & SOURCE columns, toggle off for client copy).
Quotation doc adds: ref `Qo/YYYYMM/serial Rev-NN`, validity 30 days, VAT 5%, commercial terms block.

---

## 5. API surface (Bun — Hono or Elysia)

| Method & path | Purpose |
|---|---|
| `POST /api/projects/:id/documents` (multipart) | upload → Document + Job(INGEST) |
| `GET  /api/documents/:id` | status, sheets, stage progress |
| `GET  /api/projects/:id/takeoff?category=` | takeoff items + flags |
| `PATCH /api/takeoff-items/:id` `{qtyFinal,status}` | review edit → writes **Correction** |
| `POST /api/projects/:id/spaces/sync-from-takeoff` | create/update Spaces from ROOM items |
| `POST /api/projects/:id/boq/generate` | takeoff → sectioned BOQ draft |
| `POST /api/boqs/:id/price` | run rate waterfall |
| `PATCH /api/boq-lines/:id` | manual qty/rate (→ Correction) |
| `POST /api/boqs/:id/export` | Job(EXPORT_XLSX) → signed URL |
| `POST /api/boqs/:id/quotation` | create Quotation w/ discount & VAT |
| CRUD | /suppliers /materials /supplier-prices /labor-rates /assemblies /rate-library |

Review UI (the ONLY new screen that matters): a table grouped by category; columns Tag · Description · Unit · AI Qty · Final Qty (editable) · Confidence (color chip: ≥85 green, 60–84 amber, <60 red) · Source · Flags. Filter "needs review" = flags OR conf<85. Approve per category → lock → generate BOQ.

---

## 6. Assemblies — the Jotun insight, encoded

```
Assembly "Jotun Interior Paint A" (WALL, m2):
  MATERIAL primer  65 AED / 100 m2 coverage × 1 coat
  MATERIAL stucco  55 AED /  40 m2 × 2 coats
  MATERIAL paint  270 AED /  50 m2 × 2 coats
  LABOR    painter  6 AED / m2
  TOOL_FIXED consumables 150 AED / project
unitCost = 65/100 + 2×(55/40) + 2×(270/50) + 6 = 0.65 + 2.75 + 10.80 + 6.00 ≈ 20.20 AED/m2 (+ wastage % + tools amortized)
```
Estimator picks ONE assembly per surface; the engine explodes it into the BOQ. Materials keep multiple SupplierPrices → the same assembly reprices instantly when a supplier changes. This is the moat your brainstorm doc identified.

---

## 7. Confidence rubric (empirically calibrated on the pilot)

| Basis | Definition | Score | Observed error vs real QS |
|---|---|---|---|
| MEASURED | read from schedule/label, text+vision agree | 90–95 | ±5–15% |
| MEASURED (conflict) | text vs vision disagree | 60 + flag | resolved by human |
| DERIVED | arithmetic on labeled values | 75–90 | ±10–25% |
| VISUAL | scaled by eye, no true measurement | 40–60 | ±30–50% |
| PARAMETRIC | no source drawing (structure w/o STR set) | 35–50 | order of magnitude |
| PLACEHOLDER | provisional sum | 0–20 | n/a — and NORMAL (53% of the real quote) |

UI rule: never show a quantity without its chip. Trust is the product.

---

## 8. Seed RateLibrary (real Sharjah rates, Triple-A quote, June 2026)

| code | description | unit | rate AED |
|---|---|---|---|
| DOOR-1000x3000-FN01 | Door 1000×3000 special finish | No | 2,600 |
| DOOR-STD-LACQ | Door 800–1000×3000 white lacquer | No | 2,400 |
| DOOR-900x2400 | Door 900×2400 | No | 2,300 |
| IRON-STD | Ironmongery set / door | No | 350–400 |
| SCREED-FLR | Sand-cement floor screed | m2 | 90 |
| FLR-ST01 | Porcelain 1000×1000 honed (PC 100) | m2 | 200 |
| FLR-PR01 | Porcelain 1000×1000 marble-texture (PC 100) | m2 | 210 |
| FLR-PR03 | Porcelain 600×600 service (PC 60) | m2 | 150 |
| FLR-BATH | Bathroom porcelain 1200×600 (PC 80) | m2 | 195 |
| STAIR-TREAD | Grainy marble tread+riser (PC 250) | lm | 800 |
| STAIR-LAND | Landing | m2 | 550 |
| THRESH | Threshold (PC 70/m) | lm | 230 |
| SKIRT-PR01 | Skirting 100 mm (PC 60) | lm | 120 |
| WALL-WOODPORC | Wall porcelain wood-finish cut-to-size (PC 220) | m2 | 580 |
| WALL-MARBPORC | Wall porcelain 1000×3000 (PC 220) | m2 | 540 |
| PAINT-INT | Fenomastic emulsion to walls | m2 | 35 |
| CEIL-CL03 | Gypsum ceiling plain | m2 | 150 |
| CEIL-CL02 | Moisture-resistant gypsum | m2 | 170 |
| CEIL-CL01-EXT | External (Marmox) ceiling | m2 | 300 |
| EXT-ST03 | Concrete porcelain pavement | m2 | 250 |
| EXT-SCREED | Paving screed | m2 | 100 |
| MH-800 | Manhole 800×800 w/ cover | No | 650 |
| KIT-BASE | Kitchen base unit HPL | lm | 1,200 |
| KIT-WALL | Kitchen wall unit HPL | lm | 1,100 |
| VANITY | Stone-top vanity | No | 3,400 |
| HANDRAIL-MDF | MDF veneer stair handrail | lm | 900 |

Typical P/S benchmarks (villa this size): sanitary 50k · light fittings 70k · windows+skylights 300k · garage gates 40k · facade feature screen 100k · home automation 20k · ext lighting 50k · stone cladding 120k.

---

## 9. Build order (4 sprints, each shippable)

**Sprint 1 — Foundations:** Postgres migration · tenant Prisma extension · Membership/roles · S3/R2 upload · Job table + worker loop · usage metering (pagesProcessed).
**Sprint 2 — Ingest & Extract (first WOW):** INGEST + CLASSIFY → drawing register screen · EXTRACT_SCHEDULES with dual-pass + flags · EXTRACT_ROOMS → auto-Spaces · Review table UI. *Value shipped: upload a 58-page set, get every door, window, finish code and room area in minutes.*
**Sprint 3 — Money path:** QUANTIFY rules engine · BOQ generate in Triple-A structure · Assemblies + rate waterfall · xlsx export · Quotation with ref/VAT/discount.
**Sprint 4 — Trust & learning:** VALIDATE rules (all 8) · confidence chips everywhere · Corrections capture + "AI vs Final" report per project · seed RateLibrary import.

**Out of scope until after Sprint 4:** calendar, invoicing, tasks, dashboards, DWG ingestion, supplier portals, mobile.

---

## 10. Claude API integration notes

- Server-side only; env `ANTHROPIC_API_KEY`. Endpoint `/v1/messages`, images as base64 jpeg.
- Force structure with tool-use (a single `record_extraction` tool whose input schema is the JSON above); temperature 0.
- Concurrency 3–5; exponential backoff on 429/529; every call logged (orgId, sheetId, tokens) for cost metering.
- A 58-sheet set ≈ 58 classify calls + ~12 deep extraction calls — single-digit dollars per project; charge per project or per sheet with healthy margin.
- Keep prompts in versioned files (`prompts/classify.v3.ts`); store prompt version on each Sheet/TakeoffItem so accuracy regressions are traceable.

## 11. Definition of done (acceptance test)

Re-run the Plot 4357 set through the finished pipeline and require:
1. Drawing register: 58/58 sheets classified, ≥95% correct type.
2. Doors: 25/25 incl. A/B finish variants; windows: 20 tags incl. CW02; zero unflagged count mismatches vs the Triple-A schedule.
3. Room areas: every labeled room captured within ±2% of its printed value; Spaces auto-created.
4. BOQ xlsx opens with zero formula errors, Triple-A section structure, confidence chips present.
5. Every pilot failure (CW09 swap, stair plan-area, external over-allocation, missed CW02) is either correct or carries an ERROR/WARN flag.
