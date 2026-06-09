/** App-wide constants. No logic, no imports — safe to use anywhere. */

export const SUPPORTED_LANGUAGES = ['en', 'ar'] as const
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: AppLanguage = 'en'

/** Languages that render right-to-left. */
export const RTL_LANGUAGES: readonly AppLanguage[] = ['ar']

/** i18n namespaces, one per feature (lazy-loadable later). */
export const I18N_NAMESPACES = [
  'common',
  'auth',
  'dashboard',
  'users',
  'projects',
  'spaces',
  'materials',
  'quotations',
] as const

/** localStorage keys. Must match index.html's pre-paint bootstrap script. */
export const STORAGE_KEYS = {
  language: 'i18nextLng', // owned by i18next-browser-languagedetector
  colorScheme: 'estimator-color-scheme', // owned by Mantine's color-scheme manager
  session: 'estimator-session', // owned by the session store
} as const

/** Default tenant currency until a per-organization setting is wired up. */
export const DEFAULT_CURRENCY = 'AED'

export function isRtlLanguage(language: string): boolean {
  return (RTL_LANGUAGES as readonly string[]).includes(language)
}
