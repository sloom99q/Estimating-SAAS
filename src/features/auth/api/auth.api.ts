import { env } from '@/shared/config/env'
import { HttpError, httpRequest } from '@/shared/lib/http/client'
import type { Session } from '@/shared/types'
import type { LoginCredentials } from '../domain/auth.types'

/**
 * Phase-8A transport. When `VITE_API_URL` is set we POST to the real Bun +
 * Prisma + SQLite API; otherwise we keep the Phase-1 mock so offline dev /
 * tests still produce a working session. The return shape (`Session`) is
 * identical in both branches, so the React layer never branches on driver.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function deriveName(email: string): string {
  const local = email.split('@')[0] ?? 'User'
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return name || 'User'
}

const MOCK_PASSWORD = 'estimator'

async function mockLogin(credentials: LoginCredentials): Promise<Session> {
  await delay(400)
  if (credentials.password !== MOCK_PASSWORD) {
    throw new Error('auth:errors.invalidCredentials')
  }
  return {
    user: {
      id: 'usr_demo_owner',
      organizationId: 'org_demo',
      organizationName: 'Aurora Fit-Out Co.',
      email: credentials.email,
      fullName: deriveName(credentials.email),
      role: 'owner',
      avatarUrl: null,
      platformRole: null,
    },
    token: 'mock.jwt.token',
    issuedAt: new Date().toISOString(),
  }
}

/**
 * Production login path — hits `/api/auth/login` on the Bun API and yields
 * the same `Session` shape the rest of the SPA already consumes.
 *
 * A `401` from the server is translated to the SAME i18n key the mock has
 * always used (`auth:errors.invalidCredentials`) so the login form's existing
 * Alert wiring keeps working unchanged.
 */
async function httpLogin(credentials: LoginCredentials): Promise<Session> {
  try {
    return await httpRequest<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    })
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      throw new Error('auth:errors.invalidCredentials', { cause: error })
    }
    throw error
  }
}

export async function login(credentials: LoginCredentials): Promise<Session> {
  return env.apiUrl ? httpLogin(credentials) : mockLogin(credentials)
}
