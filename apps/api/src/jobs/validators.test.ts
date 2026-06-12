import { describe, expect, test } from 'bun:test'
import { recoverBuaFromText, runValidators, type ValidatorContext } from './validators'

const baseCtx: ValidatorContext = {
  projectType: 'residential',
  doors: [
    { id: 'd1', category: 'DOOR', tag: 'D01', meta: { width_mm: 1000, height_mm: 3000 } },
    { id: 'd2', category: 'DOOR', tag: 'D02', meta: { width_mm: 900, height_mm: 3000 } },
  ],
  windows: [
    { id: 'w1', category: 'WINDOW', tag: 'CW01', meta: { width_mm: 3030, height_mm: 4040 } },
  ],
  planTextBlob: 'living room shows D01 D02 CW01 and CW07 mark',
}

describe('runValidators — Sprint 4 net', () => {
  test('happy path: no errors when doors + windows present, sizes sane, tags referenced', () => {
    const flags = runValidators(baseCtx)
    // CW07 isn't in the schedule → TAG_COVERAGE WARN, but no ERRORs.
    expect(flags.filter((f) => f.severity === 'ERROR')).toEqual([])
  })

  test('CATEGORY_SANITY fires when residential set has zero windows', () => {
    const ctx: ValidatorContext = { ...baseCtx, windows: [] }
    const flags = runValidators(ctx)
    const cs = flags.find((f) => f.rule === 'CATEGORY_SANITY')
    expect(cs).toBeDefined()
    expect(cs!.severity).toBe('ERROR')
    expect(cs!.message).toMatch(/windows/i)
  })

  test('CATEGORY_SANITY fires when residential set has zero doors', () => {
    const ctx: ValidatorContext = { ...baseCtx, doors: [] }
    const flags = runValidators(ctx)
    expect(flags.some((f) => f.rule === 'CATEGORY_SANITY' && /doors/i.test(f.message))).toBe(true)
  })

  test('TAG_COVERAGE flags schedule tag not referenced on any plan', () => {
    const ctx: ValidatorContext = {
      ...baseCtx,
      doors: [
        ...baseCtx.doors,
        { id: 'd3', category: 'DOOR', tag: 'D99', meta: { width_mm: 900, height_mm: 2400 } },
      ],
    }
    const flags = runValidators(ctx)
    const orphan = flags.find((f) => f.rule === 'TAG_COVERAGE' && f.takeoffItemId === 'd3')
    expect(orphan).toBeDefined()
  })

  test('TAG_COVERAGE flags plan-only tag missing from schedule', () => {
    const flags = runValidators(baseCtx)
    expect(flags.some((f) => f.rule === 'TAG_COVERAGE' && /CW07/.test(f.message))).toBe(true)
  })

  test('UNIT_SANITY fires for an out-of-range door width', () => {
    const ctx: ValidatorContext = {
      ...baseCtx,
      doors: [
        { id: 'dx', category: 'DOOR', tag: 'DX', meta: { width_mm: 50, height_mm: 3000 } },
      ],
    }
    const flag = runValidators(ctx).find((f) => f.rule === 'UNIT_SANITY' && f.takeoffItemId === 'dx')
    expect(flag).toBeDefined()
    expect(flag!.severity).toBe('ERROR')
  })

  test('DUPLICATE_TAG fires when same tag appears twice in one schedule', () => {
    const ctx: ValidatorContext = {
      ...baseCtx,
      doors: [
        ...baseCtx.doors,
        { id: 'dup', category: 'DOOR', tag: 'D01', meta: { width_mm: 1000, height_mm: 3000 } },
      ],
    }
    const dup = runValidators(ctx).find((f) => f.rule === 'DUPLICATE_TAG')
    expect(dup).toBeDefined()
    expect(dup!.severity).toBe('ERROR')
    expect(dup!.takeoffItemId).toBe('dup')
  })

  test('variant suffixes (D01-A vs D01-B) are NOT treated as duplicates', () => {
    const ctx: ValidatorContext = {
      ...baseCtx,
      doors: [
        { id: 'a', category: 'DOOR', tag: 'D01-A', meta: { width_mm: 900, height_mm: 2100 } },
        { id: 'b', category: 'DOOR', tag: 'D01-B', meta: { width_mm: 900, height_mm: 2100 } },
      ],
      planTextBlob: 'plan mentions D01-A and D01-B',
    }
    expect(runValidators(ctx).filter((f) => f.rule === 'DUPLICATE_TAG')).toEqual([])
  })

  // -------- Sprint 8 S8-5 ROOMS_AREA_RECONCILE --------

  test('ROOMS_AREA_RECONCILE skipped without BUA', () => {
    const ctx: ValidatorContext = { ...baseCtx, roomAreasM2: [10, 20, 30], declaredBuaM2: null }
    expect(runValidators(ctx).find((f) => f.rule === 'ROOMS_AREA_RECONCILE')).toBeUndefined()
  })

  test('ROOMS_AREA_RECONCILE passes when sum is within ±20% of BUA', () => {
    const ctx: ValidatorContext = { ...baseCtx, roomAreasM2: [200, 200, 200], declaredBuaM2: 584 }
    expect(runValidators(ctx).find((f) => f.rule === 'ROOMS_AREA_RECONCILE')).toBeUndefined()
  })

  test('ROOMS_AREA_RECONCILE fires WARN when sum drifts beyond ±20%', () => {
    const ctx: ValidatorContext = { ...baseCtx, roomAreasM2: [50, 50, 50], declaredBuaM2: 584 }
    const flag = runValidators(ctx).find((f) => f.rule === 'ROOMS_AREA_RECONCILE')
    expect(flag).toBeDefined()
    expect(flag!.severity).toBe('WARN')
    expect(flag!.message).toMatch(/150/)
    expect(flag!.message).toMatch(/584/)
    expect(flag!.message).toMatch(/below BUA/i)
  })

  // -------- Sprint 8 S8-5 BUA recovery --------

  test('recoverBuaFromText finds "BUA: 584 m²"', () => {
    expect(recoverBuaFromText('Notes\nBUA: 584 m²\n')).toBe(584)
  })

  test('recoverBuaFromText finds "Built Up Area = 584 sqm"', () => {
    expect(recoverBuaFromText('Built Up Area = 584 sqm')).toBe(584)
  })

  test('recoverBuaFromText handles the label/value on adjacent lines', () => {
    expect(recoverBuaFromText('BUA\n584.00 m²')).toBe(584)
  })

  test('recoverBuaFromText returns null on ambiguous multi-value blobs', () => {
    expect(recoverBuaFromText('BUA: 100 m²\nBUA: 250 m²')).toBeNull()
  })

  test('recoverBuaFromText returns null when no label present', () => {
    expect(recoverBuaFromText('Just some area: 584 m²')).toBeNull()
  })
})
