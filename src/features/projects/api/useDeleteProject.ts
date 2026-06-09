import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import { deleteProject } from './projects.service'

export function useDeleteProject() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<void, Error, ID>({
    mutationFn: (projectId) => deleteProject(organizationId, projectId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all(organizationId) })
    },
  })
}
