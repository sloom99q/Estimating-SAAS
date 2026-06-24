/**
 * DXF MVP — pure introspection.
 *
 * Input: DXF bytes (utf-8 string).
 * Output: LayerReport — a summary of every layer in the file, with
 *   per-layer entity counts and block-name samples, plus an
 *   AIA-NCS-derived auto-suggestion for which layer each LayerMap
 *   role should point at.
 *
 * The handler is intentionally pure — no DB, no filesystem, no
 * Anthropic calls. The LayerMapModal calls this through one route
 * (`GET /api/projects/:id/dxf/:docId/layers`) and the human picks
 * from the suggestions. Once saved, the chosen LayerMap drives
 * PARSE_DXF for every subsequent DXF in the same project.
 *
 * Why suggestions and not auto-apply: when the parser guesses which
 * layer holds the rooms and guesses wrong, you get zero rooms out
 * silently. The cost of that failure mode is so high (one wasted
 * project, undetected) that the trade for one extra click on the
 * first upload from each firm is obvious. The estimator who picked
 * Q2 wasn't speculating — that's literally what cost a week on
 * finishes.
 */
import DxfParser from 'dxf-parser'
import { AIA_NCS_DEFAULT, type LayerMap } from './layerMap'
import { cleanMText, parseRoomLabel } from './textParse'

/** Per-layer rollup the modal renders. */
export interface LayerSummary {
  name: string
  entityCount: number
  /** Map of entity type → count (LWPOLYLINE: 14, INSERT: 8, …). */
  entityTypes: Record<string, number>
  /** Closed LWPOLYLINEs — strongest signal for "this is a room boundary layer". */
  closedPolylineCount: number
  /** Open polylines + LINEs — wall-finish/paint signal (phase 2). */
  openPolylineCount: number
  lineCount: number
  /** TEXT/MTEXT — strongest signal for "this is a label layer". */
  textCount: number
  /** Top INSERT block names on this layer (door/window detection signal). */
  insertBlockNames: string[]
  /** True if any name fragment matches an AIA NCS role token. */
  matchedRoles: Array<keyof LayerMap>
}

/** What the introspector returns. The modal consumes this directly. */
export interface LayerReport {
  /** Did the file parse at all? */
  ok: boolean
  /** If !ok, the parser error message. */
  error: string | null
  /** $INSUNITS from the header. 4 = mm (what we expect). */
  insUnits: number | null
  totalEntities: number
  totalLayers: number
  /** All layers, sorted by entityCount DESC. */
  layers: LayerSummary[]
  /**
   * AIA-NCS-derived auto-suggestions. Each role is an ordered list of
   * actual-layer-names from THIS file that pattern-matched the AIA
   * defaults. Empty array = no candidate, modal renders a warning and
   * forces the user to pick manually.
   */
  suggested: Pick<
    LayerMap,
    'roomBounds' | 'roomLabels' | 'doors' | 'windows' | 'walls'
  >
  /**
   * DXF-AUTO-SKIP — count of MTEXT entities on ANY suggested room-
   * label layer whose cleaned text matches the `CODE areaM²` pattern
   * (e.g. "GF-04 58.82 m²"). If this is zero, the DXF is NOT a plan
   * sheet (it's an elevation, section, detail, RCP, finish key, etc.)
   * and the upload route auto-marks the document as SKIPPED instead
   * of opening the LayerMapModal.
   *
   * Threshold for "is a plan sheet": >= 1 here. Most real plan sheets
   * have 8-25; an elevation has 0.
   */
  plausibleRoomLabelCount: number
}

const ROLE_TOKENS: Record<keyof LayerReport['suggested'], string[]> = {
  // Token candidates a layer name must CONTAIN (case-insensitive) to
  // suggest itself for the role. Order is preference: earlier
  // candidates score higher. Single-character tokens are excluded —
  // they over-match.
  //
  // DXF MVP follow-up (2026-06-24) — real LAMI Architects files use
  // 'IDEN' / 'AREA-IDEN' / 'FLOR-IDEN' for label layers; widened the
  // roomLabels token set so the modal auto-suggests them instead of
  // dropping the role to empty.
  roomBounds: ['AREA-ROOM', 'ROOM', 'WALL'],
  roomLabels: [
    'AREA-IDEN',   // LAMI-A-AREA-IDEN — preferred when present
    'FLOR-IDEN',   // alt label layer some firms use
    'ROOM-IDEN',
    'ANNO-ROOM',
    'ROOM-NAMES',
    'TEXT-ROOM',
    'ANNO-NOTE',
    'IDEN',         // fallback — any *-IDEN layer beats nothing
  ],
  doors: ['DOOR'],
  windows: ['GLAZ', 'WINDOW'],
  walls: ['WALL'],
}

