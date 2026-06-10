import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import { deleteSupplier } from './suppliers.service'

export function useDeleteSupplier() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<void, Error, ID>({
    mutationFn: (supplierId) => deleteSupplier(organizationId, supplierId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.suppliers.all(organizationId) })
    },
  })
}
