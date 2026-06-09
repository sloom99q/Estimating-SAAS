import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import { deleteMaterial } from './materials.service'

export function useDeleteMaterial() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<void, Error, ID>({
    mutationFn: (materialId) => deleteMaterial(organizationId, materialId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.materials.all(organizationId) })
    },
  })
}
