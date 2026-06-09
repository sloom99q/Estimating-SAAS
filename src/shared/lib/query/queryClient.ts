import { QueryClient } from '@tanstack/react-query'

function isHttp4xx(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status
    return typeof status === 'number' && status >= 400 && status < 500
  }
  return false
}

/**
 * Single source of query policy. TanStack defaults (staleTime 0, retry 3) are
 * wrong for a multi-tenant tool: we don't want every navigation to refetch, and
 * we must never retry non-retryable 4xx errors (401/403/422).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min — reference data changes slowly
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => (isHttp4xx(error) ? false : failureCount < 2),
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})
