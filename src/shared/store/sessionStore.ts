import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '../config/constants'
import { hasPermission } from '../lib/rbac'
import type { Permission, Session } from '../types/identity.types'

/**
 * Cross-cutting session/identity state. Lives in shared (not the auth feature)
 * because the whole app reads it. The auth feature *writes* it via the login
 * mutation; guards, layout and other features only *read* it.
 *
 * Only the raw `session` is persisted — derived flags (isAuthenticated,
 * permissions) are computed by selectors so they can never desync on rehydrate.
 */
interface SessionState {
  session: Session | null
  setSession: (session: Session) => void
  clearSession: () => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      clearSession: () => set({ session: null }),
    }),
    {
      name: STORAGE_KEYS.session,
      partialize: (state) => ({ session: state.session }),
    },
  ),
)

/* ---- Atomic selector hooks (subscribe to the smallest slice possible) ---- */

export const useSession = (): Session | null => useSessionStore((s) => s.session)

export const useCurrentUser = () => useSessionStore((s) => s.session?.user ?? null)

export const useIsAuthenticated = (): boolean => useSessionStore((s) => s.session !== null)

export function useCan(permission: Permission): boolean {
  return useSessionStore((s) =>
    s.session ? hasPermission(s.session.user.role, permission) : false,
  )
}

/** Imperative access for non-component code (e.g. the auth mutation callback). */
export const sessionActions = {
  setSession: (session: Session) => useSessionStore.getState().setSession(session),
  clearSession: () => useSessionStore.getState().clearSession(),
}
