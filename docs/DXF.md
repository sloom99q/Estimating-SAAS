# DXF Support — Design Doc

> **Status:** design, not built. Awaiting estimator sign-off on §11 open
> questions before any code lands.
>
> **Phase position:** picks up where MULTI-DOC #3 left off. PDFs +
> vision keep working unchanged; DXF is **additive** coverage for the
> two things vision can't do reliably: exact room geometry and exact
> door/window counts. Whole-drawing AI reasoning pass comes after.

---

## 0. Why DXF — the gap vision can't close

Vision-extracted areas land at **VISUAL** basis with a stated ±5–8% accuracy
on clean A1 plans. For an estimator that's "good enough for SCREED";
**not good enough to bill rooms by m²**. The two structural limits:

1. **Pixel→mm conversion** depends on knowing the printed scale (1:50,
   1:100, 1:75…) and the DPI the model rasterized at. Sonnet reads the
   scale-bar inconsistently; the scale frame in the title block is the
   single source of truth and not always grepped reliably.
2. **Room polygon detection** at 600 dpi loses thin internal walls and
   misses curved walls entirely. Every internal-area estimate is a
   pixel-fill heuristic.

CAD geometry is **exact** — vertices are stored as `(x, y, z)` doubles
in modelspace mm. A polygon's signed area is deterministic. A door
schedule's `INSERT` count IS the door count.

**What DXF gives us:**

| Quantity | Today (vision) | With DXF |
|---|---|---|
| Room area | VISUAL ±5–8% | MEASURED ±0% |
| Room perimeter (→ skirting) | DERIVED from area + aspect prior | MEASURED, edge sum |
| Door count per tag | Inferred from schedule table | Counted from INSERT entities |
| Window count per tag | Inferred from schedule table | Counted from INSERT entities |
| Wall length (→ paint, wall finish) | Not currently extracted | MEASURED from wall layer polylines |
| Curved-wall handling | Approximated as a rectangle | Native (ARC + LWPOLYLINE bulges) |

**What DXF does NOT give us (vision keeps owning these):**

- Finish-code legend tables (FF01, ST01…) — embedded as a TEXT/MTEXT
  block but not in a structured form; OCR-or-vision still wins.
- Door/window **schedule rows** (size, fire-rating, finish description,
  remarks) — DXF has the count but not the per-row spec.
- Kitchen / joinery counts (cabinetry shown in detail sheets, not on
  the floor-plan layer DXF parses).
- Wardrobes (same — joinery details live on dedicated sheets, often
  drawn in 3D detail).
- Color-mapped finishes — DXF's hatch fill doesn't carry the legend
  color; the I4xx finish-plan sheet still does.

**Conclusion:** DXF replaces the vision **room/door/window measurement
path**. Vision keeps the schedules, finish legend, finish mapping,
kitchen, and wardrobes paths. The two streams merge in QUANTIFY.

---

## 1. End-state pipeline

```
                 ┌─ PDF only ─────────────────────────────────┐
                 │                                             │
   upload ─►─ INGEST ─► CLASSIFY ─► EXTRACT_FINISH_LEGEND ────►│
                                  │                            │
                                  └► EXTRACT_SCHEDULES ────────┤
                                                               │
                                                               ├─► QUANTIFY ─► BOQ
   upload .dwg / .dxf                                          │
            │                                                  │
            ├─► (DWG only) CONVERT_DWG ─► (.dxf)               │
            │                              │                   │
            └─► PARSE_DXF ─► measured rooms / doors / windows ─┘
                              │
                              └► EXTRACT_ROOMS (vision) is SKIPPED
                                  for the same physical floor when a
                                  DXF source has provided rooms.
```

The vision EXTRACT_ROOMS handler doesn't go away — it stays as the
fallback when the user has only PDFs, and it still runs on PDFs that
don't have a DXF counterpart in the project (e.g. interior detail
sheets, RCPs).

---

## 2. Conversion: DWG → DXF

Most architects ship DWG. Our parser will only read DXF (it's the open
text/binary format AutoCAD publishes the spec for). So step 0 is a
conversion shim.

### 2.1 Options

