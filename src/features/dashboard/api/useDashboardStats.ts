import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { fetchDashboardStats } from './dashboard.api'

export function useDashboardStats() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''

  return useQuery({
    queryKey: queryKeys.dashboard.stats(organizationId),
    queryFn: () => fetchDashboardStats(organizationId),
    enabled: organizationId !== '',
  })
}
