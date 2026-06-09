import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import { listSpaces } from './spaces.service'

export function useSpaces(projectId: ID | undefined) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''

  return useQuery({
    queryKey: queryKeys.spaces.list(organizationId, projectId ?? ''),
    queryFn: () => listSpaces(organizationId, projectId ?? ''),
    enabled: organizationId !== '' && Boolean(projectId),
  })
}