| Option | License | Run model | Verdict |
|---|---|---|---|
| **ODA File Converter** | Free-for-commercial (Open Design Alliance) | Desktop binary on Linux/macOS/Windows; CLI invokable from the worker via `child_process.spawn` | **Recommended.** Maintained by the consortium that publishes the DWG spec. Bit-exact conversions. Single static binary — no runtime deps. |
| LibreDWG | GPLv3 (viral) | Linux binary; smaller install | Skip. GPL forces our entire stack to GPL on link — incompatible with us shipping a closed-source SAAS. |
| `dwg2dxf` from libdwg/Teigha clones | Mixed | Various | Skip — provenance murky. |
| Cloud APIs (Autodesk Forge, ConvertAPI) | Per-call $ | HTTP POST file → get .dxf | Skip MVP — adds external dep, per-file cost, and security review for shipping CAD off-site. Revisit if ODA's macOS dev story is painful. |
| **Skip conversion (DXF-only MVP)** | n/a | Ask users to export DXF before upload | Acceptable fallback for week 1. Architects know `SAVEAS → DXF` in AutoCAD. |

**Recommended path:** ship MVP with DXF-only upload (users export DXF from
their CAD). Add ODA File Converter as a transparent conversion step in
phase 2 — the binary is ~12 MB and the invocation is one CLI call. This
keeps the MVP scope manageable and proves the value-add of DXF parsing
before we add a conversion dependency to the deployment story.

### 2.2 ODA File Converter — deployment notes (for phase 2)

- macOS dev: download `.dmg`, install, the binary lives at
  `/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter`.
- Linux prod: download `.AppImage` or the static `.tar.gz`. Worker
  Dockerfile (when we have one) installs to `/opt/oda/`.
- Invocation:
  `ODAFileConverter <input_dir> <output_dir> <out_ver:ACAD2018> <out_format:DXF> <recurse:0> <audit:1>`
- Headless, no GUI, exits with a non-zero code on parse failure → easy
  to handle in `try/catch`.
- License terms (re-verify when we ship): free for commercial use, no
  attribution required, no royalty. Distribute the binary alongside our
  code — don't bundle into our git history.

---

## 3. Parser: which DXF library

| Library | Lang / runtime | Coverage | Verdict |
|---|---|---|---|
| **dxf-parser** (npm) | Pure JS, runs in Bun directly | Entities, layers, blocks, polylines, text, inserts. Maintained, ~10k weekly downloads. | **Recommended for MVP.** Fits our Bun + TS stack with zero extra runtime. Spits out a parsed JSON tree we can walk. |
| node-dxf | Pure JS | Older, less complete entity coverage | Skip — `dxf-parser` is the newer fork. |
| ezdxf (Python) | Python 3 subprocess | The gold standard. Full DXF spec coverage. Round-trips, can write DXF too. | Reserve for **phase 2** if we hit a parsing limit on a real-world file. Adds Python runtime + a subprocess hop. |
| Three.js DXF loader | JS + WebGL | Built for rendering, not measurement | Skip — wrong tool. |
| Custom parser | TS | n/a | Skip — months of work to handle the spec's edge cases (binary DXF, R12 vs R2018, etc.). |

**Recommended:** `dxf-parser` for MVP. The output shape is:

```ts
{
  header: { $INSUNITS: 4 /* mm */, $LUNITS: 2, ... },
  tables: { layers: { 'A-ROOM': {...}, 'A-DOOR': {...}, ... } },
  blocks: { 'DR-SINGLE-90': { entities: [...] }, ... },
  entities: [
    { type: 'LWPOLYLINE', layer: 'A-ROOM', vertices: [{x,y,bulge}, ...], closed: true },
    { type: 'INSERT', layer: 'A-DOOR', name: 'DR-SINGLE-90', position: {x,y}, rotation: 90 },
    { type: 'TEXT', layer: 'A-ANNO-ROOM', position: {x,y}, text: 'MASTER BEDROOM' },
    ...
  ]
}
```

This is what we need. The handler walks `entities[]`, filters by
configured layer names, groups by geometric inside-ness.

---

## 4. Room area extraction — MTEXT-label path (MVP)

