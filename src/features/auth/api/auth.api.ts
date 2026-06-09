import type { Session } from '@/shared/types'
import type { LoginCredentials } from '../domain/auth.types'

const MOCK_PASSWORD = 'estimator'

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

/**
 * Mock auth transport (Phase 1). Returns the exact `Promise<Session>` shape the
 * real backend will, so swapping in a real implementation built on
 * shared/lib/http/client.ts is a one-file change. No React here — pure transport.
 */
export async function login(credentials: LoginCredentials): Promise<Session> {
  await delay(450)

  if (credentials.password !== MOCK_PASSWORD) {
    // The message is an i18n key; the form resolves it for display.
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
    },
    token: 'mock.jwt.token',
    issuedAt: new Date().toISOString(),
  }
}
