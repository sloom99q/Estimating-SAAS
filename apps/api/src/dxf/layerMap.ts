/**
 * Per-project LayerMap — the contract the PARSE_DXF handler reads to
 * know which DXF layer holds rooms, which holds doors, etc.
 *
 * Each role is an ORDERED list of candidate layer names; the parser
 * tries each in turn until one matches non-empty entities in the
 * uploaded DXF. This way a single LayerMap written for one firm's
 * convention mostly works for another — extra fallbacks cost nothing
 * when they're absent.
 *
 * The defaults are AIA NCS (US National CAD Standard). Real-world
 * UAE practice usually has an AIA-flavoured spine with project- or
 * firm-specific prefixes; the introspector pattern-matches against
 * any layer name CONTAINING one of these tokens, so "ARCH-A-AREA-
 * ROOM" or "AAR-ROOM" both auto-suggest as the room-bounds layer.
 */
export interface LayerMap {
  /** Closed polylines on this layer are room boundaries. */
  roomBounds: string[]
  /** TEXT/MTEXT on this layer are room names. */
  roomLabels: string[]
  /** INSERT (block-ref) entities on this layer are doors. */
  doors: string[]
  /** INSERT entities on this layer are windows. */
  windows: string[]
  /** Wall polylines (phase 2 — wall-length extraction for paint). */
  walls: string[]
  /** ATTRIB names whose value carries the schedule tag for an INSERT. */
  tagAttribs: string[]
  /** Polygons smaller than this are dropped (furniture, fittings). */
  minRoomAreaM2: number
  /** Polygons larger than this are dropped (building outline, plot). */
  maxRoomAreaM2: number
}

export const AIA_NCS_DEFAULT: LayerMap = {
  roomBounds: ['A-AREA-ROOM', 'A-AREA', 'A-WALL', 'ROOMS', 'ROOM'],
  roomLabels: ['A-ANNO-ROOM', 'A-ANNO-NOTE', 'A-AREA-IDEN', 'ROOM-NAMES', 'TEXT-ROOMS'],
  doors: ['A-DOOR', 'A-DOOR-SYMB', 'DOORS'],
  windows: ['A-GLAZ', 'A-WINDOW', 'WINDOWS'],
  walls: ['A-WALL', 'WALLS'],
  tagAttribs: ['TAG', 'MARK', 'TYPE', 'ID', 'NUMBER', 'CODE'],
  minRoomAreaM2: 0.8,
  maxRoomAreaM2: 500,
}
