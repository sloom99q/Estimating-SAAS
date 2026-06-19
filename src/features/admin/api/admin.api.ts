/**
 * Sprint-10 S10-1 — founder admin API surface. Keeps to the ADR-018
 * contract: list orgs (counts only) + provision new org + owner.
 */
import { HttpError, httpRequest } from '@/shared/lib/http/client'
import { sessionActions, useSessionStore } from '@/shared/store/sessionStore'

export interface AdminOrgSummary {
  id: string
  name: string
  slug: string
  createdAt: string
  memberCount: number
  projectCount: number
  documentCount: number
}

export interface CreateOrgPayload {
  name: string
  slug: string
  ownerEmail: string
  ownerFullName: string
  ownerInitialPassword: string
}

export interface CreateOrgResult {
  organization: { id: string; slug: string; name: string }
  owner: { id: string; email: string; fullName: string; createdAccount: boolean }
}

function currentToken(): string | undefined {
  return useSessionStore.getState().session?.token
}

async function withAuth<T>(
  path: string,
  init?: Omit<Parameters<typeof httpRequest>[1], 'token'>,
): Promise<T> {
  const token = currentToken()
  try {
    return await httpRequest<T>(path, { ...(init ?? {}), ...(token ? { token } : {}) })
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) sessionActions.clearSession()
    throw err
  }
}

export async function listOrganizations(): Promise<AdminOrgSummary[]> {
  const body = await withAuth<{ organizations: AdminOrgSummary[] }>('/api/admin/orgs')
  return body.organizations
}

export async function createOrganization(payload: CreateOrgPayload): Promise<CreateOrgResult> {
  return withAuth<CreateOrgResult>('/api/admin/orgs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
