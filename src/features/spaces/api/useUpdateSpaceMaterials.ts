import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type { Space, SpaceMaterialsInput } from '../domain/space.types'
import { updateSpaceMaterials } from './spaces.service'

interface UpdateSpaceMaterialsVars {
  spaceId: ID
  input: SpaceMaterialsInput
}

/**
 * Mutation that swaps a space's material assignments without touching its
 * dimensions. Invalidates the project's spaces query so any material-aware
 * derived data (BOQ, totals) recomputes on the next render.
 */
export function useUpdateSpaceMaterials(projectId: ID) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Space, Error, UpdateSpaceMaterialsVars>({
    mutationFn: ({ spaceId, input }) => updateSpaceMaterials(organizationId, spaceId, input),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.spaces.all(organizationId, projectId),
      })
    },
  })
}
