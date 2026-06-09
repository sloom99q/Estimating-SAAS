import type { ID, ISODateString } from '@/shared/types'
import type {
  QuotationDocument,
  QuotationMaterialLine,
  QuotationProjectSummary,
  QuotationSpaceLine,
  QuotationTotals,
} from './quotation.types'

/**
 * Minimal shapes the builder needs from the caller. Defined inline to avoid
 * importing types from `projects/` / `spaces/` / `materials/` — which keeps
 * the quotations domain pure and feature-independent (the composition layer
 * in `app/` is the one allowed to know about all three).
 */
export interface BuilderSpaceInput {
  id: ID
  name: string
  length: number
  width: number
  height: number
  floorArea: number
  wallArea: number
  ceilingArea: number
  amount: string
  fullyAssigned: boolean
}

export interface BuilderMaterialInput {
  materialId: ID
  materialName: string
  category: string
  unit: string
  totalArea: number
  quantity: number
  unitPrice: number
  amount: string
}

export interface BuilderCategoryTotal {
  category: string
  amount: string
}

export interface BuildQuotationInput {
  project: QuotationProjectSummary
  /** When the document is being viewed. Defaults to "now" if omitted. */
  issuedAt: ISODateString
  /** Validity window in days; defaults to 30. */
  validForDays?: number
  /** Tax % applied to the subtotal. Defaults to 0. */
  taxRate?: number
  spaces: BuilderSpaceInput[]
  materials: BuilderMaterialInput[]
  categoryTotals: BuilderCategoryTotal[]
  /** Pre-computed grand total from the BOQ engine (decimal string). */
  grandTotal: string
  currency: string
  unassignedSurfaceArea: number
  fullyAssigned: boolean
}

const TWO_DP = 100
function roundTwoDp(value: number): number {
  return Math.round(value * TWO_DP) / TWO_DP
}
function toAmount(value: number): string {
  return roundTwoDp(value).toFixed(2)
}

/**
 * Produce a stable, human-friendly quotation reference. Pure: the same input
 * always yields the same reference, so two callers of `buildQuotation` for the
 * same project on the same day land on the same `Q-…` string.
 */
function buildReference(projectName: string, issuedAt: ISODateString): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  // YYYY-MM from the ISO date — kept short on purpose.
  const ym = issuedAt.slice(0, 7).replace('-', '')
  return `Q-${ym}-${slug || 'project'}`
}

/**
 * Bump an ISO timestamp by `days` while staying pure — no Date.now(), no
 * clock dependency. Used to derive `validUntil` from `issuedAt`.
 */
function addDays(iso: ISODateString, days: number): ISODateString {
  const ms = new Date(iso).getTime() + days * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString()
}

export function buildQuotation(input: BuildQuotationInput): QuotationDocument {
  const issuedAt = input.issuedAt
  const validForDays = input.validForDays ?? 30
  const taxRate = Math.max(0, Math.min(100, input.taxRate ?? 0))

  const subtotalValue = Number(input.grandTotal)
  const taxAmountValue = roundTwoDp((subtotalValue * taxRate) / 100)
  const grandTotalValue = roundTwoDp(subtotalValue + taxAmountValue)

  const totals: QuotationTotals = {
    subtotal: toAmount(subtotalValue),
    taxRate,
    taxAmount: toAmount(taxAmountValue),
    grandTotal: toAmount(grandTotalValue),
    currency: input.currency,
  }

  const spaceLines: QuotationSpaceLine[] = input.spaces.map((space) => ({
    id: space.id,
    name: space.name,
    dimensions: { length: space.length, width: space.width, height: space.height },
    floorArea: roundTwoDp(space.floorArea),
    wallArea: roundTwoDp(space.wallArea),
    ceilingArea: roundTwoDp(space.ceilingArea),
    amount: space.amount,
    fullyAssigned: space.fullyAssigned,
  }))

  const materialLines: QuotationMaterialLine[] = input.materials.map((material) => ({
    materialId: material.materialId,
    materialName: material.materialName,
    category: material.category,
    unit: material.unit,
    totalArea: roundTwoDp(material.totalArea),
    quantity: material.quantity,
    unitPrice: material.unitPrice,
    amount: material.amount,
  }))

  return {
    reference: buildReference(input.project.name, issuedAt),
    issuedAt,
    validUntil: addDays(issuedAt, validForDays),
    project: input.project,
    spaceLines,
    materialLines,
    categoryTotals: input.categoryTotals,
    fullyAssigned: input.fullyAssigned,
    unassignedSurfaceArea: roundTwoDp(input.unassignedSurfaceArea),
    totals,
  }
}
