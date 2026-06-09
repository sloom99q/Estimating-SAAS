import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { listMaterials } from './materials.service'

/** Org-scoped materials list. */
export function useMaterials() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''

  return useQuery({
    queryKey: queryKeys.materials.list(organizationId),
    queryFn: () => listMaterials(organizationId),
    enabled: organizationId !== '',
  })
}
