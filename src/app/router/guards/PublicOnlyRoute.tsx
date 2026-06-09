import { Navigate, Outlet } from 'react-router'
import { useIsAuthenticated } from '@/shared/store/sessionStore'
import { paths } from '../paths'

/** Gate for auth pages (login). Authenticated users are bounced to the app. */
export function PublicOnlyRoute() {
  const isAuthenticated = useIsAuthenticated()

  if (isAuthenticated) {
    return <Navigate to={paths.dashboard} replace />
  }
  return <Outlet />
}
