/**
 * Typed, validated access to build-time env. Centralizing it here means no
 * feature reads `import.meta.env` directly, and the mock-vs-real backend switch
 * lives in one place.
 */
const apiUrl = (import.meta.env.VITE_API_URL ?? '').trim()

export const env = {
  /** Base URL of the backend API. Empty string in Phase 1. */
  apiUrl,
  /** Display name of the app. */
  appName: import.meta.env.VITE_APP_NAME?.trim() || 'Estimator',
  /** True when no API URL is configured → use in-memory mock services. */
  useMockServices: apiUrl === '',
  /** Vite dev flag. */
  isDev: import.meta.env.DEV,
} as const
