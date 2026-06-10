import { tenantDb } from '../db/tenantDb'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { jsonResponse } from '../utils/json'

/**
 * Org-scoped members. Shape matches the existing `OrgUser` projection in the
 * SPA — same fields + same defaults, so `features/users` swaps to HTTP with
 * zero rendering changes.
 */
export function registerUserRoutes(router: Router): void {
  router.get(
    '/api/users',
    requireAuth(async (_req, ctx) => {
      const db = tenantDb(ctx.organizationId)
      const memberships = await db.membership.findMany({
        include: { user: true },
      })
      const rows = memberships
        .filter((m) => !m.user.deletedAt)
        .map((m) => ({
          id: m.user.id,
          fullName: m.user.fullName,
          email: m.user.email,
          role: m.role,
          status: m.status,
          lastActiveAt: m.joinedAt ? m.joinedAt.toISOString() : null,
          avatarUrl: m.user.avatarUrl,
        }))
      return jsonResponse(rows)
    }),
  )
}
