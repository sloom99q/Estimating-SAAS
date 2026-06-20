/**
 * Read and validate runtime env. Bun loads `.env` automatically; we still
 * sanity-check the required values so the server fails fast at boot rather
 * than 500-ing on the first request.
 *
 * Sprint-9 S9-4 — `.env` is for non-secret config (AI_MODE, DATABASE_URL,
 * model names). Secrets (ANTHROPIC_API_KEY, JWT_SECRET) live in
 * `.env.secrets` which is gitignored and never read/printed/edited by
 * automated sessions. We load it explicitly here so a freshly-cloned dev
 * never has the key in their VCS-tracked file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadSecretsFile(): void {
  const candidate = join(process.cwd(), '.env.secrets')
  if (!existsSync(candidate)) return
  const text = readFileSync(candidate, 'utf-8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx < 0) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    // Don't overwrite values already present in process.env — explicit
    // shell exports win over the file.
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
loadSecretsFile()

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

/**
 * Sprint-3 explicit AI mode (architect review of Sprint 2):
 *
 *   - 'live'  → /v1/messages calls go out. Requires ANTHROPIC_API_KEY.
 *   - 'stub'  → deterministic stub outputs (zero spend). Stamped '-stub' on
 *               promptVersion + meta.stub=true. NEVER allowed in production
 *               unless explicitly opted-in by ALLOW_STUB_IN_PRODUCTION.
 *
 * Default outside production is 'stub'; inside production is 'live'. If the
 * resolved mode is 'live' but the key is missing, the AI client refuses to
 * fire — the job fails loudly. Silent stubbing in production is a SaaS
 * fairness violation (paying customers expect AI work).
 */
const rawAiMode = (process.env.AI_MODE ?? '').toLowerCase()
const aiMode: 'live' | 'stub' =
  rawAiMode === 'live' || rawAiMode === 'stub'
    ? (rawAiMode as 'live' | 'stub')
    : isProduction
    ? 'live'
    : 'stub'

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
  // Anthropic.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  /**
   * Default model. Set via ANTHROPIC_MODEL. Used for any handler that
   * doesn't have a stage-specific override.
   */
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  /**
   * Sprint-8 S8-8 R1 — per-stage model map. CLASSIFY is the cheap routing
   * pass; VISION covers the heavier quadrant work on plan / finish-plan /
   * schedule sheets and the legend pass; DEFAULT is the fallback for
   * anything that hasn't been routed yet. Each falls back to
   * `anthropicModel` when its specific env is unset.
   *
   * Sonnet-vs-Opus A/B (2026-06-20, run-6 BOH KITCHEN + CORRIDOR finish):
   * Opus showed meaningfully better STRUCTURAL reasoning on the kitchen
   * task (recognised L-shape vs U, excluded ramp/skylight zone) but
   * Sonnet was already adequate on the finish task when given a focused
   * crop. Cost ratio Opus:Sonnet ≈ 5.5×. Per-stage overrides for the
   * estimators where geometric reasoning is the bottleneck: KITCHEN +
   * the upcoming JOINERY / WARDROBES default to claude-opus-4-7. Each
   * stage still falls back to ANTHROPIC_MODEL_VISION if explicitly set,
   * keeping the env-driven override path intact for QA.
   */
  anthropicModels: {
    classify: process.env.ANTHROPIC_MODEL_CLASSIFY ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    vision: process.env.ANTHROPIC_MODEL_VISION ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    kitchen:
      process.env.ANTHROPIC_MODEL_KITCHEN ??
      process.env.ANTHROPIC_MODEL_VISION ??
      process.env.ANTHROPIC_MODEL ??
      'claude-opus-4-7',
    joinery:
      process.env.ANTHROPIC_MODEL_JOINERY ??
      process.env.ANTHROPIC_MODEL_VISION ??
      process.env.ANTHROPIC_MODEL ??
      'claude-opus-4-7',
    wardrobes:
      process.env.ANTHROPIC_MODEL_WARDROBES ??
      process.env.ANTHROPIC_MODEL_VISION ??
      process.env.ANTHROPIC_MODEL ??
      'claude-opus-4-7',
    default: process.env.ANTHROPIC_MODEL_DEFAULT ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  },
  aiMode,
  allowStubInProduction: bool('ALLOW_STUB_IN_PRODUCTION', false),
  // Sprint-3 A6: global semaphore around live Anthropic calls. Default 4 keeps
  // us well under the org's per-minute rate limit when several workers run.
  maxConcurrentAiCalls: num('MAX_CONCURRENT_AI_CALLS', 4),
  blobRoot: process.env.BLOB_ROOT ?? './data/blobs',
} as const