/**
 * Score a layer name as a candidate for a role. Higher = better.
 *  - exact match against an AIA default → 100
 *  - earliest token contained in name  → 90, 80, 70, …
 *  - 0 if no token matches
 */
function scoreLayerForRole(
  layerName: string,
  role: keyof LayerReport['suggested'],
): number {
  const upper = layerName.toUpperCase()
  const aiaList = AIA_NCS_DEFAULT[role] as string[]
  if (aiaList.some((d) => d.toUpperCase() === upper)) return 100
  const tokens = ROLE_TOKENS[role]
  for (let i = 0; i < tokens.length; i += 1) {
    if (upper.includes(tokens[i]!)) return 90 - i * 10
  }
  return 0
}

/**
 * Build the LayerReport. Synchronous — dxf-parser's parseSync is fine
 * for files up to ~100 MB on our worker. The hot loop is O(entities)
 * with constant-time work per entity.
 */
export function introspectDxf(bytes: string): LayerReport {
  let parsed: ReturnType<DxfParser['parseSync']>
  try {
    parsed = new DxfParser().parseSync(bytes)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      insUnits: null,
      totalEntities: 0,
      totalLayers: 0,
      layers: [],
      suggested: { roomBounds: [], roomLabels: [], doors: [], windows: [], walls: [] },
      plausibleRoomLabelCount: 0,
    }
  }
  if (!parsed) {
    return {
      ok: false,
      error: 'parser returned null (likely a non-DXF or truncated file)',
      insUnits: null,
      totalEntities: 0,
      totalLayers: 0,
      layers: [],
      suggested: { roomBounds: [], roomLabels: [], doors: [], windows: [], walls: [] },
      plausibleRoomLabelCount: 0,
    }
  }

  // Per-layer rollup.
  const layerNames = Object.keys(parsed.tables?.layer?.layers ?? {})
  const summaries = new Map<string, LayerSummary>()
  for (const name of layerNames) {
    summaries.set(name, {
      name,
      entityCount: 0,
      entityTypes: {},
      closedPolylineCount: 0,
      openPolylineCount: 0,
      lineCount: 0,
      textCount: 0,
      insertBlockNames: [],
      matchedRoles: [],
    })
  }

  // The insert-block-name top-list is materialised from a per-layer
  // {blockName → count} map at the end. Avoid sorting on every push.
  const blockCounts = new Map<string, Map<string, number>>()

  for (const entity of parsed.entities) {
    const layer = entity.layer
    if (!summaries.has(layer)) {
      // A layer referenced by an entity but absent from the LAYER
      // table (happens on old DXFs). Synthesize a placeholder so we
      // don't drop the entity from the report.
      summaries.set(layer, {
        name: layer,
        entityCount: 0,
        entityTypes: {},
        closedPolylineCount: 0,
        openPolylineCount: 0,
        lineCount: 0,
        textCount: 0,
        insertBlockNames: [],
        matchedRoles: [],
      })
    }
    const s = summaries.get(layer)!
    s.entityCount += 1
    s.entityTypes[entity.type] = (s.entityTypes[entity.type] ?? 0) + 1

    if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      // dxf-parser doesn't expose .shape uniformly; LWPOLYLINE uses
      // a `shape` boolean OR the closed-flag in the group-70 value
      // (1=closed). We treat both as the same signal.
      const closed =
        (entity as { shape?: boolean }).shape === true ||
        (entity as { vertices?: unknown[] }).vertices?.length !== undefined &&
          // round-trip: dxf-parser preserves group-70 in the underlying
          // bitfield but doesn't always set .shape. Fall back to a
          // simple "first === last vertex" test.
          firstEqLastVertex(entity)
      if (closed) s.closedPolylineCount += 1
      else s.openPolylineCount += 1
    }
    if (entity.type === 'LINE') s.lineCount += 1
    if (entity.type === 'TEXT' || entity.type === 'MTEXT') s.textCount += 1
    if (entity.type === 'INSERT') {
      const blockName = (entity as { name?: string }).name ?? '(unknown)'
      if (!blockCounts.has(layer)) blockCounts.set(layer, new Map())
      const bc = blockCounts.get(layer)!
      bc.set(blockName, (bc.get(blockName) ?? 0) + 1)
    }
  }

  // Materialize top-5 block names per layer.
  for (const [layer, bc] of blockCounts) {
    const s = summaries.get(layer)!
    s.insertBlockNames = [...bc.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name} ×${count}`)
  }

  // Per-role suggestion: score every layer, keep ones with score > 0,
  // order DESC by score then by entityCount.
  const suggested: LayerReport['suggested'] = {
    roomBounds: [],
    roomLabels: [],
    doors: [],
    windows: [],
    walls: [],
  }
  const roles = Object.keys(suggested) as Array<keyof typeof suggested>
  for (const role of roles) {
    const scored = [...summaries.values()]
      .map((s) => ({ s, score: scoreLayerForRole(s.name, role) }))
      .filter((x) => x.score > 0)
      // Layers with zero entities can't have been a real role layer;
      // drop them to avoid noisy suggestions.
      .filter((x) => x.s.entityCount > 0)
      // DXF MVP follow-up (2026-06-24) — a layer with no closed
      // polygons can't be a room-bounds layer no matter how cleanly
      // its name matches "AREA" or "ROOM". On the LAMI files
      // `LAMI-A-AREA-IDEN` scored 90 here (contains AREA) but had
      // zero closed LWPOLYLINEs — it's labels only. Drop that case
      // so the modal doesn't pre-fill the user into a guaranteed
      // zero-rooms outcome.
      .filter((x) =>
        role === 'roomBounds' ? x.s.closedPolylineCount > 0 : true,
      )
      // Same idea symmetrically — a roomLabels candidate should have
      // at least one TEXT / MTEXT entity.
      .filter((x) =>
        role === 'roomLabels' ? x.s.textCount > 0 : true,
      )
      // doors / windows candidates should have at least one INSERT.
      .filter((x) =>
        role === 'doors' || role === 'windows'
          ? (x.s.entityTypes['INSERT'] ?? 0) > 0
          : true,
      )
    scored.sort((a, b) => b.score - a.score || b.s.entityCount - a.s.entityCount)
    suggested[role] = scored.map((x) => x.s.name)
    // Decorate the summary so the modal can label badges per layer.
    for (const { s } of scored) {
      if (!s.matchedRoles.includes(role as keyof LayerMap)) {
        s.matchedRoles.push(role as keyof LayerMap)
      }
    }
  }

  const layers = [...summaries.values()].sort((a, b) => b.entityCount - a.entityCount)
  const insUnits =
    typeof parsed.header['$INSUNITS'] === 'number'
      ? (parsed.header['$INSUNITS'] as number)
      : null

  // DXF-AUTO-SKIP — count `CODE areaM²` MTEXT matches on any
  // suggested room-label layer. Cheap: O(MTEXT count) and we only
  // iterate the small fraction of entities that are text. A real
  // plan sheet returns 8-25; elevation/detail/RCP sheets return 0.
  const roomLabelLayerSet = new Set<string>(suggested.roomLabels)
  let plausibleRoomLabelCount = 0
  if (roomLabelLayerSet.size > 0) {
    for (const e of parsed.entities) {
      if (e.type !== 'MTEXT' && e.type !== 'TEXT') continue
      if (!roomLabelLayerSet.has(e.layer)) continue
      const raw = String((e as { text?: string }).text ?? '')
      const parsedLabel = parseRoomLabel(cleanMText(raw))
      if (parsedLabel.kind === 'code-area') plausibleRoomLabelCount += 1
    }
  }

  return {
    ok: true,
    error: null,
    insUnits,
    totalEntities: parsed.entities.length,
    totalLayers: layers.length,
    layers,
    suggested,
    plausibleRoomLabelCount,
  }
}

function firstEqLastVertex(e: unknown): boolean {
  const vertices = (e as { vertices?: Array<{ x: number; y: number }> }).vertices
  if (!vertices || vertices.length < 3) return false
  const first = vertices[0]!
  const last = vertices[vertices.length - 1]!
  return Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001
}
