import { Navigate, Outlet, useLocation } from 'react-router'
import { useIsAuthenticated } from '@/shared/store/sessionStore'
import { paths } from '../paths'

/** Gate for authenticated areas. Redirects to login, preserving the target. */
export function ProtectedRoute() {
  const isAuthenticated = useIsAuthenticated()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to={paths.login} replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
