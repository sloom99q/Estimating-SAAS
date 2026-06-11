import { config } from './config'
import { startWorker } from './jobs/runner'
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

console.log(
  `[estimator-api] listening on http://${server.hostname}:${server.port}  ·  cors=${config.corsOrigin}`,
)
