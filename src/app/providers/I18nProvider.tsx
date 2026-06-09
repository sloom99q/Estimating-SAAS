import { useEffect } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { ReactNode } from 'react'
import i18n from '@/shared/lib/i18n/i18n'

/**
 * Hosts the i18next instance and keeps the document's `dir`/`lang` attributes
 * in sync with the active language. i18next's own `dir()` resolves Arabic → rtl,
 * so this is the single place that decides direction; Mantine follows the `dir`
 * attribute automatically.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const apply = (lng: string) => {
      document.documentElement.lang = lng
      document.documentElement.dir = i18n.dir(lng)
    }

    apply(i18n.resolvedLanguage ?? i18n.language ?? 'en')
    i18n.on('languageChanged', apply)
    return () => {
      i18n.off('languageChanged', apply)
    }
  }, [])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
