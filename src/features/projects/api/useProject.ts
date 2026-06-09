import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import { getProject } from './projects.service'

/** Detail query for a single project, org-scoped. */
export function useProject(projectId: ID | undefined) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''

  return useQuery({
    queryKey: queryKeys.projects.detail(organizationId, projectId ?? ''),
    queryFn: () => getProject(organizationId, projectId ?? ''),
    enabled: organizationId !== '' && Boolean(projectId),
  })
}
