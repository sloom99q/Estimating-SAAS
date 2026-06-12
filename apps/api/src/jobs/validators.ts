/**
 * Sprint-4 S4-5: post-extraction validation net.
 *
 * Pure functions (no Prisma access) so the rules are unit-testable. The
 * EXTRACT_ROOMS handler calls `runValidators(...)` at the end of the
 * pipeline and persists every result as a ValidationFlag row. Flags appear
 * in the existing review UI via the takeoff bundle — no SPA change needed.
 *
 * Four rules:
 *
 *   CATEGORY_SANITY  — a residential set with zero windows is almost
 *                      certainly an extraction failure, not a real spec.
 *                      ERROR. Likewise zero doors.
 *
 *   TAG_COVERAGE     — for every tag that appears in a door/window
 *                      schedule, check that the same tag is referenced
 *                      somewhere in the plan-sheet text blobs (and vice
 *                      versa). Each direction produces its own WARN.
 *
 *   UNIT_SANITY      — door width 400–2500mm, height 1800–2400mm;
 *                      window width 300–6000mm, height 300–3500mm. Outside
 *                      these ranges = ERROR (likely unit confusion or
 *                      misread).
 *
 *   DUPLICATE_TAG    — the same tag appears twice in the SAME schedule.
 *                      ERROR. Vision should split variants (D01-A / D01-B)
 *                      into different tags; bare-tag duplicates mean the
 *                      reconciler accepted both passes' rows.
 */
import type { Prisma } from '@prisma/client'

export type ValidationRule =
  | 'CATEGORY_SANITY'
  | 'TAG_COVERAGE'
  | 'UNIT_SANITY'
  | 'DUPLICATE_TAG'
  | 'ROOMS_AREA_RECONCILE'

export type ValidationSeverity = 'ERROR' | 'WARN' | 'INFO'

export interface ValidationResult {
  rule: ValidationRule
  severity: ValidationSeverity
  message: string
  takeoffItemId?: string
}

export interface ValidatorTakeoffItem {
  id: string
  category: string
  tag: string | null
  meta: Prisma.JsonValue | null
}

export interface ValidatorContext {
  /** 'residential' | 'commercial' | etc. Drives CATEGORY_SANITY's expectations. */
  projectType: string | null
  doors: ValidatorTakeoffItem[]
  windows: ValidatorTakeoffItem[]
  /** Concatenated text-layer blobs of all PLAN / FINISH_PLAN sheets. */
  planTextBlob: string
  /** Sprint-8 S8-5: post-dedup unique room areas (m²). */
  roomAreasM2?: number[]
  /**
   * Sprint-8 S8-5: declared Built-Up Area from the cover/register sheet.
   * The handler ships this in if it can recover it from the text layer
   * (e.g. "BUA: 584 m²"). If unknown we skip the rule rather than fail it.
   */
  declaredBuaM2?: number | null
}

// ---------- CATEGORY_SANITY ----------

function categorySanity(ctx: ValidatorContext): ValidationResult[] {
  const out: ValidationResult[] = []
  const type = ctx.projectType?.toLowerCase() ?? ''
  // Residential / commercial sets both should have BOTH doors and windows. A
  // zero count on either is almost always an extraction failure (the Sprint-3
  // live run lost all 20 windows because of a routing bug — exactly this).
  const residentialish = type === 'residential' || type === 'commercial' || type === 'mixed' || type === ''
  if (!residentialish) return out
  if (ctx.windows.length === 0) {
    out.push({
      rule: 'CATEGORY_SANITY',
      severity: 'ERROR',
      message:
        'Zero windows extracted on a residential/commercial set. ' +
        'Almost certainly an extraction routing failure (Plot 4357 S3 lesson).',
    })
  }
  if (ctx.doors.length === 0) {
    out.push({
      rule: 'CATEGORY_SANITY',
      severity: 'ERROR',
      message: 'Zero doors extracted. Verify schedule-sheet routing.',
    })
  }
  return out
}

// ---------- TAG_COVERAGE ----------

