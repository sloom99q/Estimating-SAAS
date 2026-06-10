import { config } from './config'
import { registerAuthRoutes } from './routes/auth'
import { registerMaterialRoutes } from './routes/materials'
import { registerPriceRoutes } from './routes/prices'
import { registerProjectRoutes } from './routes/projects'
import { Router } from './routes/router'
import { registerSpaceRoutes } from './routes/spaces'
import { registerSupplierRoutes } from './routes/suppliers'
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

router.get('/health', () =>
  jsonResponse({ ok: true, name: 'estimator-api', version: '0.1.0' }),
)

const server = Bun.serve({
  port: config.port,
  fetch: (req) => router.handle(req),
})

console.log(
  `[estimator-api] listening on http://${server.hostname}:${server.port}  ·  cors=${config.corsOrigin}`,
)
