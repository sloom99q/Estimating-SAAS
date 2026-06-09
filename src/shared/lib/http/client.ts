import { env } from '../../config/env'

/**
 * Thin HTTP core — the single seam the real backend (Phase 2) plugs into.
 * It stays deliberately small: auth header, tenant header, JSON, error
 * normalization, and *per-request overrides* (timeout, baseUrl, signal). Each
 * feature composes its own service on top; this core never knows about features
 * or AI. Not used in Phase 1 (mock services), but its shape is load-bearing.
 */
export interface RequestOptions extends RequestInit {
  /** Override the base URL (e.g. a long-running AI service). */
  baseUrl?: string
  /** Per-request timeout in ms. `0` disables it (datasheet uploads / streaming). */
  timeoutMs?: number
  /** Tenant scoping header. */
  orgId?: string
  /** Bearer token. */
  token?: string
}

export class HttpError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

const DEFAULT_TIMEOUT_MS = 20_000

export async function httpRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, orgId, token, headers, signal, ...init } = options

  const controller = new AbortController()
  const timeout =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined

  try {
    const response = await fetch(`${baseUrl ?? env.apiUrl}${path}`, {
      ...init,
      signal: signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    })

    const body: unknown =
      response.status === 204 ? null : await response.json().catch(() => null)

    if (!response.ok) {
      throw new HttpError(response.status, `Request failed with status ${response.status}`, body)
    }

    return body as T
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
