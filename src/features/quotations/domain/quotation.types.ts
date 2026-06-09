import type { CurrencyCode, ID, ISODateString } from '@/shared/types'

/**
 * Phase-7 quotation contract. Mirrors the wire shape future-Phase-8 invoicing
 * will produce, so the in-memory document can be ported directly to a real
 * `Quotation` row from `prisma/schema.prisma` without UI rewiring.
 *
 * Everything in this module is pure (no react / mantine). The composition
 * layer (app/) and the QuotationPage in this feature both call into the
 * `buildQuotation` factory to derive the same document shape.
 */

export interface QuotationProjectSummary {
  id: ID
  name: string
  clientName: string
  location: string
  type: 'residential' | 'commercial' | 'luxury'
  status: string
}

/** Per-space line on the spaces breakdown table. */
export interface QuotationSpaceLine {
  id: ID
  name: string
  dimensions: { length: number; width: number; height: number }
  floorArea: number
  wallArea: number
  ceilingArea: number
  /** Pre-formatted decimal string in `currency`. */
  amount: string
  fullyAssigned: boolean
}

/** Per-material line on the materials breakdown table (BOQ summary). */
export interface QuotationMaterialLine {
  materialId: ID
  materialName: string
  category: string
  unit: string
  totalArea: number
  quantity: number
  unitPrice: number
  /** Pre-formatted decimal string in `currency`. */
  amount: string
}

export interface QuotationCategoryTotal {
  category: string
  /** Pre-formatted decimal string in `currency`. */
  amount: string
}

export interface QuotationTotals {
  subtotal: string
  /** Tax % applied — Phase 7 leaves this at 0 unless an org-level setting wires in. */
  taxRate: number
  taxAmount: string
  /** Final billable amount; `subtotal + taxAmount`. */
  grandTotal: string
  currency: CurrencyCode
}

export interface QuotationDocument {
  /** Human-friendly quotation reference, e.g. `Q-2026-marina`. */
  reference: string
  /** ISO timestamp the document was generated. */
  issuedAt: ISODateString
  /** Validity window — UI suggestion only; not yet wired into the timeline. */
  validUntil: ISODateString
  project: QuotationProjectSummary
  spaceLines: QuotationSpaceLine[]
  materialLines: QuotationMaterialLine[]
  categoryTotals: QuotationCategoryTotal[]
  /** True iff every surface across every space is backed by a Material. */
  fullyAssigned: boolean
  /** Surface area still costed against placeholder default rates (m²). */
  unassignedSurfaceArea: number
  totals: QuotationTotals
}