function tagCoverage(ctx: ValidatorContext): ValidationResult[] {
  const results: ValidationResult[] = []
  const inPlanText = (tag: string) => new RegExp(`\\b${tag}\\b`).test(ctx.planTextBlob)

  // Direction 1: schedule tags that NEVER appear on any plan sheet.
  for (const door of ctx.doors) {
    if (!door.tag) continue
    if (!inPlanText(door.tag)) {
      results.push({
        rule: 'TAG_COVERAGE',
        severity: 'WARN',
        takeoffItemId: door.id,
        message: `Door ${door.tag} is in the schedule but not referenced on any plan. Possible orphan.`,
      })
    }
  }
  for (const win of ctx.windows) {
    if (!win.tag) continue
    if (!inPlanText(win.tag)) {
      results.push({
        rule: 'TAG_COVERAGE',
        severity: 'WARN',
        takeoffItemId: win.id,
        message: `Window ${win.tag} is in the schedule but not referenced on any plan. Possible orphan.`,
      })
    }
  }

  // Direction 2: tags placed on plans but NOT in the schedule.
  const scheduledDoor = new Set(ctx.doors.map((d) => d.tag).filter((t): t is string => !!t))
  const scheduledWindow = new Set(ctx.windows.map((w) => w.tag).filter((t): t is string => !!t))
  const doorTagsOnPlans = new Set<string>()
  const windowTagsOnPlans = new Set<string>()
  const doorRe = /\bD\d{2}(?:-[A-Z])?\b/g
  const windowRe = /\b(?:CW|W)\d{2}(?:-[A-Z])?\b/g
  for (const m of ctx.planTextBlob.matchAll(doorRe)) doorTagsOnPlans.add(m[0])
  for (const m of ctx.planTextBlob.matchAll(windowRe)) windowTagsOnPlans.add(m[0])
  for (const tag of doorTagsOnPlans) {
    if (!scheduledDoor.has(tag)) {
      results.push({
        rule: 'TAG_COVERAGE',
        severity: 'WARN',
        message: `Door ${tag} appears on a plan sheet but is not in the door schedule. Verify.`,
      })
    }
  }
  for (const tag of windowTagsOnPlans) {
    if (!scheduledWindow.has(tag)) {
      results.push({
        rule: 'TAG_COVERAGE',
        severity: 'WARN',
        message: `Window ${tag} appears on a plan sheet but is not in the schedule. Verify.`,
      })
    }
  }
  return results
}

// ---------- UNIT_SANITY ----------

const DOOR_WIDTH_RANGE = { min: 400, max: 2500 }
const DOOR_HEIGHT_RANGE = { min: 1800, max: 3500 }
const WINDOW_WIDTH_RANGE = { min: 300, max: 6000 }
const WINDOW_HEIGHT_RANGE = { min: 300, max: 6000 }

function unitSanity(ctx: ValidatorContext): ValidationResult[] {
  const out: ValidationResult[] = []
  const check = (
    item: ValidatorTakeoffItem,
    kind: 'door' | 'window',
    widthRange: typeof DOOR_WIDTH_RANGE,
    heightRange: typeof DOOR_HEIGHT_RANGE,
  ) => {
    const m = (item.meta ?? {}) as Record<string, unknown>
    const w = typeof m.width_mm === 'number' ? m.width_mm : null
    const h = typeof m.height_mm === 'number' ? m.height_mm : null
    if (w !== null && (w < widthRange.min || w > widthRange.max)) {
      out.push({
        rule: 'UNIT_SANITY',
        severity: 'ERROR',
        takeoffItemId: item.id,
        message: `${kind} ${item.tag ?? '?'}: width ${w} mm outside ${widthRange.min}-${widthRange.max} mm range. Likely unit confusion.`,
      })
    }
    if (h !== null && (h < heightRange.min || h > heightRange.max)) {
      out.push({
        rule: 'UNIT_SANITY',
        severity: 'ERROR',
        takeoffItemId: item.id,
        message: `${kind} ${item.tag ?? '?'}: height ${h} mm outside ${heightRange.min}-${heightRange.max} mm range. Likely unit confusion.`,
      })
    }
  }
  for (const d of ctx.doors) check(d, 'door', DOOR_WIDTH_RANGE, DOOR_HEIGHT_RANGE)
  for (const w of ctx.windows) check(w, 'window', WINDOW_WIDTH_RANGE, WINDOW_HEIGHT_RANGE)
  return out
}

// ---------- DUPLICATE_TAG ----------

