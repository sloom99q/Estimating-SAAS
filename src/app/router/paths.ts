/** Centralized route paths — the single source of truth for navigation. */
export const paths = {
  root: '/',
  login: '/login',
  dashboard: '/dashboard',
  projects: '/projects',
  /** Detail route pattern; use {@link projectPath} to fill in a real id. */
  projectDetail: '/projects/:projectId',
  /** Quotation document route — opens a printable view of the project. */
  projectQuotation: '/projects/:projectId/quotation',
  materials: '/materials',
  /** Material detail / procurement view route pattern. */
  materialDetail: '/materials/:materialId',
  suppliers: '/suppliers',
  users: '/users',
} as const

export type AppPath = (typeof paths)[keyof typeof paths]

/** Build the URL for a specific project workspace. */
export function projectPath(projectId: string): string {
  return `/projects/${projectId}`
}

/** Build the quotation URL for a project. */
export function projectQuotationPath(projectId: string): string {
  return `/projects/${projectId}/quotation`
}

/** Build the URL for a specific material's procurement workspace. */
export function materialPath(materialId: string): string {
  return `/materials/${materialId}`
}
