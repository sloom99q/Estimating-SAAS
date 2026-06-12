import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { parseLegendTextLayer } from './legendTextPass'

const FIXTURE_DIR = join(import.meta.dir, '..', '..', 'fixtures', 'text-layer')

const CORE_CODES = [
  'ST01',
  'ST02',
  'ST03',
  'PR01',
  'PR03',
  'WD01',
  'FN01',
  'FN02',
  'FN03',
  'FN04',
  'LS01',
  'LS02',
]

describe('legendTextPass — Plot 4357', () => {
  it('recovers all 12 core finish codes from I401 + I402 text layers', () => {
    const i401 = readFileSync(join(FIXTURE_DIR, 'plot4357-I401.txt'), 'utf-8')
    const i402 = readFileSync(join(FIXTURE_DIR, 'plot4357-I402.txt'), 'utf-8')
    const codes = new Set<string>()
    for (const text of [i401, i402]) {
      const { rows } = parseLegendTextLayer(text)
      for (const r of rows) codes.add(r.code)
    }
    const missing = CORE_CODES.filter((c) => !codes.has(c))
    if (missing.length > 0) {
      throw new Error(
        `Missing core codes: ${missing.join(', ')}. Found codes: ${Array.from(codes).sort().join(', ')}`,
      )
    }
    expect(missing).toEqual([])
  })

  it('detects the BATHROOM sentinel from I401', () => {
    const i401 = readFileSync(join(FIXTURE_DIR, 'plot4357-I401.txt'), 'utf-8')
    const { bathroomSentinelSeen, rows } = parseLegendTextLayer(i401)
    expect(bathroomSentinelSeen).toBe(true)
    expect(rows.find((r) => r.code === 'BATHROOM')).toBeDefined()
  })

  it('drops drawing-number noise (I401, A101 etc.) from the code set', () => {
    const i401 = readFileSync(join(FIXTURE_DIR, 'plot4357-I401.txt'), 'utf-8')
    const { rows } = parseLegendTextLayer(i401)
    for (const r of rows) {
      expect(r.code).not.toMatch(/^I4\d{2}$/)
      expect(r.code).not.toMatch(/^A\d{3}$/)
    }
  })

  it('attaches a name (e.g. WHITE MARBLE) to ST01', () => {
    const i401 = readFileSync(join(FIXTURE_DIR, 'plot4357-I401.txt'), 'utf-8')
    const { rows } = parseLegendTextLayer(i401)
    const st01 = rows.find((r) => r.code === 'ST01')
    expect(st01).toBeDefined()
    expect(st01?.name?.toUpperCase()).toContain('MARBLE')
  })

  it('attaches a description (e.g. Interior Floor Finish) to ST01', () => {
    const i401 = readFileSync(join(FIXTURE_DIR, 'plot4357-I401.txt'), 'utf-8')
    const { rows } = parseLegendTextLayer(i401)
    const st01 = rows.find((r) => r.code === 'ST01')
    expect(st01?.description).toMatch(/floor finish/i)
  })

  it('walls-only I403 should still expose codes when present', () => {
    const i403 = readFileSync(join(FIXTURE_DIR, 'plot4357-I403.txt'), 'utf-8')
    const { rows } = parseLegendTextLayer(i403)
    // I403 doesn't carry the floor-finish core set; it carries WALL codes the
    // text layer prints in its own table. The contract here is "no garbage,
    // no I403 self-reference"; specific wall-code coverage is enforced by
    // the full pipeline scorer once I403/I404 walls are wired in S8.
    for (const r of rows) {
      expect(r.code).not.toMatch(/^I4\d{2}$/)
    }
  })
})
