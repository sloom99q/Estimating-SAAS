import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type { Space, SpaceInput } from '../domain/space.types'
import { updateSpace } from '../api/spaces.service'

interface UpdateSpaceVars {
  spaceId: ID
  input: SpaceInput
}

export function useUpdateSpace(projectId: ID) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Space, Error, UpdateSpaceVars>({
    mutationFn: ({ spaceId, input }) => updateSpace(organizationId, spaceId, input),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.spaces.all(organizationId, projectId),
      })
    },
  })
}
