import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { Project, ProjectInput } from '../domain/project.types'
import { createProject } from './projects.service'

export function useCreateProject() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Project, Error, ProjectInput>({
    mutationFn: (input) => createProject(organizationId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all(organizationId) })
    },
  })
}
