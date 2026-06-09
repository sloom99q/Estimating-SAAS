import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { Material, MaterialInput } from '../domain/material.types'
import { createMaterial } from './materials.service'

export function useCreateMaterial() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Material, Error, MaterialInput>({
    mutationFn: (input) => createMaterial(organizationId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.materials.all(organizationId) })
    },
  })
}
