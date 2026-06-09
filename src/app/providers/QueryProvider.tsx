import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { queryClient } from '@/shared/lib/query/queryClient'

// Dev-only, lazily loaded so it is tree-shaken out of production bundles.
// `import.meta.env.DEV` is statically replaced, so the dynamic import is removed
// entirely when building for production.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })),
    )
  : null

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {ReactQueryDevtools ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  )
}