function duplicateTag(ctx: ValidatorContext): ValidationResult[] {
  const out: ValidationResult[] = []
  const seen = new Map<string, number>()
  const flagDup = (item: ValidatorTakeoffItem, schedule: 'door' | 'window') => {
    if (!item.tag) return
    const key = `${schedule}:${item.tag}`
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count > 1) {
      out.push({
        rule: 'DUPLICATE_TAG',
        severity: 'ERROR',
        takeoffItemId: item.id,
        message: `Duplicate ${schedule} tag ${item.tag} (occurrence ${count}). Variants should use suffixes (-A / -B); bare duplicates indicate a reconciler bug.`,
      })
    }
  }
  for (const d of ctx.doors) flagDup(d, 'door')
  for (const w of ctx.windows) flagDup(w, 'window')
  return out
}

// ---------- Entry point ----------

// ---------- BUA recovery helper (Sprint-8 S8-5) ----------

/**
 * Recover a Built-Up Area declaration from cover/register-sheet text. Looks
 * for patterns like:
 *   - "BUA: 584 m²"
 *   - "BUA = 584 sqm"
 *   - "Built Up Area  584.00 m2"
 *   - "Total Built-up Area: 584 sqm"
 * Returns null if no clean match is found. We only accept one value; multi-
 * value matches (a basement + GF + L1 table) get skipped so the validator
 * doesn't compare against the wrong total.
 */
const BUA_LABEL_RE = /(?:BUA|BUILT[\s-]*UP\s*AREA)/i
const BUA_NUMBER_RE = /([0-9]{2,5}(?:\.[0-9]{1,2})?)\s*(?:m\s*²|m2|sqm|m\.?\s*sq\.?)/i

export function recoverBuaFromText(text: string): number | null {
  const matches: number[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!BUA_LABEL_RE.test(line)) continue
    // Same line first
    const sameLine = line.match(BUA_NUMBER_RE)
    if (sameLine) {
      matches.push(Number.parseFloat(sameLine[1]!))
      continue
    }
    // Next line (BUA label / value can stack vertically)
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 3); j++) {
      const peek = lines[j]!.match(BUA_NUMBER_RE)
      if (peek) {
        matches.push(Number.parseFloat(peek[1]!))
        break
      }
    }
  }
  const unique = Array.from(new Set(matches.map((n) => Math.round(n * 100) / 100)))
  if (unique.length === 1) return unique[0]!
  return null
}

// ---------- ROOMS_AREA_RECONCILE (Sprint-8 S8-5) ----------

const ROOMS_AREA_TOLERANCE = 0.2 // ±20%

function roomsAreaReconcile(ctx: ValidatorContext): ValidationResult[] {
  const areas = ctx.roomAreasM2 ?? []
  const bua = ctx.declaredBuaM2 ?? null
  if (bua === null || areas.length === 0) return []
  const sum = areas.reduce((a, b) => a + b, 0)
  const lo = bua * (1 - ROOMS_AREA_TOLERANCE)
  const hi = bua * (1 + ROOMS_AREA_TOLERANCE)
  if (sum >= lo && sum <= hi) return []
  // Outside the band — WARN, not ERROR. The cause might be excluded rooms
  // (terraces, garages, voids the BUA convention drops); BOQ will mark the
  // unassigned bucket SUSPECT so the reviewer sees the gap immediately.
  const drift = ((sum - bua) / bua) * 100
  const direction = drift > 0 ? 'above' : 'below'
  return [
    {
      rule: 'ROOMS_AREA_RECONCILE',
      severity: 'WARN',
      message:
        `Sum of ${areas.length} unique room areas = ${sum.toFixed(2)} m², ` +
        `declared BUA = ${bua.toFixed(2)} m². ${Math.abs(drift).toFixed(1)}% ${direction} BUA ` +
        `(tolerance ±${(ROOMS_AREA_TOLERANCE * 100).toFixed(0)}%). ` +
        `Unassigned-finish rooms in the BOQ are flagged SUSPECT.`,
    },
  ]
}

export function runValidators(ctx: ValidatorContext): ValidationResult[] {
  return [
    ...categorySanity(ctx),
    ...tagCoverage(ctx),
    ...unitSanity(ctx),
    ...duplicateTag(ctx),
    ...roomsAreaReconcile(ctx),
  ]
}
