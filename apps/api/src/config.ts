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

export const config = {
  port: num('PORT', 4000),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-rotate-me-before-deploy'),
  jwtTtlSeconds: num('JWT_TTL_SECONDS', 60 * 60 * 12),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: required('DATABASE_URL', 'file:../data/app.db'),
} as const
