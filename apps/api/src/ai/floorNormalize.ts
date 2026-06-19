/**
 * Sprint-4 S4-4: floor-label normalizer.
 *
 * Plot 4357 live extraction surfaced 6 different labels for the same two
 * floors of a G+1 villa: 'GF', 'L1', 'First Floor', 'FF', 'Roof', plus 12
 * nulls. Without normalization, the dedupe step (S4-4) can't collapse the
 * same room appearing on plan + finish_plan + RCP sheets.
 *
 * The architect's groundtruth.json owns the canonical aliases; this module
 * provides a sensible UAE-fit-out default plus a `setFloorAliases()` setter
 * the scoring harness calls when it loads ground truth.
 *
 *   normalizeFloor('GF')          → 'GF'
 *   normalizeFloor('Ground Floor') → 'GF'
 *   normalizeFloor('FF')          → 'L1'
 *   normalizeFloor('First Floor') → 'L1'
 *   normalizeFloor('Roof')        → 'Roof'
 *   normalizeFloor(null)          → null
 */

export type FloorAliasMap = Record<string, string>

/** Default UAE villa / mid-rise fit-out vocabulary. */
const DEFAULT_ALIASES: FloorAliasMap = {
  // Ground floor variants
  gf: 'GF',
  'ground floor': 'GF',
  'g floor': 'GF',
  ground: 'GF',
  // First floor variants
  l1: 'L1',
  ff: 'L1',
  'first floor': 'L1',
  'f1': 'L1',
  'level 1': 'L1',
  // Second floor variants
  l2: 'L2',
  sf: 'L2',
  'second floor': 'L2',
  'f2': 'L2',
  'level 2': 'L2',
  // Roof variants
  roof: 'Roof',
  rf: 'Roof',
  'roof level': 'Roof',
  'roof terrace': 'Roof',
  // Basement / mezzanine
  basement: 'B1',
  b1: 'B1',
  'lower ground': 'B1',
  mezzanine: 'M',
  mezz: 'M',
}

let activeAliases: FloorAliasMap = { ...DEFAULT_ALIASES }

/**
 * Replace the active alias map. Call once at startup when ground truth loads.
 * Empty map is treated as "use defaults"; partial maps merge over defaults.
 */
export function setFloorAliases(aliases: FloorAliasMap | null | undefined): void {
  if (!aliases || Object.keys(aliases).length === 0) {
    activeAliases = { ...DEFAULT_ALIASES }
    return
  }
  const merged: FloorAliasMap = { ...DEFAULT_ALIASES }
  for (const [k, v] of Object.entries(aliases)) merged[k.toLowerCase().trim()] = v
  activeAliases = merged
}

/**
 * Returns the canonical floor label for the given raw text.
 * Unknown labels pass through verbatim (preserving the original casing) so
 * the dedupe + scoring step can still flag them — silently dropping unknowns
 * would hide real-world drift.
 */
export function normalizeFloor(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return activeAliases[trimmed.toLowerCase()] ?? trimmed
}
