import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { Supplier, SupplierInput } from '../domain/supplier.types'
import { createSupplier } from './suppliers.service'

export function useCreateSupplier() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Supplier, Error, SupplierInput>({
    mutationFn: (input) => createSupplier(organizationId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.suppliers.all(organizationId) })
    },
  })
}
