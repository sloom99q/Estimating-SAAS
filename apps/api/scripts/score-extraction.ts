/**
 * Sprint-4 S4-0: extraction-accuracy harness for Plot 4357 (and successors).
 *
 *   bun apps/api/scripts/score-extraction.ts <documentId>
 *
 * Loads the architect's ground-truth JSON (`apps/api/fixtures/plot4357.
 * groundtruth.json`) and the project's latest takeoff for that document,
 * scores per-category precision / recall, and prints PASS/FAIL per the
 * `scoring` rules embedded in the JSON.
 *
 * Runnable in stub AND live mode — stub-mode runs SHOULD score poorly on
 * rooms (the whole point of the harness is to measure live improvement
 * against a deterministic baseline).
 *
 * Exit code 0 = all PASS; non-zero = at least one section FAILED. Useful
 * for CI gating in future sprints.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/db'
import { normalizeFloor, setFloorAliases } from '../src/ai/floorNormalize'

interface GroundTruthDoor {
  tag: string
  count: number
  width_mm: number
  height_mm: number
}

interface GroundTruthWindow extends GroundTruthDoor {}

interface GroundTruthRoom {
  name: string
  code?: string
  floor: string
  area_m2: number
}

interface GroundTruth {
  register: {
    pageCount: number
    disciplines: string[]
    structuralSheets: boolean
    mepSheets: boolean
    anchorSheets: {
      glazingTypesSchedule: { drawingNos: string[]; approxPages: number[] }
      doorSchedule: { drawingNos: string[]; approxPages: number[] }
      groundFloorPlan: { drawingNo: string; approxPage: number }
      firstFloorPlan: { drawingNo: string; approxPage: number }
      finishPlans: { drawingNos: string[]; approxPages: number[] }
    }
  }
  doors: {
    expectedTagCount: number
    expectedTotalLeaves: number
    items: GroundTruthDoor[]
  }
  windows: {
    expectedTagCount: number
    items: GroundTruthWindow[]
  }
  rooms: {
    minNamedRoomsWithArea: number
    floorLabelAliases: Record<string, string[]>
    items: GroundTruthRoom[]
  }
  scoring: Record<string, string>
}

const TOLERANCE_PCT = 0.02
const COLOR = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
}

interface Verdict {
  section: string
  passed: boolean
  detail: string
}

function loadGroundTruth(): GroundTruth {
  const p = path.resolve(import.meta.dir, '../fixtures/plot4357.groundtruth.json')
  return JSON.parse(require('node:fs').readFileSync(p, 'utf-8')) as GroundTruth
}

function applyFloorAliases(gt: GroundTruth): void {
  const flat: Record<string, string> = {}
  for (const [canonical, variants] of Object.entries(gt.rooms.floorLabelAliases)) {
    for (const v of variants) flat[v] = canonical
  }
  setFloorAliases(flat)
}

function withinPct(a: number, b: number, pct: number): boolean {
  if (a === 0 || b === 0) return a === b
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= pct
}

function dimsAcceptable(
  expected: { width_mm: number; height_mm: number },
  actual: { width_mm: number | null; height_mm: number | null },
): boolean {
  if (actual.width_mm === null || actual.height_mm === null) return false
  // Accept either orientation (CW17 note in ground truth).
  const direct =
    withinPct(expected.width_mm, actual.width_mm, TOLERANCE_PCT) &&
    withinPct(expected.height_mm, actual.height_mm, TOLERANCE_PCT)
  const swapped =
    withinPct(expected.width_mm, actual.height_mm, TOLERANCE_PCT) &&
    withinPct(expected.height_mm, actual.width_mm, TOLERANCE_PCT)
  return direct || swapped
}

function normalizeRoomName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^\w']+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

async function main(): Promise<void> {
  const documentId = process.argv[2]
  if (!documentId) {
    console.error('usage: bun apps/api/scripts/score-extraction.ts <documentId>')
    process.exit(2)
  }

  const gt = loadGroundTruth()
  applyFloorAliases(gt)

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
  })
  if (!doc) {
    console.error(`document ${documentId} not found`)
    process.exit(2)
  }

  console.log(
    `${COLOR.bold}Plot 4357 extraction scorecard${COLOR.reset}  doc=${documentId} project=${doc.projectId}`,
  )
  console.log(`${COLOR.dim}${'-'.repeat(78)}${COLOR.reset}`)

  // -------- REGISTER --------
  const sheets = await prisma.sheet.findMany({
    where: { documentId, organizationId: doc.organizationId },
    orderBy: { pageNo: 'asc' },
  })
  const classified = sheets.filter((s) => s.discipline)
  const disciplines = new Set(classified.map((s) => s.discipline).filter((d): d is string => !!d))
  const glazingSheets = sheets.filter(
    (s) =>
      s.drawingNo && gt.register.anchorSheets.glazingTypesSchedule.drawingNos.includes(s.drawingNo),
  )
  const sheetTypeCounts: Record<string, number> = {}
  for (const s of sheets) sheetTypeCounts[s.sheetType ?? 'null'] = (sheetTypeCounts[s.sheetType ?? 'null'] ?? 0) + 1

  const verdicts: Verdict[] = []
  const registerPass =
    classified.length === gt.register.pageCount &&
    !disciplines.has('STR') &&
    !disciplines.has('MEP')
  verdicts.push({
    section: 'REGISTER',
    passed: registerPass,
    detail: `classified=${classified.length}/${gt.register.pageCount}, disciplines=[${Array.from(disciplines).sort().join(',')}]  expected=[ARCH,ID]`,
  })
  console.log(`${COLOR.bold}Register${COLOR.reset}`)
  console.log(`  sheets classified : ${classified.length}/${gt.register.pageCount}`)
  console.log(`  disciplines seen  : ${Array.from(disciplines).sort().join(', ') || '∅'}`)
  console.log(`  sheet_types       : ${Object.entries(sheetTypeCounts).map(([k, v]) => `${k}:${v}`).join(', ')}`)
  console.log(
    `  glazing sheets    : ${
      glazingSheets.length > 0
        ? glazingSheets.map((s) => `${s.drawingNo}(p${s.pageNo})→${s.sheetType}`).join(', ')
        : `${COLOR.red}NONE FOUND${COLOR.reset}`
    }`,
  )
  console.log()

  // -------- DOORS --------
  const doors = await prisma.takeoffItem.findMany({
    where: {
      organizationId: doc.organizationId,
      projectId: doc.projectId,
      category: 'DOOR',
      deletedAt: null,
    },
  })
  const doorByTag = new Map(doors.map((d) => [d.tag ?? '', d]))
  let doorTP = 0
  let doorInventedD09 = 0
  const doorMisses: string[] = []
  for (const expected of gt.doors.items) {
    const actual = doorByTag.get(expected.tag)
    if (!actual) {
      doorMisses.push(expected.tag)
      continue
    }
    const meta = (actual.meta ?? {}) as Record<string, unknown>
    const actualW = typeof meta.width_mm === 'number' ? meta.width_mm : null
    const actualH = typeof meta.height_mm === 'number' ? meta.height_mm : null
    const actualCount = typeof meta.count === 'number' ? meta.count : null
    const dimsOk = dimsAcceptable(
      { width_mm: expected.width_mm, height_mm: expected.height_mm },
      { width_mm: actualW, height_mm: actualH },
    )
    const countOk = actualCount === null || actualCount === expected.count
    if (dimsOk && countOk) doorTP += 1
  }
  if (doorByTag.has('D09')) doorInventedD09 = 1
  const extraDoors = doors.filter((d) => !gt.doors.items.some((g) => g.tag === d.tag))
  const doorPass = doorTP === gt.doors.items.length && doorInventedD09 === 0
  verdicts.push({
    section: 'DOORS',
    passed: doorPass,
    detail: `${doorTP}/${gt.doors.items.length} tags+counts match, invented D09=${doorInventedD09}, misses=${doorMisses.join(',') || '∅'}`,
  })
  console.log(`${COLOR.bold}Doors${COLOR.reset}`)
  console.log(`  expected tags     : ${gt.doors.items.map((d) => d.tag).join(', ')}`)
  console.log(`  extracted tags    : ${doors.map((d) => d.tag).filter(Boolean).join(', ') || '∅'}`)
  console.log(`  TPs (tag+count+dims): ${doorTP}/${gt.doors.items.length}`)
  console.log(`  invented D09      : ${doorInventedD09 === 0 ? `${COLOR.green}no${COLOR.reset}` : `${COLOR.red}YES (FAIL)${COLOR.reset}`}`)
  if (extraDoors.length > 0) {
    console.log(`  unexpected extras : ${extraDoors.map((d) => d.tag ?? '?').join(', ')}`)
  }
  console.log()

  // -------- WINDOWS --------
  const windows = await prisma.takeoffItem.findMany({
    where: {
      organizationId: doc.organizationId,
      projectId: doc.projectId,
      category: 'WINDOW',
      deletedAt: null,
    },
  })
  const winByTag = new Map(windows.map((w) => [w.tag ?? '', w]))
  let winTagsFound = 0
  let winFullMatch = 0
  let cw02Found = winByTag.has('CW02')
  const winMisses: string[] = []
  for (const expected of gt.windows.items) {
    const actual = winByTag.get(expected.tag)
    if (!actual) {
      winMisses.push(expected.tag)
      continue
    }
    winTagsFound += 1
    const meta = (actual.meta ?? {}) as Record<string, unknown>
    const actualW = typeof meta.width_mm === 'number' ? meta.width_mm : null
    const actualH = typeof meta.height_mm === 'number' ? meta.height_mm : null
    if (
      dimsAcceptable(
        { width_mm: expected.width_mm, height_mm: expected.height_mm },
        { width_mm: actualW, height_mm: actualH },
      )
    ) {
      winFullMatch += 1
    }
  }
  const extraWindows = windows.filter((w) => !gt.windows.items.some((g) => g.tag === w.tag))
  const winPass = winTagsFound >= 18 && cw02Found
  verdicts.push({
    section: 'WINDOWS',
    passed: winPass,
    detail: `${winTagsFound}/${gt.windows.items.length} tags found, full-match=${winFullMatch}, CW02 ${cw02Found ? 'found' : 'MISSING'}`,
  })
  console.log(`${COLOR.bold}Windows${COLOR.reset}`)
  console.log(`  expected tags     : ${gt.windows.items.map((w) => w.tag).join(', ')}`)
  console.log(`  extracted tags    : ${windows.map((w) => w.tag).filter(Boolean).join(', ') || '∅'}`)
  console.log(`  tags found        : ${winTagsFound}/${gt.windows.items.length}`)
  console.log(`  full dim match    : ${winFullMatch}/${gt.windows.items.length}`)
  console.log(`  CW02 (key score)  : ${cw02Found ? `${COLOR.green}found${COLOR.reset}` : `${COLOR.red}MISSING${COLOR.reset}`}`)
  console.log(`  misses            : ${winMisses.join(', ') || '∅'}`)
  if (extraWindows.length > 0) console.log(`  unexpected extras : ${extraWindows.map((w) => w.tag ?? '?').join(', ')}`)
  console.log()

  // -------- ROOMS --------
  const rooms = await prisma.takeoffItem.findMany({
    where: {
      organizationId: doc.organizationId,
      projectId: doc.projectId,
      category: 'ROOM',
      deletedAt: null,
    },
  })
  const roomsByKey = new Map<string, typeof rooms[number]>()
  for (const r of rooms) {
    const m = (r.meta ?? {}) as Record<string, unknown>
    const rawName = r.description.split('—')[0]?.trim() ?? ''
    const floor =
      (typeof m.floorNormalized === 'string' && m.floorNormalized) ||
      normalizeFloor(typeof m.floor === 'string' ? m.floor : null) ||
      ''
    const key = `${normalizeRoomName(rawName)}|${floor.toUpperCase()}`
    if (!roomsByKey.has(key)) roomsByKey.set(key, r)
  }
  let roomFound = 0
  let roomWithinTolerance = 0
  const roomMisses: string[] = []
  for (const expected of gt.rooms.items) {
    const expectedKey = `${normalizeRoomName(expected.name)}|${normalizeFloor(expected.floor)?.toUpperCase() ?? ''}`
    const actual = roomsByKey.get(expectedKey)
    if (!actual) {
      roomMisses.push(expected.name)
      continue
    }
    roomFound += 1
    const actualArea = actual.qtyAi === null ? null : Number(actual.qtyAi.toString())
    if (actualArea !== null && withinPct(actualArea, expected.area_m2, TOLERANCE_PCT)) {
      roomWithinTolerance += 1
    }
  }
  const dedupedSpaces = await prisma.space.count({
    where: {
      organizationId: doc.organizationId,
      projectId: doc.projectId,
      source: 'takeoff',
      deletedAt: null,
    },
  })
  const roomPass =
    roomWithinTolerance >= gt.rooms.minNamedRoomsWithArea &&
    dedupedSpaces >= 20 &&
    dedupedSpaces <= 40
  verdicts.push({
    section: 'ROOMS',
    passed: roomPass,
    detail: `${roomWithinTolerance}/${gt.rooms.items.length} within ±2%, deduped spaces=${dedupedSpaces} (target 20-40)`,
  })
  console.log(`${COLOR.bold}Rooms${COLOR.reset}`)
  console.log(`  ground truth rooms : ${gt.rooms.items.length}`)
  console.log(`  extracted rooms    : ${rooms.length}`)
  console.log(`  deduped to unique  : ${roomsByKey.size}`)
  console.log(`  found by name+floor: ${roomFound}/${gt.rooms.items.length}`)
  console.log(`  within ±2% area    : ${roomWithinTolerance}/${gt.rooms.items.length}  (target ≥${gt.rooms.minNamedRoomsWithArea})`)
  console.log(`  takeoff Spaces     : ${dedupedSpaces}  (target 20-40)`)
  if (roomMisses.length > 0) {
    console.log(`  misses             : ${roomMisses.slice(0, 10).join(', ')}${roomMisses.length > 10 ? `, ...(+${roomMisses.length - 10})` : ''}`)
  }
  console.log()

  // -------- SCORECARD --------
  console.log(`${COLOR.dim}${'-'.repeat(78)}${COLOR.reset}`)
  console.log(`${COLOR.bold}Scorecard${COLOR.reset}`)
  for (const v of verdicts) {
    const tag = v.passed ? `${COLOR.green}PASS${COLOR.reset}` : `${COLOR.red}FAIL${COLOR.reset}`
    console.log(`  ${tag}  ${v.section.padEnd(8)}  ${v.detail}`)
  }
  console.log()
  console.log(`${COLOR.bold}Scoring rules from groundtruth.json${COLOR.reset}`)
  for (const [k, v] of Object.entries(gt.scoring)) {
    console.log(`  ${k}: ${v}`)
  }

  await prisma.$disconnect()
  const overallPass = verdicts.every((v) => v.passed)
  process.exit(overallPass ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(2)
})
