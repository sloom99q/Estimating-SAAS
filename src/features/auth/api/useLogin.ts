import { useMutation } from '@tanstack/react-query'
import { sessionActions } from '@/shared/store/sessionStore'
import type { Session } from '@/shared/types'
import type { LoginCredentials } from '../domain/auth.types'
import { login } from './auth.api'

/** Login mutation. On success it writes the session into the shared store. */
export function useLogin() {
  return useMutation<Session, Error, LoginCredentials>({
    mutationFn: login,
    onSuccess: (session) => {
      sessionActions.setSession(session)
    },
  })
}
