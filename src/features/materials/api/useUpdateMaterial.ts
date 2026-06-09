import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type { Material, MaterialInput } from '../domain/material.types'
import { updateMaterial } from './materials.service'

interface UpdateMaterialVars {
  materialId: ID
  input: MaterialInput
}

export function useUpdateMaterial() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Material, Error, UpdateMaterialVars>({
    mutationFn: ({ materialId, input }) => updateMaterial(organizationId, materialId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.materials.all(organizationId) })
    },
  })
}
