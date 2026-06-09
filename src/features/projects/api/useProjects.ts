import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { listProjects } from './projects.service'

/** Org-scoped projects list. Disabled until a session (and thus orgId) exists. */
export function useProjects() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''

  return useQuery({
    queryKey: queryKeys.projects.list(organizationId),
    queryFn: () => listProjects(organizationId),
    enabled: organizationId !== '',
  })
}
