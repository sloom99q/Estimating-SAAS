/**
 * Sprint-10 PB-3 — single helper for "raise this validation flag exactly
 * once". Keyed on (projectId, rule, takeoffItemId-OR-message), so the
 * SPRINT10 double-chain pattern (two parallel handlers each raising the
 * same FINISH_UNMAPPED on the same room) collapses to a single flag.
 *
 * Subject:
 *   - row-level flag (takeoffItemId != null): subject = takeoffItemId
 *     (message is mutable — vision phrasing varies per run, that must not
 *     create a new flag)
 *   - project-level flag (takeoffItemId == null): subject = message
 *     (multiple distinct project-level findings of the same rule are
 *     legitimate; we dedupe on exact message text)
 *
 * Race tolerance: we still findFirst + create at the application layer
 * (no partial-unique constraint on the schema today). The chainGuard's
 * PB-3 fix means only one pipeline writes for a given document at a
 * time, so the residual race is small. If the residual ever bites, a
 * migration adds a unique index on (organizationId, projectId, rule,
 * subject_hash) — left as a follow-up.
 */
import type { PrismaClient, ValidationSeverity } from '@prisma/client'

export interface UpsertValidationFlagArgs {
  client: Pick<PrismaClient, 'validationFlag'>
  organizationId: string
  projectId: string
  takeoffItemId?: string | null
  rule: string
  severity: ValidationSeverity
  message: string
}

export interface UpsertValidationFlagResult {
  id: string
  created: boolean
}

export async function upsertValidationFlag(
  args: UpsertValidationFlagArgs,
): Promise<UpsertValidationFlagResult> {
  const takeoffItemId = args.takeoffItemId ?? null
  const existing = await args.client.validationFlag.findFirst({
    where: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      rule: args.rule,
      takeoffItemId,
      // For project-level flags we additionally dedupe on the message
      // text — distinct project-level findings of the same rule (e.g.
      // multiple LEGEND_SANITY runs flagging different code counts)
      // remain separate.
      ...(takeoffItemId === null ? { message: args.message } : {}),
      resolved: false,
    },
    select: { id: true, severity: true, message: true },
  })
  if (existing) {
    if (existing.severity !== args.severity || existing.message !== args.message) {
      await args.client.validationFlag.update({
        where: { id: existing.id },
        data: { severity: args.severity, message: args.message },
      })
    }
    return { id: existing.id, created: false }
  }
  const created = await args.client.validationFlag.create({
    data: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      takeoffItemId,
      rule: args.rule,
      severity: args.severity,
      message: args.message,
    },
  })
  return { id: created.id, created: true }
}
