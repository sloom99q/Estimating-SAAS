/**
 * Read and validate runtime env. Bun loads `.env` automatically; we still
 * sanity-check the required values so the server fails fast at boot rather
 * than 500-ing on the first request.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw == null) return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  port: num('PORT', 4000),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-rotate-me-before-deploy'),
  jwtTtlSeconds: num('JWT_TTL_SECONDS', 60 * 60 * 12),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  // Postgres-only since Sprint 1. No fallback — if DATABASE_URL is missing
  // the server refuses to boot. Neon DSN is the documented zero-install path
  // (see apps/api/.env.example).
  databaseUrl: required('DATABASE_URL'),
  // Sprint 2 additions.
  isProduction,
  // Test-only routes (POST /api/jobs/_test). Hidden in production unless
  // ENABLE_TEST_ROUTES is explicitly true. Architect review of Sprint 1.
  enableTestRoutes: bool('ENABLE_TEST_ROUTES', !isProduction),
  // Worker reaper: any RUNNING job older than this is considered stuck and
  // gets requeued (or terminal-failed if out of attempts). Default 10 min.
  jobTimeoutMs: num('JOB_TIMEOUT_MS', 10 * 60 * 1000),
  // Anthropic. Empty key triggers the deterministic stub mode used in tests
  // and offline dev — see apps/api/src/ai/anthropic.ts.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  blobRoot: process.env.BLOB_ROOT ?? './data/blobs',
} as const
