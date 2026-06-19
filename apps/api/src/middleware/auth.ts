import { prisma } from '../db'
import type { Handler, RouteContext } from '../routes/router'
import { verifyAccessToken, type AccessTokenPayload } from '../utils/auth'
import { errorResponse } from '../utils/json'

/**
 * Resolved auth context attached to every authenticated request. Everything
 * downstream calls `ctx.user.organizationId` instead of trusting client input,
 * which is how cross-tenant access is structurally prevented.
 */
export interface AuthContext extends RouteContext {
  user: {
    id: string
    email: string
    fullName: string
    avatarUrl: string | null
  }
  organizationId: string
  organizationName: string
  role: string
}

export type AuthedHandler = (req: Request, ctx: AuthContext) => Promise<Response> | Response

function readBearer(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token.trim() || null
}

/**
 * Wraps an `AuthedHandler` so the router can register it as a normal `Handler`.
 * Resolves the JWT → user → membership chain, refusing the request if anything
 * is missing or soft-deleted.
 */
export function requireAuth(handler: AuthedHandler): Handler {
  return async (req, ctx) => {
    const token = readBearer(req)
    if (!token) return errorResponse(401, 'Missing access token')

    const payload: AccessTokenPayload | null = await verifyAccessToken(token)
    if (!payload) return errorResponse(401, 'Invalid or expired access token')

    const membership = await prisma.membership.findFirst({
      where: {
        userId: payload.sub,
        organizationId: payload.oid,
        status: 'active',
      },
      include: {
        user: true,
        organization: true,
      },
    })
    if (!membership || membership.user.deletedAt || membership.organization.deletedAt) {
      return errorResponse(401, 'Membership is no longer valid')
    }

    const authCtx: AuthContext = {
      ...ctx,
      user: {
        id: membership.user.id,
        email: membership.user.email,
        fullName: membership.user.fullName,
        avatarUrl: membership.user.avatarUrl,
      },
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
    }

    return handler(req, authCtx)
  }
}

/**
 * Sprint-10 S10-1 — founder-only gate. Wraps a normal handler with an
 * extra check that the bearer user's `platformRole === 'founder'`.
 * Per ADR-018 these handlers may LIST orgs and PROVISION new ones; they
 * may NOT read tenant business data (projects, takeoff items, BOQs).
 * Route authors keep that contract by writing each handler narrowly.
 */
export function requireFounder(handler: AuthedHandler): Handler {
  return requireAuth(async (req, ctx) => {
    const dbUser = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { platformRole: true, deletedAt: true },
    })
    if (!dbUser || dbUser.deletedAt) return errorResponse(401, 'User not found')
    if (dbUser.platformRole !== 'founder') {
      return errorResponse(403, 'Founder access required')
    }
    return handler(req, ctx)
  })
}
