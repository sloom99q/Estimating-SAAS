import { corsPreflight, errorResponse } from '../utils/json'

/**
 * Minimal pattern-based router. No third-party deps; just enough to support
 * `:param` segments and method-scoped handlers. Each route declares the method
 * + path pattern + handler; on each request we walk the table once and
 * dispatch the first match.
 */
export interface RouteContext {
  params: Record<string, string>
  /** Parsed query string. */
  query: URLSearchParams
}

export type Handler = (req: Request, ctx: RouteContext) => Promise<Response> | Response

interface Route {
  method: string
  pattern: RegExp
  paramNames: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  add(method: string, pattern: string, handler: Handler): void {
    const paramNames: string[] = []
    const regexBody = pattern
      .replace(/\/$/, '')
      .replace(/:(\w+)/g, (_match, name: string) => {
        paramNames.push(name)
        return '([^/]+)'
      })
    this.routes.push({
      method,
      pattern: new RegExp(`^${regexBody}/?$`),
      paramNames,
      handler,
    })
  }

  get(pattern: string, handler: Handler): void { this.add('GET', pattern, handler) }
  post(pattern: string, handler: Handler): void { this.add('POST', pattern, handler) }
  patch(pattern: string, handler: Handler): void { this.add('PATCH', pattern, handler) }
  del(pattern: string, handler: Handler): void { this.add('DELETE', pattern, handler) }

  async handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return corsPreflight()

    const url = new URL(req.url)
    for (const route of this.routes) {
      if (route.method !== req.method) continue
      const match = url.pathname.match(route.pattern)
      if (!match) continue
      const params: Record<string, string> = {}
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? '')
      })
      try {
        return await route.handler(req, { params, query: url.searchParams })
      } catch (error) {
        console.error('Route handler failed:', error)
        return errorResponse(500, 'Internal server error')
      }
    }
    return errorResponse(404, 'Not found')
  }
}
