import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { listSuppliers } from './suppliers.service'

export function useSuppliers() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''

  return useQuery({
    queryKey: queryKeys.suppliers.list(organizationId),
    queryFn: () => listSuppliers(organizationId),
    enabled: organizationId !== '',
  })
}
