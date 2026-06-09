import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type { Space, SpaceInput } from '../domain/space.types'
import { createSpace } from '../api/spaces.service'

export function useCreateSpace(projectId: ID) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Space, Error, SpaceInput>({
    mutationFn: (input) => createSpace(organizationId, projectId, input),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.spaces.all(organizationId, projectId),
      })
    },
  })
}
