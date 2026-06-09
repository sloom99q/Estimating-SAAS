import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type { Project, ProjectInput } from '../domain/project.types'
import { updateProject } from './projects.service'

interface UpdateProjectVars {
  projectId: ID
  input: ProjectInput
}

export function useUpdateProject() {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<Project, Error, UpdateProjectVars>({
    mutationFn: ({ projectId, input }) => updateProject(organizationId, projectId, input),
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all(organizationId) })
      qc.setQueryData(queryKeys.projects.detail(organizationId, project.id), project)
    },
  })
}
