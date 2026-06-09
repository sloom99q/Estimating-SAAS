import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import { deleteSpace } from '../api/spaces.service'

export function useDeleteSpace(projectId: ID) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<void, Error, ID>({
    mutationFn: (spaceId) => deleteSpace(organizationId, spaceId),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.spaces.all(organizationId, projectId),
      })
    },
  })
}