**Revised 2026-06-24** — original §4 assumed every architect draws
rooms as closed `LWPOLYLINE`s on a single bounds layer. The first
real-file test (LAMI Architects, LM1929 villa) returned **zero**
closed polylines anywhere in A101: walls are individual `LINE`
segments on `LAMI-A-WALL-EXTR`, no `HATCH` fills, no polygon room
boundaries. The polygon-area algorithm would have produced zero rooms.

But probing further showed the architect **writes the measured area
directly into the room label**: every room has two paired `MTEXT`
entities on `LAMI-A-AREA-IDEN`, offset by ~23 mm:

```
"GF-04 58.82 m²"        ← code + architect-measured area
"LIVING"                ← human-readable name
```

So instead of computing area from geometry, we **read it from the
text**. The architect's stated number is more authoritative than
anything we could compute (they signed the drawing with it) and the
extraction becomes deterministic text-processing rather than fragile
polygon math. The pivot is a net win on every axis: simpler code,
exact numbers, no XREF / LINE-soup / bulge-arc edge cases.

### 4.1 Algorithm

Given the parsed entity tree and the project's `LayerMap`:

1. **Collect label entities** — `MTEXT` and `TEXT` on
   `layerMap.roomLabels`. Apply `cleanMText()` to each — AutoCAD wraps
   labels in formatting codes like `\pxqc,t0.83333,1.66667,...;` which
   must be stripped before regex.

2. **Classify each cleaned label** by regex:
   - `/^([A-Z]+-\d+)\s+([\d.]+)\s*m²?/` → matches `GF-04 58.82 m²` →
     `{ code: 'GF-04', areaM2: 58.82 }` (a "code+area" label).
   - Anything else (single word, multi-word phrase) → a "name" label.

3. **Pair each `code+area` with its nearest `name`** by Euclidean
   distance between insertion points. The architect's offset is
   consistent within a drawing — on LM1929 it's 23 mm — so
   nearest-neighbour pairing is robust. Compute and log the median +
   max pair distance per file; flag if max > 5× median (suggests a
   layout the heuristic misclassifies).

4. **Emit ROOM TakeoffItem** per paired row:
   - `tag = code` (e.g. `GF-04`)
   - `description = name` (e.g. `LIVING`)
   - `qtyAi = areaM2`, `unit = 'm²'`
   - `basis = MEASURED` (architect's own number)
   - `confidence = 98`
   - `status = EDITED` (no human round-trip needed — the architect
     already approved the number when they put it on the drawing)
   - `meta = { code, area_m2, sourceFormat: 'DXF', textRaw, textClean,
              pairDistanceMm }`

5. **Unpaired `code+area` rows** → still emit a TakeoffItem with
   `description = '(unnamed)'`, `confidence = 75`, `status = AI`.
   Estimator names it in the review table. Don't drop — the area is
   real.

6. **Unpaired `name` rows** → emit a TakeoffItem at `qtyAi = null`,
   `confidence = 60`, `status = AI`. These are usually corridors /
   stairs the architect didn't label with an area (the GF-12/13/15
   gaps in LM1929). The estimator either provides the area (manual
   measurement / SCREED accepts UNASSIGNED) or deletes the row.

### 4.2 Door / window tag extraction

Same MTEXT-pairing idea on the door/window layers. A101's
`LAMI-A-DOOR-IDEN` has 14 `INSERT` entities + 14 `MTEXT` entities —
one MTEXT carries each door's schedule tag (`D01`, `D02`, …) next to
its INSERT.

1. **Collect INSERTs** on `layerMap.doors`, `layerMap.windows`.
2. **Collect MTEXT/TEXT** on the same layers (architects place the
   tag right next to the INSERT).
3. **Pair each INSERT with its nearest MTEXT**; extract the tag via
   `/^([A-Z]+\d+)$/`.
4. **Group by tag** → count per tag.
5. **Emit DOOR / WINDOW TakeoffItem** per unique tag, matching the
   vision schedule shape (`tag = 'D01'`, `qtyAi = count`,
   `basis = MEASURED`, `conf = 98`).

