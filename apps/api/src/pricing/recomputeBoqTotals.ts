/**
 * Self-healing BOQ totals.
 *
 * Boq.subtotal and Boq.totalProvisional were maintained as INCREMENTED
 * aggregates: generate, PRICE, addLine, deleteLine, patchLine, and the
 * P/S carry-forward each wrote their own deltas. Over enough mutations
 * the aggregates drifted from the actual BoqLine reality — PRICE could
 * zero psAmount on a line without zeroing the aggregate; delete-line
 * subtracted the line's (already-zeroed) psAmount so the total stayed
 * inflated; carry-forward might re-add what was already there.
 *
 * Symptom the estimator caught: header showed "P/S 1,090,000" while
 * Section 4.0 lines showed amount=0 and deleting them didn't reduce
 * the total. The two were structurally disconnected.
 *
 * Fix: stop maintaining the aggregates. Derive them from the line
 * data on every mutation. Single function, called from every write
 * path. By construction the aggregate equals the sum of the lines.
 *
 * Note: this is fine performance-wise for any realistic BOQ size
 * (~100 lines), one round-trip to read + one round-trip to write.
 */
import { Prisma, PrismaClient } from '@prisma/client'

type Tx =
  | PrismaClient
  | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export interface RecomputedTotals {
  subtotal: Prisma.Decimal
  totalProvisional: Prisma.Decimal
  pricedLineCount: number
  provisionalLineCount: number
}

/**
 * Derive {subtotal, totalProvisional} from the BOQ's actual lines and
 * write them back. Returns the computed values so callers can log
 * deltas if they want.
 *
 *   subtotal         = Σ BoqLine.amount     where !isProvisional
 *   totalProvisional = Σ BoqLine.psAmount   where  isProvisional
 *
 * Lines with NULL amount / psAmount contribute zero. Soft-deleted
 * lines are not included (BoqLine has no deletedAt today; the actual
 * delete path is a hard DELETE).
 */
export async function recomputeBoqTotals(db: Tx, boqId: string): Promise<RecomputedTotals> {
  const lines = await db.boqLine.findMany({
    where: { boqId },
    select: { amount: true, psAmount: true, isProvisional: true },
  })

  let subtotal = new Prisma.Decimal(0)
  let totalProvisional = new Prisma.Decimal(0)
  let pricedLineCount = 0
  let provisionalLineCount = 0
  for (const l of lines) {
    if (l.isProvisional) {
      provisionalLineCount += 1
      if (l.psAmount !== null) totalProvisional = totalProvisional.plus(l.psAmount)
    } else {
      pricedLineCount += 1
      if (l.amount !== null) subtotal = subtotal.plus(l.amount)
    }
  }

  await db.boq.update({
    where: { id: boqId },
    data: { subtotal, totalProvisional },
  })

  return { subtotal, totalProvisional, pricedLineCount, provisionalLineCount }
}
