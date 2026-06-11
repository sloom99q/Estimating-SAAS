/**
 * Pure-TypeScript Assembly unit-cost engine.
 *
 * Sprint 3. ZERO LLM math (architect rule): pricing arithmetic is
 * deterministic, auditable, and runs on decimal arithmetic (no Float).
 *
 * Formula per component, summed:
 *
 *   MATERIAL    : (unitPrice / coverage) × coats × (1 + wastagePct/100)
 *   LABOR       : unitPrice  (already per outputUnit)
 *   TOOL_FIXED  : fixedCost / projectQty   (amortised over the run; skipped
 *                                           when projectQty is not provided
 *                                           — e.g. when browsing the library)
 *
 * Returns the unit cost in the Assembly's outputUnit plus a breakdown so the
 * UI / export can show "this is where the number came from."
 */
import { Prisma } from '@prisma/client'

type DecimalLike = Prisma.Decimal | string | number | null | undefined

export interface AssemblyComponentInput {
  /** 'MATERIAL' | 'LABOR' | 'TOOL_FIXED' */
  kind: 'MATERIAL' | 'LABOR' | 'TOOL_FIXED'
  label?: string
  unitPrice?: DecimalLike
  coverage?: DecimalLike
  coats?: number | null
  wastagePct?: DecimalLike
  fixedCost?: DecimalLike
}

export interface ComputeAssemblyOptions {
  /**
   * If present, TOOL_FIXED components are amortised over this quantity
   * (`fixedCost / projectQty`). If absent, TOOL_FIXED contributions are
   * skipped — useful for catalogue / preview rendering.
   */
  projectQty?: DecimalLike
}

export interface AssemblyBreakdownEntry {
  label: string
  kind: 'MATERIAL' | 'LABOR' | 'TOOL_FIXED'
  contribution: Prisma.Decimal
}

export interface ComputeAssemblyResult {
  unitCost: Prisma.Decimal
  breakdown: AssemblyBreakdownEntry[]
  /** Tools were skipped because `projectQty` was not provided. */
  toolsSkipped: boolean
}

function d(v: DecimalLike, fallback: string | number = 0): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(fallback)
  if (typeof v === 'object' && 'toFixed' in v) return v as Prisma.Decimal
  return new Prisma.Decimal(v as string | number)
}

export function computeAssemblyUnitCost(
  components: AssemblyComponentInput[],
  options?: ComputeAssemblyOptions,
): ComputeAssemblyResult {
  let total = new Prisma.Decimal(0)
  const breakdown: AssemblyBreakdownEntry[] = []
  const projectQty = options?.projectQty == null ? null : d(options.projectQty)
  let toolsSkipped = false

  for (const c of components) {
    let contribution = new Prisma.Decimal(0)

    if (c.kind === 'MATERIAL') {
      const unitPrice = d(c.unitPrice)
      const coverage = d(c.coverage, 1)
      // Defence: divide-by-zero would explode the assembly. Treat zero
      // coverage as "no contribution" rather than throw — the row's label
      // makes the misconfig obvious in the breakdown.
      if (coverage.equals(0)) {
        contribution = new Prisma.Decimal(0)
      } else {
        const coats = c.coats ?? 1
        const wastageFraction = d(c.wastagePct).dividedBy(100)
        contribution = unitPrice
          .dividedBy(coverage)
          .times(coats)
          .times(wastageFraction.plus(1))
      }
    } else if (c.kind === 'LABOR') {
      contribution = d(c.unitPrice)
    } else {
      // TOOL_FIXED
      if (projectQty === null || projectQty.equals(0)) {
        toolsSkipped = true
        contribution = new Prisma.Decimal(0)
      } else {
        contribution = d(c.fixedCost).dividedBy(projectQty)
      }
    }

    total = total.plus(contribution)
    breakdown.push({
      label: c.label ?? c.kind,
      kind: c.kind,
      contribution,
    })
  }

  return { unitCost: total, breakdown, toolsSkipped }
}

/**
 * Sprint-3 reference recipe used by the unit test and the seed.
 *
 * Math (before tools):
 *   primer : 65 / 100        = 0.65 /m²
 *   stucco : 55 /  40 × 2    = 2.75 /m²
 *   paint  : 270 /  50 × 2   = 10.80 /m²
 *   labor  : 6               = 6.00 /m²
 *                              -----
 *                              20.20 AED/m²
 */
export const JOTUN_INTERIOR_PAINT_SYSTEM_A = {
  name: 'Jotun Interior Paint System A',
  appliesTo: 'WALL' as const,
  outputUnit: 'm²',
  components: [
    {
      kind: 'MATERIAL' as const,
      label: 'Primer',
      unitPrice: 65,
      coverage: 100,
      coats: 1,
      wastagePct: 0,
    },
    {
      kind: 'MATERIAL' as const,
      label: 'Stucco',
      unitPrice: 55,
      coverage: 40,
      coats: 2,
      wastagePct: 0,
    },
    {
      kind: 'MATERIAL' as const,
      label: 'Paint top coat',
      unitPrice: 270,
      coverage: 50,
      coats: 2,
      wastagePct: 0,
    },
    {
      kind: 'LABOR' as const,
      label: 'Application labor',
      unitPrice: 6,
    },
    {
      kind: 'TOOL_FIXED' as const,
      label: 'Brushes / rollers / trays',
      fixedCost: 150,
    },
  ],
}