This matches the existing schedule-row format exactly, so the §8 merge
precedence collapses DXF doors against vision-extracted doors on
`(project, category, tag)` (the natural key the schedule handler
already uses post-MULTI-DOC #3).

### 4.3 Sheets that don't have rooms

Not every DXF is a floor plan. Elevations / sections / details / RCPs
won't have room labels. Detection is a single check: zero matched
`code+area` MTEXT after step 2 → emit a project flag "no rooms found
in this DXF — likely an elevation / detail / RCP sheet, skipped" and
exit the handler cleanly. The Document still goes to `READY`; the
estimator can verify or delete.

### 4.4 Shelved to phase 2

- **Polygon-based area** — the original §4 algorithm (shoelace + bulge
  + point-in-polygon labels) is preserved as a fallback for files
  where the architect did NOT label areas. Implementation cost
  unchanged (~1 day); we just don't need it yet.
- **LINE-graph room reconstruction** — for architects who neither
  label areas nor draw closed polylines. Same deferral as before.
- **Wall length extraction** for paint — phase 2 (Q7 verdict).
- **HATCH-based room polygons** — confirmed absent in LAMI files.
  Worth a probe if a different firm's files have hatched rooms.
- **XREF resolution** — moot for the MTEXT-area path; we don't need
  wall geometry at all.

---

## 5. Door / window block counting

The pattern is simple: every door / window placed on the plan is an
`INSERT` (block reference) entity. We count by block name and group by
the schedule tag, which is typically stored as a block attribute
(`ATTRIB` entity) named `TAG` / `MARK` / `TYPE` / `ID`.

```ts
// Pseudocode
const doors = entities
  .filter(e => e.type === 'INSERT' && doorLayers.includes(e.layer))
  .map(e => ({
    blockName: e.name,                    // e.g. 'DR-SINGLE-90'
    tag: e.attributes?.find(a => TAG_ATTR_KEYS.includes(a.tag))?.value ?? null,
    position: e.position,
    roomId: pointInPolygon(e.position, rooms),  // which room contains it
  }))

// Group by tag; count = number of inserts per tag
const counts = groupBy(doors, d => d.tag ?? d.blockName)
```

This gives us **exact** counts per tag, AND the room each door opens
into (useful for future quantity-by-room logic like "count of doors per
finish zone").

**Tag attribute keys vary.** Default candidates we try in order:
`['TAG', 'MARK', 'TYPE', 'ID', 'NUMBER', 'CODE']`. Configurable per
project alongside the layer map (§6).

### 5.1 What if blocks have no TAG attribute?

Fall back to **block name** as the tag (e.g. `DR-SINGLE-90` becomes
the de-facto tag). The block-name → schedule-tag mapping then needs
the schedules vision pass to disambiguate which D01/D02/… each block
name corresponds to. Emit a project flag if this fallback fires.

### 5.2 Windows

Same algorithm. Windows usually on `A-GLAZ` or `A-WINDOW`. Curtain
walls (CW01–CW20 in the test villa) are typically drawn as a single
INSERT representing the whole wall, OR as a series of inserts.
Configurable: "window block layer", "treat consecutive inserts as one
curtain wall" (boolean, off by default).

---

## 6. Layer mapping config

The fundamental problem: there's no universal layer naming convention.
The AIA US National CAD Standard (`A-WALL`, `A-DOOR`, `A-GLAZ`,
`A-ANNO-ROOM`) is the closest thing, but firms vary. UAE practice
leans toward NCS-derived names but with project-specific prefixes.

### 6.1 Mechanism

A per-project `LayerMap` JSON, stored on the Project model:

```json
{
  "roomBounds":  ["A-AREA-ROOM", "A-WALL", "ROOMS"],
  "roomLabels":  ["A-ANNO-ROOM", "TEXT-ROOMS"],
  "doors":       ["A-DOOR", "A-DOOR-SYMB"],
  "windows":     ["A-GLAZ", "A-WINDOW"],
  "walls":       ["A-WALL"],
  "tagAttribs":  ["TAG", "MARK", "TYPE", "ID"],
  "minRoomAreaM2": 0.8,
  "maxRoomAreaM2": 500
}
```

Each field is an **ordered list**: parser tries each in turn until one
matches non-empty entities. This means a `LayerMap` written for one
project's architect can mostly work for another — extra fallback
layer names cost nothing if they're absent in this file.

### 6.2 Bootstrap (cold start, no map yet)

When the first DXF lands in a project with no LayerMap:

1. Parser introspects the file's `tables.layers` and reports the top
   10 layers by entity count.
2. Pattern-match against the AIA NCS defaults — if `A-WALL` exists,
   pre-fill `walls`. Etc.
3. SPA renders a "confirm layer mapping" step on first DXF upload —
   each field is a `Select` whose options are the actual layer names
   in this DXF, pre-populated with the auto-detected guess.
4. Once saved, the LayerMap is reused for every subsequent DXF in the
   same project (typical multi-doc has GF + FF + RF DWGs from the
   same office → same conventions).

### 6.3 Org-level defaults

If the same office (= organization) repeatedly uploads with the same
layer conventions, the SPA offers "save this map as org default" — new
projects in the same org start with that map pre-filled.

---

## 7. New job + handler

### 7.1 Job type

```ts
// extend the JobType enum in prisma/schema.prisma
enum JobType {
  ...existing...
  PARSE_DXF
  CONVERT_DWG  // phase 2, after MVP
}
```

### 7.2 Handler shape

```
apps/api/src/jobs/handlers/parseDxf.ts
  ├── load DXF blob from BlobStore
  ├── parse via dxf-parser
  ├── resolve LayerMap (from Project.layerMap or default)
  ├── extract rooms (§4)
  ├── extract doors / windows (§5)
  ├── upsert TakeoffItems with category=ROOM|DOOR|WINDOW,
  │     basis=MEASURED, sourceSheet=<dxf pseudo-sheet>
  ├── soft-delete vision-extracted ROOM/DOOR/WINDOW rows whose
  │     normalized key matches a MEASURED row (DXF wins —
  │     see §8 merge precedence)
  └── return { roomsCreated, doorsCreated, windowsCreated, flags }
```

### 7.3 DXF pseudo-sheet

The `Sheet` model assumes one sheet per page of a PDF. A DXF doesn't
have pages — it's modelspace + N paperspace layouts. We create one
Sheet row per DXF file with `pageNo=1`, `drawingNo=<basename>`,
`sheetType='DXF_PARSED'`, `hasTextLayer=false`. This lets the
existing `sourceSheetId` foreign keys on TakeoffItem continue to point
at *something* even for DXF-derived rows.

Alternative: add `Document.sourceFormat: 'PDF' | 'DXF' | 'DWG'` and
nullable `sourceSheetId`. Cleaner schema, slightly more migration
work. **Recommendation:** pseudo-sheet for MVP; refactor to the
nullable model in phase 2 if it gets in the way.

### 7.4 Document type detection

Today `documents.ts:165` magic-byte checks for `%PDF`. We extend:

```
buf.slice(0, 4) === '%PDF'    → status='UPLOADED', enqueue INGEST
buf.slice(0, 6) === 'AC1027' or other AutoCAD signature → DWG
                                → status='UPLOADED', enqueue CONVERT_DWG
buf.slice(0, 4) === '  0\n' or buf includes 'AutoCAD' near top → DXF
                                → status='UPLOADED', enqueue PARSE_DXF
```

(DXF magic detection is fuzzy — text format. We allow `.dxf`
extension hint as a tiebreaker; the magic-byte check stays as the
primary defense against label-only mimetype lies.)

---

## 8. Merge precedence — DXF vs vision

When a project has both DXF rooms (MEASURED) and vision rooms
(VISUAL/DERIVED) for the same physical room, the dedup loop in
`extractRooms.ts` already groups by normalized name and scores
survivors. We extend the score so that **basis** outweighs everything
else:

```
score(item) =
   10 × (basis === 'MEASURED' ? 1 : 0)
 +  4 × (item.qtyAi !== null ? 1 : 0)
 +  2 × (item.tag !== null ? 1 : 0)
 +      item.confidence / 100
```

This guarantees: DXF row wins → vision row soft-deleted. The finish
suggestion from the vision row's `meta.finishSuggestion` is still
*carried* into the DXF survivor (the existing donor-merge logic at
extractRooms.ts:880+ already handles this).

**Same for DOOR/WINDOW.** When a DXF INSERT count and a vision
schedule count disagree, the DXF count wins on the priced row; the
vision schedule row stays as a metadata source for size/type/finish
fields. We surface a project flag if the delta is > 10%.

---

## 9. Confidence + basis semantics

| Source | category | basis | confidence | Status flag |
|---|---|---|---|---|
| DXF polygon + label | ROOM | `MEASURED` | 98 | `EDITED` (no human round-trip needed) |
| DXF polygon, no label | ROOM | `MEASURED` | 75 | `AI` (needs reviewer to name it) |
| DXF INSERT, has tag attrib | DOOR/WINDOW | `MEASURED` | 98 | `EDITED` |
| DXF INSERT, fall-back to block name | DOOR/WINDOW | `MEASURED` | 70 | `AI` (needs reviewer to map block → schedule tag) |
| Vision-extracted (status quo) | ROOM | `VISUAL` | 60–85 | `AI` |

The 98-confidence MEASURED rooms drop directly into QUANTIFY without
needing the human verify-each step skirting / vanity require today.

---

## 10. Multi-file / multi-floor

Typical real upload: `GF.dwg`, `FF.dwg`, `RF.dwg`, plus the I400
finishes PDF and the structural / MEP PDFs. The MULTI-DOC #3 dedup
pipeline (already shipped) groups by normalized-room-name across all
sources project-wide; DXF rooms slot into the same groups as their
vision counterparts and win by basis precedence (§8).

**Floor identity** comes from the DXF filename + the layer-map's
optional `floorTag` field (e.g. "FF", "GF"). If two DWGs both contain
a "MASTER BEDROOM" polygon, the floor tag distinguishes them — one
stays "MASTER BEDROOM — GF", the other "MASTER BEDROOM — FF" and
they don't dedup against each other. This already works for vision
(via `normalizeFloor`).

---

## 11. Open questions — please weigh in

| # | Question | Default I'd pick | Why I'd want your input |
|---|---|---|---|
| 1 | **MVP scope: DXF only, or DWG-via-ODA-converter from day 1?** | DXF only. Users export DXF from CAD before upload. | Adds a binary + deployment dep if we ship ODA in MVP. But your test villas are .dwg — manual conversion friction might be the wrong tradeoff. |
| 2 | **Layer map: confirm-on-first-upload, or auto-detect-and-go?** | Confirm-on-first-upload (modal). Saves an org-level default after. | Auto-and-go is faster; confirm catches the "wrong layer guessed" failure mode before $0 of token spend turns into 0 rooms extracted. |
| 3 | **`dxf-parser` (pure JS) or `ezdxf` (Python subprocess) for MVP?** | dxf-parser. Bun-native, zero extra runtime. | ezdxf is more complete but adds Python runtime + subprocess hop. If your DWGs use uncommon entities (3DSOLID, MESH, etc.) the JS parser might not handle them. |
| 4 | **DXF detection cap or hint?** | Magic-byte first + extension as tiebreaker. | DXF is plain text; magic detection is fuzzy. Files without `.dxf` extension could slip through as "unknown" and get rejected. |
| 5 | **Visualization?** | Skip — store `meta.polygon` for debug but don't render. | A polygon viewer (canvas) is 1 day of work and would let estimators sanity-check room boundaries before priced output. Phase 2 candidate. |
| 6 | **Curved walls (bulge polylines)?** | Handle in MVP — closed-form arc length, 1 hour. | Some plans have curved feature walls; ignoring them under-counts the perimeter (skirting/paint). |
| 7 | **Wall length extraction (paint/wall-finish basis)?** | Skip MVP, add in phase 2. | Wall finishes today go via room-perimeter × height; DXF can give actual wall polylines instead. Not blocking the room/door/window core. |

---

## 12. Build phases

### Phase 1 (MVP, ~1 week)

- New `JobType.PARSE_DXF` + handler.
- `dxf-parser` integrated.
- Room polygon extraction (LWPOLYLINE + closed POLYLINE only).
- Door/window INSERT counting (with tag attribute, fall-back to block
  name).
- LayerMap stored on `Project`; confirm-modal on first DXF upload.
- DXF magic-byte detection + extension hint in
  `apps/api/src/routes/documents.ts`.
- Merge precedence (§8) wired into `extractRooms.ts` dedup score.
- Pseudo-sheet for DXF rows.
- Project flag for missing XREFs (detect-and-warn).
- Tests: a hand-authored minimal DXF fixture (one room polygon, two
  doors, one window) drives the handler end-to-end.

### Phase 2 (after MVP proves out)

- **CONVERT_DWG** job + ODA File Converter integration. Auto-detect
  `.dwg`, enqueue CONVERT first, then PARSE_DXF on the result.
- LINE-graph room-bound reconstruction (for older drawings).
- Curved-wall arc support (if MVP punted).
- Wall length extraction (`A-WALL` layer → paint / wall-finish
  measured basis).
- Polygon viewer in the SPA (canvas + zoom, point-in-polygon click
  → highlight associated room).
- ezdxf upgrade path if `dxf-parser` runs into a real DWG it can't
  handle.
- Org-level LayerMap defaults.

### Out of scope (forever, or "much later")

- DWG **writing** (round-tripping edits back to a DWG file).
- 3D entities (SOLID, MESH, regions) — we only need 2D plan geometry.
- BIM / IFC / Revit interop — separate research project.

---

## 13. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User's DWGs use a layer convention we don't auto-detect | High | Medium | Confirm-modal on first upload (§6.2) catches it before extraction. |
| DXF has XREFs the user didn't upload | Medium | High (rooms missing) | Detect-and-warn project flag; user re-uploads with XREFs. |
| `dxf-parser` chokes on a real-world DWG-exported DXF | Medium | Medium | Phase 2 escape hatch to ezdxf. Test against your plot4357 DWG before committing fully. |
| Polygons-aren't-rooms false positives | Medium | Low | Min/max area gate; user-overridable per project. |
| Door/window blocks without TAG attribs | Medium | Low | Block-name fallback + project flag asking user to confirm mapping. |
| ODA File Converter license terms change in phase 2 | Low | Medium | License audit before phase 2 ship; fall-back to manual DXF upload always exists. |
| Two DWGs reference the same room differently and the polygon dedup misclassifies | Low | Low | MULTI-DOC #3 normalize+merge already handles this for vision; DXF rows go through the same loop. |

---

## 14. Acceptance criteria for "MVP shipped"

On the LM1929 villa test set (A101 ground floor + A102 first floor
DXFs, exported from the architect's DWGs):

1. PARSE_DXF runs end-to-end on A101 + A102, emits the rooms the
   architect labelled (LM1929 has 13 GF + 10 FF = 23 labelled rooms).
2. **Areas match the architect's stated values exactly** — every
   extracted `qtyAi` equals the number on the label, to the cent.
   `LIVING = 58.82 m²`, `MASTER BEDROOM = 38.35 m²`. The ±0.5% bar of
   the original spec becomes 0% by construction under MTEXT-area
   parsing — we're reading the architect's number, not computing one.
3. Door counts per tag (D01, D02, …) match the vision schedule
   extraction within ±1; on conflict, DXF wins.
4. The dedup pipeline soft-deletes vision ROOM rows that lose to DXF
   rows; the final review table shows MEASURED-basis rooms with the
   vision-suggested finish code carried forward.
5. BOQ generates from the MEASURED rooms — SCREED-FLR sum equals the
   sum of architect-stated areas exactly (modulo the UNASSIGNED bucket
   for unlabelled corridors / stairs, which is the existing #127
   backlog item, not a DXF regression).
6. Confidence ≥ 95 on every DXF-derived row.
7. Full room list (code, area, name) for A101 + A102 delivered to the
   estimator for eyeball review against the contractor's BOQ.

When all 7 land, MVP is done. Anything beyond goes to phase 2.

---

## 15. References

- ODA File Converter — https://www.opendesign.org/guestfiles
- `dxf-parser` — https://github.com/gdsestimating/dxf-parser
- AutoCAD DXF Reference — https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-235B22E0-A567-4CF6-92D3-38A2306D73F3
- AIA NCS layer standard — https://www.nationalcadstandard.org/
- ezdxf docs (phase 2 reference) — https://ezdxf.readthedocs.io/
