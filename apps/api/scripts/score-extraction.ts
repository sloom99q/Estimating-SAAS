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
import { normalizeRoomName as handlerNormalizeRoomName } from '../src/jobs/handlers/extractRooms'
import { selectBillableRooms } from '../src/jobs/handlers/_roomSelector'

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
  finishes?: {
    legendCodesExpected: string[]
    optionalCodes?: string[]
    floorMap: Record<string, string[]>
    floorQtyTargets_m2: Record<string, [number, number]>
    ceilingTargets_m2: Record<string, [number, number]>
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

/**
 * Sprint-8 S8-2: import the SAME normaliser the handler uses for dedup. The
 * scorer's old version casefolded only — letting "MASTER BATH FF-10" and
 * "MASTER BATH" land as two different rooms, which was the silent contributor
 * to "found by name+floor = 21/22" looking fine while the area count was 12/22.
 */
function normalizeRoomName(s: string): string {
  return handlerNormalizeRoomName(s)
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
  // S8-4: collect a row-level audit so the scorer's "8/9" answer is
  // diagnosable at a glance. Every door is reported with both expected
  // and extracted (width, height, count); failing rows are flagged.
  interface DoorRowReport {
    tag: string
    expected: { width_mm: number; height_mm: number; count: number }
    actual: { width_mm: number | null; height_mm: number | null; count: number | null }
    acceptAlternates: Array<{ width_mm?: number; height_mm?: number; count?: number }>
    status: 'OK' | 'DIMS' | 'COUNT' | 'MISS'
  }
  const doorRows: DoorRowReport[] = []
  for (const expected of gt.doors.items) {
    const actual = doorByTag.get(expected.tag)
    if (!actual) {
      doorMisses.push(expected.tag)
      doorRows.push({
        tag: expected.tag,
        expected: { width_mm: expected.width_mm, height_mm: expected.height_mm, count: expected.count },
        actual: { width_mm: null, height_mm: null, count: null },
        acceptAlternates: (expected as { acceptAlternates?: DoorRowReport['acceptAlternates'] }).acceptAlternates ?? [],
        status: 'MISS',
      })
      continue
    }
    const meta = (actual.meta ?? {}) as Record<string, unknown>
    const actualW = typeof meta.width_mm === 'number' ? meta.width_mm : null
    const actualH = typeof meta.height_mm === 'number' ? meta.height_mm : null
    const actualCount = typeof meta.count === 'number' ? meta.count : null
    const acceptAlternates =
      ((expected as { acceptAlternates?: DoorRowReport['acceptAlternates'] }).acceptAlternates ?? []) as DoorRowReport['acceptAlternates']
    const dimsOkPrimary = dimsAcceptable(
      { width_mm: expected.width_mm, height_mm: expected.height_mm },
      { width_mm: actualW, height_mm: actualH },
    )
    const dimsOkAlt = acceptAlternates.some((alt) =>
      dimsAcceptable(
        {
          width_mm: alt.width_mm ?? expected.width_mm,
          height_mm: alt.height_mm ?? expected.height_mm,
        },
        { width_mm: actualW, height_mm: actualH },
      ),
    )
    const dimsOk = dimsOkPrimary || dimsOkAlt
    const countOkPrimary = actualCount === null || actualCount === expected.count
    const countOkAlt = acceptAlternates.some((alt) => alt.count !== undefined && actualCount === alt.count)
    const countOk = countOkPrimary || countOkAlt
    if (dimsOk && countOk) doorTP += 1
    doorRows.push({
      tag: expected.tag,
      expected: { width_mm: expected.width_mm, height_mm: expected.height_mm, count: expected.count },
      actual: { width_mm: actualW, height_mm: actualH, count: actualCount },
      acceptAlternates,
      status: dimsOk && countOk ? 'OK' : !dimsOk ? 'DIMS' : 'COUNT',
    })
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
  // S8-4 raw values per door — the diagnostic the architect asked for. This
  // makes every failure show its drift in the scorer output, removing the
  // "8/9 — but which one?" guess and surfacing source-conflict candidates
  // for the ADR-015 acceptAlternates list.
  console.log(`  per-row values    :`)
  for (const r of doorRows) {
    const exp = `w=${r.expected.width_mm}  h=${r.expected.height_mm}  n=${r.expected.count}`
    const got =
      r.status === 'MISS'
        ? '(not extracted)'
        : `w=${r.actual.width_mm ?? '?'}  h=${r.actual.height_mm ?? '?'}  n=${r.actual.count ?? '?'}`
    const flag =
      r.status === 'OK'
        ? `${COLOR.green}OK${COLOR.reset}`
        : `${COLOR.red}${r.status}${COLOR.reset}`
    const alt = r.acceptAlternates.length
      ? `  ${COLOR.dim}(accepts ${r.acceptAlternates.map((a) => Object.entries(a).map(([k, v]) => `${k}=${v}`).join(',')).join(' | ')})${COLOR.reset}`
      : ''
    console.log(`    ${r.tag.padEnd(4)} ${flag.padEnd(15)}  expected: ${exp}   got: ${got}${alt}`)
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
  // S9-0: pull both ROOM and AREA_STATEMENT then run the same selector
  // QUANTIFY uses, so the two can't disagree about "how many billable
  // rooms is this set".
  const rawRooms = await prisma.takeoffItem.findMany({
    where: {
      organizationId: doc.organizationId,
      projectId: doc.projectId,
      category: { in: ['ROOM', 'AREA_STATEMENT'] },
      deletedAt: null,
    },
  })
  const rooms = selectBillableRooms(rawRooms)
  // S8-2: key by name only and choose the best-scored row per name (area >
  // tag > confidence). Floor is informational on the surviving row.
  const roomsByName = new Map<string, typeof rooms[number]>()
  const scoreRoom = (i: (typeof rooms)[number]) =>
    (i.qtyAi !== null ? 4 : 0) + (i.tag !== null ? 2 : 0) + i.confidence / 100
  for (const r of rooms) {
    const key = normalizeRoomName(r.description)
    const existing = roomsByName.get(key)
    if (!existing || scoreRoom(r) > scoreRoom(existing)) roomsByName.set(key, r)
  }
  let roomFound = 0
  let roomWithinTolerance = 0
  const roomMisses: string[] = []
  for (const expected of gt.rooms.items) {
    const expectedKey = normalizeRoomName(expected.name)
    const actual = roomsByName.get(expectedKey)
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
  console.log(`  deduped to unique  : ${roomsByName.size}`)
  console.log(`  found by name+floor: ${roomFound}/${gt.rooms.items.length}`)
  console.log(`  within ±2% area    : ${roomWithinTolerance}/${gt.rooms.items.length}  (target ≥${gt.rooms.minNamedRoomsWithArea})`)
  console.log(`  takeoff Spaces     : ${dedupedSpaces}  (target 20-40)`)
  if (roomMisses.length > 0) {
    console.log(`  misses             : ${roomMisses.slice(0, 10).join(', ')}${roomMisses.length > 10 ? `, ...(+${roomMisses.length - 10})` : ''}`)
  }
  console.log()

  // -------- FINISHES (Sprint 6) --------
  if (gt.finishes) {
    const finishes = gt.finishes
    const legendItems = await prisma.takeoffItem.findMany({
      where: {
        organizationId: doc.organizationId,
        projectId: doc.projectId,
        deletedAt: null,
        tag: { not: null },
      },
      select: { tag: true, meta: true },
    })
    const legendCodes = new Set<string>()
    for (const l of legendItems) {
      const m = (l.meta ?? {}) as Record<string, unknown>
      if (m.kind === 'LEGEND' && l.tag) legendCodes.add(l.tag.toUpperCase())
    }

    // Reverse the floorMap: room name → expected finish_code.
    const expectedFinishByRoom = new Map<string, string>()
    for (const [code, names] of Object.entries(finishes.floorMap)) {
      for (const name of names) expectedFinishByRoom.set(normalizeRoomName(name), code)
    }

    let mappedCorrect = 0
    let mappedTotal = 0
    const wrong: Array<{ name: string; expected: string; actual: string | null }> = []
    for (const room of rooms) {
      const meta = (room.meta ?? {}) as Record<string, unknown>
      const rawName = room.description.split('—')[0]?.trim() ?? ''
      const expected = expectedFinishByRoom.get(normalizeRoomName(rawName))
      if (!expected) continue
      mappedTotal += 1
      const actual = typeof meta.finish_code === 'string' ? meta.finish_code.toUpperCase() : null
      if (actual === expected) mappedCorrect += 1
      else wrong.push({ name: rawName, expected, actual })
    }

    // Quantify-derived totals: FF-* / CL-CL02 / CL-CL03 by tag.
    const derived = await prisma.takeoffItem.findMany({
      where: {
        organizationId: doc.organizationId,
        projectId: doc.projectId,
        deletedAt: null,
        tag: { startsWith: 'FF-' },
      },
    })
    const floorTotalsByCode = new Map<string, number>()
    for (const d of derived) {
      const code = (d.tag ?? '').slice(3)
      const qty = d.qtyAi === null ? 0 : Number(d.qtyAi.toString())
      floorTotalsByCode.set(code, qty)
    }
    const ceilingDerived = await prisma.takeoffItem.findMany({
      where: {
        organizationId: doc.organizationId,
        projectId: doc.projectId,
        deletedAt: null,
        tag: { startsWith: 'CL-' },
      },
    })
    const ceilingTotalsByCode = new Map<string, number>()
    for (const c of ceilingDerived) {
      const code = (c.tag ?? '').slice(3)
      ceilingTotalsByCode.set(code, c.qtyAi === null ? 0 : Number(c.qtyAi.toString()))
    }

    // S7-2 PASS conditions:
    //   - core 12 (legendCodesExpected) found as a subset
    //   - zero pattern-violating codes (regex /^[A-Z]{2}\d{2}$/; BATHROOM allowed)
    //   - total within 8-25
    const CODE_RE = /^[A-Z]{2}\d{2}$/
    const coreCodes = new Set(finishes.legendCodesExpected.map((c) => c.toUpperCase()))
    const coreFound = Array.from(coreCodes).filter((c) => legendCodes.has(c))
    const coreSubsetOk = coreFound.length === coreCodes.size
    const violators = Array.from(legendCodes).filter((c) => c !== 'BATHROOM' && !CODE_RE.test(c))
    const totalRealCodes = legendCodes.size - (legendCodes.has('BATHROOM') ? 1 : 0)
    const sanityRangeOk = totalRealCodes >= 8 && totalRealCodes <= 25
    const legendOk = coreSubsetOk && violators.length === 0 && sanityRangeOk

    const mappingPct = mappedTotal === 0 ? 0 : (mappedCorrect / mappedTotal) * 100
    const mappingOk = mappingPct >= 80
    let floorRangeOk = true
    for (const [code, [lo, hi]] of Object.entries(finishes.floorQtyTargets_m2)) {
      const qty = floorTotalsByCode.get(code) ?? 0
      if (qty < lo || qty > hi) floorRangeOk = false
    }
    const cl02 = ceilingTotalsByCode.get('CL02') ?? 0
    const cl03 = ceilingTotalsByCode.get('CL03') ?? 0
    const floorGrandTotal = Array.from(floorTotalsByCode.values()).reduce((a, b) => a + b, 0)
    const ceilingDistinctOk = cl02 !== cl03 && cl02 !== floorGrandTotal && cl03 !== floorGrandTotal

    const finishesPass = legendOk && mappingOk && floorRangeOk && ceilingDistinctOk
    verdicts.push({
      section: 'FINISHES',
      passed: finishesPass,
      detail: `${coreFound.length}/${coreCodes.size} core codes; ${violators.length} pattern-violators; total ${totalRealCodes} ${sanityRangeOk ? '(8-25 ok)' : '(OUT of 8-25)'}; ${mappedCorrect}/${mappedTotal} rooms mapped (${mappingPct.toFixed(0)}%); floor ranges ${floorRangeOk ? 'ok' : 'OUT'}; CL02/CL03 ${ceilingDistinctOk ? 'distinct' : 'COLLISION'}`,
    })
    console.log(`${COLOR.bold}Finishes${COLOR.reset}`)
    console.log(`  core codes (required)  : ${coreFound.length}/${coreCodes.size} found  ${coreSubsetOk ? `${COLOR.green}subset ok${COLOR.reset}` : `${COLOR.red}MISSING: ${Array.from(coreCodes).filter((c) => !legendCodes.has(c)).join(', ')}${COLOR.reset}`}`)
    if (violators.length > 0) {
      console.log(`  ${COLOR.red}pattern violators${COLOR.reset}     : ${violators.slice(0, 8).join(', ')}${violators.length > 8 ? `, ...(+${violators.length - 8})` : ''}`)
    }
    console.log(`  total real codes       : ${totalRealCodes}  ${sanityRangeOk ? `${COLOR.green}within 8-25${COLOR.reset}` : `${COLOR.red}OUT${COLOR.reset}`}`)
    console.log(`  legend codes extracted : ${Array.from(legendCodes).sort().join(', ') || '∅'} (${legendCodes.size} total)`)
    console.log(`  room mapping accuracy  : ${mappedCorrect}/${mappedTotal} (${mappingPct.toFixed(0)}%) (target ≥80%)`)
    if (wrong.length > 0) {
      console.log(`  mapping errors         : ${wrong.slice(0, 5).map((w) => `${w.name} expected=${w.expected} got=${w.actual ?? '∅'}`).join('; ')}${wrong.length > 5 ? `, ...(+${wrong.length - 5})` : ''}`)
    }
    console.log(`  floor totals by code   :`)
    for (const [code, [lo, hi]] of Object.entries(finishes.floorQtyTargets_m2)) {
      const qty = floorTotalsByCode.get(code) ?? 0
      const ok = qty >= lo && qty <= hi
      console.log(`    ${code.padEnd(10)} ${qty.toFixed(2).padStart(8)} m²  target [${lo}, ${hi}]  ${ok ? `${COLOR.green}ok${COLOR.reset}` : `${COLOR.red}OUT${COLOR.reset}`}`)
    }
    console.log(`  ceiling totals         : CL02 ${cl02.toFixed(2)} m² · CL03 ${cl03.toFixed(2)} m²  ${ceilingDistinctOk ? `${COLOR.green}distinct${COLOR.reset}` : `${COLOR.red}COLLISION${COLOR.reset}`}`)
    console.log()
  }

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
