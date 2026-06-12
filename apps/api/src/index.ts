import { config } from './config'
import { startWorker } from './jobs/runner'
import { registerAdminRoutes } from './routes/admin'
import { registerAssemblyRoutes } from './routes/assemblies'
import { registerAuthRoutes } from './routes/auth'
import { registerBoqRoutes } from './routes/boq'
import { registerDocumentRoutes } from './routes/documents'
import { registerQuotationRoutes } from './routes/quotations'
import { registerJobRoutes } from './routes/jobs'
import { registerMaterialRoutes } from './routes/materials'
import { registerPriceRoutes } from './routes/prices'
import { registerProjectRoutes } from './routes/projects'
import { Router } from './routes/router'
import { registerSpaceRoutes } from './routes/spaces'
import { registerSystemStatusRoutes } from './routes/systemStatus'
import { registerSupplierRoutes } from './routes/suppliers'
import { registerTakeoffRoutes } from './routes/takeoff'
import { registerUserRoutes } from './routes/users'
import { jsonResponse } from './utils/json'

const router = new Router()
registerAuthRoutes(router)
registerProjectRoutes(router)
registerSpaceRoutes(router)
registerMaterialRoutes(router)
registerSupplierRoutes(router)
registerPriceRoutes(router)
registerUserRoutes(router)
registerJobRoutes(router)
registerDocumentRoutes(router)
registerTakeoffRoutes(router)
registerAssemblyRoutes(router)
registerBoqRoutes(router)
registerQuotationRoutes(router)
registerAdminRoutes(router)
registerSystemStatusRoutes(router)

router.get('/health', () =>
  jsonResponse({ ok: true, name: 'estimator-api', version: '0.1.0' }),
)

const server = Bun.serve({
  port: config.port,
  fetch: (req) => router.handle(req),
})

// The background job runner shares this process. Single-writer concurrency
// is safe because we claim via `FOR UPDATE SKIP LOCKED` — extra workers can
// be added later by booting this module without `Bun.serve`.
startWorker()

// Sprint-8 S8-6: log the *resolved* AI_MODE at boot. The S7-5 live run got
// wasted because the .env had AI_MODE=live but the server had been launched
// with AI_MODE=stub — the operator had no way to tell from a quick log
// glance. This line ends that ambiguity.
// S8-8 R1: also surface the per-stage model map so the A/B harness reads
// "vision=claude-opus-4-8" at a glance during a run.
const m = config.anthropicModels
const sameModel = m.classify === m.vision && m.vision === m.default
const aiModeBanner =
  config.aiMode === 'live'
    ? `AI_MODE=live (key=${config.anthropicApiKey ? 'set' : 'MISSING'}, ${
        sameModel
          ? `model=${m.default}`
          : `classify=${m.classify}, vision=${m.vision}, default=${m.default}`
      })`
    : 'AI_MODE=stub (no Anthropic calls; deterministic stub outputs)'
console.log(
  `[estimator-api] listening on http://${server.hostname}:${server.port}  ·  cors=${config.corsOrigin}  ·  ${aiModeBanner}`,
)
