import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type { Supplier, SupplierInput } from '../domain/supplier.types'
import { updateSupplier } from './suppliers.service'

interface UpdateSupplierVars {
  supplierId: ID
  input: SupplierInput
}

export function useUpdateSupplier() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Supplier, Error, UpdateSupplierVars>({
    mutationFn: ({ supplierId, input }) => updateSupplier(organizationId, supplierId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.suppliers.all(organizationId) })
    },
  })
}
