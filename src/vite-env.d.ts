/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API. Empty in Phase 1 (mock services). */
  readonly VITE_API_URL: string
  /** Display name of the application. */
  readonly VITE_APP_NAME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
