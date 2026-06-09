import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { fetchUsers } from './users.api'

/** Org-scoped users query. Disabled until a session (and thus orgId) exists. */
export function useUsers() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''

  return useQuery({
    queryKey: queryKeys.users.list(organizationId),
    queryFn: () => fetchUsers(organizationId),
    enabled: organizationId !== '',
  })
}
