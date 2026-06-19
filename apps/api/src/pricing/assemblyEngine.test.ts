import { describe, expect, test } from 'bun:test'
import {
  JOTUN_INTERIOR_PAINT_SYSTEM_A,
  computeAssemblyUnitCost,
} from './assemblyEngine'

describe('Assembly engine — Jotun reference recipe', () => {
  test('unitCost ≈ 20.20 AED/m² before tools', () => {
    const result = computeAssemblyUnitCost(JOTUN_INTERIOR_PAINT_SYSTEM_A.components)
    // primer 0.65 + stucco 2.75 + paint 10.80 + labor 6.00 = 20.20 /m²
    expect(Number(result.unitCost.toString())).toBeCloseTo(20.2, 1)
    expect(result.toolsSkipped).toBe(true)
  })

  test('breakdown contributions sum to the unit cost', () => {
    const result = computeAssemblyUnitCost(JOTUN_INTERIOR_PAINT_SYSTEM_A.components)
    const sum = result.breakdown.reduce(
      (acc, entry) => acc + Number(entry.contribution.toString()),
      0,
    )
    expect(sum).toBeCloseTo(Number(result.unitCost.toString()), 4)
  })

  test('individual contributions match spec', () => {
    const result = computeAssemblyUnitCost(JOTUN_INTERIOR_PAINT_SYSTEM_A.components)
    const labelled = Object.fromEntries(
      result.breakdown.map((b) => [b.label, Number(b.contribution.toString())]),
    )
    expect(labelled.Primer).toBeCloseTo(0.65, 2)
    expect(labelled.Stucco).toBeCloseTo(2.75, 2)
    expect(labelled['Paint top coat']).toBeCloseTo(10.8, 2)
    expect(labelled['Application labor']).toBeCloseTo(6, 2)
    expect(labelled['Brushes / rollers / trays']).toBe(0) // skipped without projectQty
  })

  test('with projectQty=500 m² the tool cost amortises to 0.30 /m² ⇒ total 20.50', () => {
    const result = computeAssemblyUnitCost(JOTUN_INTERIOR_PAINT_SYSTEM_A.components, {
      projectQty: 500,
    })
    expect(Number(result.unitCost.toString())).toBeCloseTo(20.5, 2)
    expect(result.toolsSkipped).toBe(false)
  })

  test('zero coverage on a MATERIAL row contributes 0 (no divide-by-zero)', () => {
    const result = computeAssemblyUnitCost([
      { kind: 'MATERIAL', label: 'broken', unitPrice: 100, coverage: 0, coats: 1, wastagePct: 0 },
    ])
    expect(Number(result.unitCost.toString())).toBe(0)
  })

  test('wastagePct increases the material contribution linearly', () => {
    const a = computeAssemblyUnitCost([
      { kind: 'MATERIAL', unitPrice: 100, coverage: 10, coats: 1, wastagePct: 0 },
    ])
    const b = computeAssemblyUnitCost([
      { kind: 'MATERIAL', unitPrice: 100, coverage: 10, coats: 1, wastagePct: 20 },
    ])
    expect(Number(a.unitCost.toString())).toBeCloseTo(10, 4)
    expect(Number(b.unitCost.toString())).toBeCloseTo(12, 4)
  })
})
