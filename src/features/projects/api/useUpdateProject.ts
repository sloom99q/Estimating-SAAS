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
      // Sprint-10 S10-0: hard-replace the list cache with the new row in
      // place. Just invalidating worked in practice, but if the refetch
      // raced (network blip, stale snapshot) the user could briefly see
      // two rows — which is exactly the "edit creates a new row" the
      // owner reported. By patching the list cache directly we eliminate
      // the window where the screen has two copies of the same project.
      qc.setQueryData(queryKeys.projects.detail(organizationId, project.id), project)
      qc.setQueriesData<Project[] | undefined>(
        { queryKey: queryKeys.projects.all(organizationId) },
        (current) => {
          if (!Array.isArray(current)) return current
          const seen = new Set<string>()
          const next: Project[] = []
          // Replace the row by id; if for any reason the list didn't
          // contain it (a stale cache miss), prepend it so it's still
          // visible. Dedup by id to guarantee at most one entry per row.
          let replaced = false
          for (const row of current) {
            if (row.id === project.id) {
              if (!seen.has(row.id)) {
                next.push(project)
                seen.add(row.id)
                replaced = true
              }
            } else if (!seen.has(row.id)) {
              next.push(row)
              seen.add(row.id)
            }
          }
          if (!replaced && !seen.has(project.id)) next.unshift(project)
          return next
        },
      )
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all(organizationId) })
    },
  })
}
