import { useEffect, type ReactNode } from 'react'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { runSeedIfEmpty } from '../db/seed'

/**
 * Runs the central seed script the first time we know which organization to
 * scope rows to. Idempotent: `runSeedIfEmpty` is a no-op once the tables hold
 * any row for that org. Lives in `app/providers/` so the seed entry point is
 * mounted exactly once at boot, never inside a feature.
 */
export function DbSeedProvider({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? null

  useEffect(() => {
    if (!organizationId) return
    runSeedIfEmpty(organizationId)
  }, [organizationId])

  return <>{children}</>
}
