/**
 * Sprint-10 S10-1 — founder admin routes.
 *
 *   GET  /api/admin/orgs       — list every org with cheap count summaries
 *   POST /api/admin/orgs       — provision a new org + owner invite
 *
 * Per ADR-018 these endpoints only LIST orgs and PROVISION new ones.
 * They never read tenant business data (projects, takeoff items, BOQs).
 * Founders enforce that contract themselves when adding new admin
 * routes — no proxy "get me the takeoff for org X" routes are allowed
 * to live here.
 */
import { z } from 'zod'
import { hashPassword } from '../utils/auth'
import { prisma } from '../db'
import { requireFounder } from '../middleware/auth'
import type { Router } from './router'
import { errorResponse, jsonResponse } from '../utils/json'

const createOrgBody = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, and dashes'),
  ownerEmail: z.string().email(),
  ownerFullName: z.string().min(1),
  ownerInitialPassword: z.string().min(8),
})

export function registerAdminRoutes(router: Router): void {
  /**
   * GET /api/admin/orgs — every organisation in the platform with cheap
   * count summaries. Designed for the /admin/orgs page and the
   * scripts/org-report.ts tree print.
   */
  router.get(
    '/api/admin/orgs',
    requireFounder(async (_req, _ctx) => {
      const orgs = await prisma.organization.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          _count: {
            select: {
              memberships: true,
              projects: true,
              documents: true,
            },
          },
        },
      })
      return jsonResponse({
        organizations: orgs.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          createdAt: o.createdAt.toISOString(),
          memberCount: o._count.memberships,
          projectCount: o._count.projects,
          documentCount: o._count.documents,
        })),
      })
    }),
  )

  /**
   * POST /api/admin/orgs — provision a new org with an owner. Creates
   * Organization, User (or finds existing by email), and an owner
   * Membership. Atomic via $transaction. No tenant-data side effects
   * are introduced here.
   */
  router.post(
    '/api/admin/orgs',
    requireFounder(async (req, _ctx) => {
      let raw: unknown
      try {
        raw = await req.json()
      } catch {
        return errorResponse(400, 'Invalid JSON body')
      }
      const parsed = createOrgBody.safeParse(raw)
      if (!parsed.success) {
        return errorResponse(400, 'Invalid payload', parsed.error.format())
      }
      const { name, slug, ownerEmail, ownerFullName, ownerInitialPassword } = parsed.data
      const existingSlug = await prisma.organization.findUnique({ where: { slug } })
      if (existingSlug) return errorResponse(409, `Organization slug "${slug}" already exists`)

      const passwordHash = await hashPassword(ownerInitialPassword)
      try {
        const result = await prisma.$transaction(async (tx) => {
          const org = await tx.organization.create({
            data: { name, slug },
          })
          // Reuse an existing user with the same email if present (the
          // founder might be moving someone from another org). Otherwise
          // create a fresh account.
          const existingUser = await tx.user.findUnique({
            where: { email: ownerEmail.toLowerCase() },
          })
          const user = existingUser
            ? existingUser
            : await tx.user.create({
                data: {
                  email: ownerEmail.toLowerCase(),
                  fullName: ownerFullName,
                  passwordHash,
                },
              })
          await tx.membership.create({
            data: {
              organizationId: org.id,
              userId: user.id,
              role: 'owner',
              status: 'active',
            },
          })
          return { org, user, createdUser: !existingUser }
        })
        return jsonResponse(
          {
            organization: {
              id: result.org.id,
              slug: result.org.slug,
              name: result.org.name,
            },
            owner: {
              id: result.user.id,
              email: result.user.email,
              fullName: result.user.fullName,
              createdAccount: result.createdUser,
            },
          },
          201,
        )
      } catch (err) {
        return errorResponse(500, 'Failed to provision organization', {
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }),
  )
}
