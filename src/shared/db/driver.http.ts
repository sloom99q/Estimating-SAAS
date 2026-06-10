import { env } from '@/shared/config/env'
import { HttpError, httpRequest } from '@/shared/lib/http/client'
import { sessionActions, useSessionStore } from '@/shared/store/sessionStore'
import type { AuditedRow, QueryOptions, Repository } from './driver.types'
import type { RepositoryDescriptor } from './client'

/**
 * HTTP-backed `Repository` implementation. Mirrors the contract of the
 * localStorage driver — feature code never knows which one it's talking to.
 *
 *   - Reads the JWT from `sessionStore`. No prop-drilling, no per-call token
 *     threading.
 *   - On `401` it clears the session so the guard chain bounces the user to
 *     /login; on `404` `findById` resolves to `null` instead of throwing.
 *   - URLs follow the convention `/api/{descriptor.table}`. The same
 *     `descriptor.table` localStorage uses for its key.
 *   - The descriptor's `fromCreate / fromUpdate` callbacks are ignored: the
 *     server is the only place that normalises (trim / null coalesce / etc.),
 *     because a client can never be trusted with that.
 *
 * `where` filters are serialised as flat query params (`?projectId=…`).
 * `includeDeleted` opts back into soft-deleted rows. `orderBy` and `limit` are
 * server-defaulted in Phase 8A.
 */

function currentToken(): string | undefined {
  const token = useSessionStore.getState().session?.token
  return token ?? undefined
}

async function authedRequest<T>(
  path: string,
  init?: Omit<Parameters<typeof httpRequest>[1], 'token'>,
): Promise<T> {
  const token = currentToken()
  try {
    return await httpRequest<T>(path, {
      ...(init ?? {}),
      ...(token ? { token } : {}),
    })
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      // The JWT is gone, expired, or revoked. Drop the session so the route
      // guards reroute the user to the login page.
      sessionActions.clearSession()
    }
    throw error
  }
}

function buildQueryString<T extends AuditedRow>(options: QueryOptions<T>): string {
  const params = new URLSearchParams()
  if (options.where) {
    for (const [key, value] of Object.entries(options.where)) {
      if (value === undefined || value === null) continue
      params.set(key, String(value))
    }
  }
  if (options.includeDeleted === true) params.set('includeDeleted', 'true')
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const qs = params.toString()
  return qs.length === 0 ? '' : `?${qs}`
}

export function createHttpRepository<
  TRow extends AuditedRow,
  TCreate,
  TUpdate = TCreate,
>(descriptor: RepositoryDescriptor<TRow, TCreate, TUpdate>): Repository<TRow, TCreate, TUpdate> {
  if (!env.apiUrl) {
    throw new Error(
      'createHttpRepository requires VITE_API_URL. Configure .env or fall back to the localStorage driver.',
    )
  }

  const basePath = `/api/${descriptor.table}`

  return {
    async list(_organizationId, options = {}) {
      // organizationId is intentionally ignored: the server resolves it from
      // the JWT so a tampered client cannot read another tenant's rows.
      return authedRequest<TRow[]>(`${basePath}${buildQueryString(options)}`, {
        method: 'GET',
      })
    },

    async findById(_organizationId, id, options = {}) {
      const params = new URLSearchParams()
      if (options.includeDeleted) params.set('includeDeleted', 'true')
      const qs = params.toString().length === 0 ? '' : `?${params.toString()}`
      try {
        return await authedRequest<TRow>(`${basePath}/${encodeURIComponent(id)}${qs}`, {
          method: 'GET',
        })
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null
        throw error
      }
    },

    async create(_organizationId, input) {
      return authedRequest<TRow>(basePath, {
        method: 'POST',
        body: JSON.stringify(input),
      })
    },

    async update(_organizationId, id, input) {
      return authedRequest<TRow>(`${basePath}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
    },

    async softDelete(_organizationId, id) {
      await authedRequest<null>(`${basePath}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    },

    async restore(_organizationId, id) {
      await authedRequest<TRow>(`${basePath}/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
  }
}
