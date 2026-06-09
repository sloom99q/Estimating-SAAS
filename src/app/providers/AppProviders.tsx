import type { ReactNode } from 'react'
import { DbSeedProvider } from './DbSeedProvider'
import { I18nProvider } from './I18nProvider'
import { QueryProvider } from './QueryProvider'
import { ThemeProvider } from './ThemeProvider'

/**
 * Composition root for all cross-cutting providers. Order matters: i18n sets the
 * document direction first, the theme/Mantine layer reads it, Query sits
 * innermost, and the DB seed runs once the session is known.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <QueryProvider>
          <DbSeedProvider>{children}</DbSeedProvider>
        </QueryProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
