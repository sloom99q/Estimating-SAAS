import { z } from 'zod'
import { prisma } from '../db'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { issueAccessToken, verifyPassword } from '../utils/auth'
import { errorResponse, jsonResponse } from '../utils/json'

const loginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})

/**
 * Build the canonical `Session`-shaped object the SPA expects from
 * `features/auth`. Same field names as the existing mock so the frontend swap
 * is zero-impact at the call site.
 */
function buildSession(opts: {
  token: string
  userId: string
  email: string
  fullName: string
  avatarUrl: string | null
  organizationId: string
  organizationName: string
  role: string
}) {
  return {
    token: opts.token,
    issuedAt: new Date().toISOString(),
    user: {
      id: opts.userId,
      email: opts.email,
      fullName: opts.fullName,
      avatarUrl: opts.avatarUrl,
      organizationId: opts.organizationId,
      organizationName: opts.organizationName,
      role: opts.role,
    },
  }
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/login', async (req) => {
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return errorResponse(400, 'Invalid JSON body')
    }
    const parsed = loginBody.safeParse(raw)
    if (!parsed.success) {
      return errorResponse(400, 'Invalid credentials payload')
    }

    const { email, password } = parsed.data
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { organization: true },
        },
      },
    })
    if (!user) return errorResponse(401, 'auth:errors.invalidCredentials')

    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) return errorResponse(401, 'auth:errors.invalidCredentials')

    // Pick the FIRST active membership for the simple Phase-8A model — single
    // org per user is the common case. The wire shape preserves multi-org for
    // when a real org-picker UI lands.
    const membership = user.memberships[0]
    if (!membership || membership.organization.deletedAt) {
      return errorResponse(403, 'No active organization membership')
    }

    const token = await issueAccessToken({
      sub: user.id,
      oid: membership.organizationId,
      role: membership.role,
    })

    return jsonResponse(
      buildSession({
        token,
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        role: membership.role,
      }),
    )
  })

  router.get(
    '/api/auth/me',
    requireAuth(async (_req, ctx) => {
      return jsonResponse({
        user: {
          id: ctx.user.id,
          email: ctx.user.email,
          fullName: ctx.user.fullName,
          avatarUrl: ctx.user.avatarUrl,
          organizationId: ctx.organizationId,
          organizationName: ctx.organizationName,
          role: ctx.role,
        },
      })
    }),
  )
}
