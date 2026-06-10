import { config } from '../config'

/**
 * Common CORS headers — shared by every JSON response. The SPA dev origin is
 * loaded from `CORS_ORIGIN`; deploys override it.
 */
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Org-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status, headers: corsHeaders() })
}

export function errorResponse(status: number, message: string, details?: unknown): Response {
  return jsonResponse({ error: message, ...(details ? { details } : {}) }, status)
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
