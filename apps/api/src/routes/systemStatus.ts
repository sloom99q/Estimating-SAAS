/**
 * P-package P-TOP — system / env status. The SPA's pre-upload banner
 * reads this to show a LOUD, data-driven indicator of:
 *
 *   - the BOOT-RESOLVED AI_MODE (what the running worker will actually
 *     use — never trust the SPA's own .env / build-time guess)
 *   - the AI_MODE on DISK in apps/api/.env (the thing the next restart
 *     would pick up)
 *   - when those two disagree → "restart required" warning
 *
 * The boot-cache trap has now fired twice (S7-5 stub-when-meant-live,
 * S10-walkthrough live-when-meant-stub). This endpoint kills it.
 *
 * Founder-gated because surfacing the on-disk env to anyone else is
 * a needless infra leak.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config'
import { requireAuth } from '../middleware/auth'
import type { Router } from './router'
import { jsonResponse } from '../utils/json'

async function readDiskAiMode(): Promise<string | null> {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'apps/api/.env'),
  ]
  for (const p of candidates) {
    try {
      const text = await fs.readFile(p, 'utf-8')
      const m = text.match(/^\s*AI_MODE\s*=\s*"?([^"\n#]+)"?/m)
      if (m) return m[1]!.trim().toLowerCase()
    } catch {
      // try the next candidate
    }
  }
  return null
}

export function registerSystemStatusRoutes(router: Router): void {
  router.get(
    '/api/system/env-status',
    requireAuth(async (_req, _ctx) => {
      const booted = config.aiMode
      const disk = await readDiskAiMode()
      const restartRequired = disk !== null && disk !== booted
      const m = config.anthropicModels
      const stageValues = Object.values(m)
      const modelsAllSame = stageValues.every((v) => v === stageValues[0])
      return jsonResponse({
        bootedAiMode: booted,
        diskAiMode: disk,
        restartRequired,
        anthropicModel: config.anthropicModel,
        anthropicModels: m,
        anthropicModelSameAcrossStages: modelsAllSame,
        keyPresent: config.anthropicApiKey.length > 0,
      })
    }),
  )
}
