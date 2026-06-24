/**
 * DXF MVP — hand-authored test fixture generator.
 *
 * Writes apps/api/test/fixtures/test-villa.dxf — a minimal R2018-ish
 * ASCII DXF representing a tiny 3-room villa layout on AIA NCS-style
 * layers, with door + window block inserts. Used by:
 *   - apps/api/src/dxf/introspect.test.ts (asserts layer report shape)
 *   - the LayerMapModal screenshot run before sign-off
 *
 * Geometry is in millimetres ($INSUNITS=4). Coordinates picked so the
 * rooms have known areas the introspector can sanity-check later:
 *   LIVING ROOM   : 5.00 m × 4.00 m =  20.00 m²
 *   KITCHEN       : 3.50 m × 4.00 m =  14.00 m²
 *   MASTER BEDROOM: 5.00 m × 4.50 m =  22.50 m²
 *
 * Run: bun apps/api/test/fixtures/generate-test-villa-dxf.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Point { x: number; y: number }

const lines: string[] = []
function emit(...kv: Array<[number, string | number]>): void {
  for (const [code, value] of kv) {
    lines.push(String(code))
    lines.push(typeof value === 'number' ? value.toString() : value)
  }
}

// --- HEADER --------------------------------------------------------
emit([0, 'SECTION'], [2, 'HEADER'])
// $INSUNITS = 4 → millimetres. Critical for area math downstream.
emit([9, '$INSUNITS'], [70, 4])
emit([9, '$ACADVER'], [1, 'AC1027']) // AutoCAD 2013 format — well-supported by parsers
emit([0, 'ENDSEC'])

// --- TABLES --------------------------------------------------------
emit([0, 'SECTION'], [2, 'TABLES'])
emit([0, 'TABLE'], [2, 'LAYER'])
emit([70, 6]) // max layer count
const layers: Array<{ name: string; color: number }> = [
  { name: '0', color: 7 },
  { name: 'A-AREA-ROOM', color: 1 },
  { name: 'A-ANNO-ROOM', color: 2 },
  { name: 'A-DOOR', color: 3 },
  { name: 'A-GLAZ', color: 4 },
  { name: 'A-WALL', color: 5 },
]
for (const l of layers) {
  emit([0, 'LAYER'], [2, l.name], [70, 0], [62, l.color], [6, 'CONTINUOUS'])
}
emit([0, 'ENDTAB'])
emit([0, 'ENDSEC'])

// --- BLOCKS --------------------------------------------------------
// Define DR-SINGLE-900 (a door) and WIN-2400 (a window). Minimum
// geometry: a single LINE inside each so dxf-parser sees the block
// as non-empty.
emit([0, 'SECTION'], [2, 'BLOCKS'])
for (const blockName of ['DR-SINGLE-900', 'WIN-2400']) {
  emit([0, 'BLOCK'], [2, blockName], [70, 0])
  emit([10, 0], [20, 0]) // base point
  emit([3, blockName]) // name2
  emit([0, 'LINE'], [8, '0'], [10, 0], [20, 0], [11, 100], [21, 0])
  emit([0, 'ENDBLK'])
}
emit([0, 'ENDSEC'])

// --- ENTITIES ------------------------------------------------------
emit([0, 'SECTION'], [2, 'ENTITIES'])

// Three closed LWPOLYLINE rooms.
function emitRoomPolygon(layer: string, vertices: Point[]): void {
  emit([0, 'LWPOLYLINE'])
  emit([8, layer])
  emit([90, vertices.length]) // vertex count
  emit([70, 1]) // 1 = closed
  for (const v of vertices) {
    emit([10, v.x], [20, v.y])
  }
}

// LIVING ROOM (5000 × 4000 mm)
emitRoomPolygon('A-AREA-ROOM', [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
  { x: 5000, y: 4000 },
  { x: 0, y: 4000 },
])

// KITCHEN (3500 × 4000 mm) — sits adjacent to LIVING
emitRoomPolygon('A-AREA-ROOM', [
  { x: 5000, y: 0 },
  { x: 8500, y: 0 },
  { x: 8500, y: 4000 },
  { x: 5000, y: 4000 },
])

// MASTER BEDROOM (5000 × 4500 mm) — above LIVING
emitRoomPolygon('A-AREA-ROOM', [
  { x: 0, y: 4000 },
  { x: 5000, y: 4000 },
  { x: 5000, y: 8500 },
  { x: 0, y: 8500 },
])

// Some wall LINEs on A-WALL so that layer isn't empty (introspector
// reports walls layer correctness).
function emitLine(layer: string, a: Point, b: Point): void {
  emit([0, 'LINE'])
  emit([8, layer])
  emit([10, a.x], [20, a.y])
  emit([11, b.x], [21, b.y])
}
emitLine('A-WALL', { x: 0, y: 0 }, { x: 8500, y: 0 })
emitLine('A-WALL', { x: 8500, y: 0 }, { x: 8500, y: 4000 })
emitLine('A-WALL', { x: 0, y: 0 }, { x: 0, y: 8500 })

// Three TEXT labels (one per room).
function emitText(layer: string, p: Point, text: string): void {
  emit([0, 'TEXT'])
  emit([8, layer])
  emit([10, p.x], [20, p.y], [30, 0])
  emit([40, 200]) // text height
  emit([1, text])
}
emitText('A-ANNO-ROOM', { x: 2500, y: 2000 }, 'LIVING ROOM')
emitText('A-ANNO-ROOM', { x: 6750, y: 2000 }, 'KITCHEN')
emitText('A-ANNO-ROOM', { x: 2500, y: 6250 }, 'MASTER BEDROOM')

// Door INSERTs — 5 total. D01 (×2), D02 (×2), D03 (×1).
// In a real DWG these would carry a TAG attribute; for the
// introspect-only preview we just need them on the right layer.
function emitInsert(layer: string, blockName: string, p: Point): void {
  emit([0, 'INSERT'])
  emit([8, layer])
  emit([2, blockName])
  emit([10, p.x], [20, p.y], [30, 0])
  emit([50, 0]) // rotation
}
emitInsert('A-DOOR', 'DR-SINGLE-900', { x: 2500, y: 0 })
emitInsert('A-DOOR', 'DR-SINGLE-900', { x: 7250, y: 0 })
emitInsert('A-DOOR', 'DR-SINGLE-900', { x: 5000, y: 2000 })
emitInsert('A-DOOR', 'DR-SINGLE-900', { x: 2500, y: 4000 })
emitInsert('A-DOOR', 'DR-SINGLE-900', { x: 5000, y: 6250 })

// Window INSERTs — 5 total on A-GLAZ.
emitInsert('A-GLAZ', 'WIN-2400', { x: 1500, y: 0 })
emitInsert('A-GLAZ', 'WIN-2400', { x: 4000, y: 0 })
emitInsert('A-GLAZ', 'WIN-2400', { x: 8500, y: 1500 })
emitInsert('A-GLAZ', 'WIN-2400', { x: 8500, y: 3000 })
emitInsert('A-GLAZ', 'WIN-2400', { x: 0, y: 6000 })

emit([0, 'ENDSEC'])
emit([0, 'EOF'])

const out = lines.join('\n') + '\n'
const fp = join(import.meta.dirname, 'test-villa.dxf')
writeFileSync(fp, out, 'utf-8')
console.log(`wrote ${fp}  (${out.length.toLocaleString()} bytes, ${lines.length / 2} groups)`)
