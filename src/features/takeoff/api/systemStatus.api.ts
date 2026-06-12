/**
 * P-package P-TOP — fetch the API's runtime mode for the pre-upload
 * banner. Tells the SPA what the running worker WILL use (not what
 * the SPA's own build-time env thinks).
 */
import { HttpError, httpRequest } from '@/shared/lib/http/client'
import { sessionActions, useSessionStore } from '@/shared/store/sessionStore'

export interface EnvStatus {
  bootedAiMode: 'live' | 'stub'
  diskAiMode: 'live' | 'stub' | null
  restartRequired: boolean
  anthropicModel: string
  anthropicModels: { classify: string; vision: string; default: string }
  anthropicModelSameAcrossStages: boolean
  keyPresent: boolean
}

function currentToken(): string | undefined {
  return useSessionStore.getState().session?.token
}

export async function fetchEnvStatus(): Promise<EnvStatus> {
  const token = currentToken()
  try {
    return await httpRequest<EnvStatus>('/api/system/env-status', {
      ...(token ? { token } : {}),
    })
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) sessionActions.clearSession()
    throw err
  }
}
