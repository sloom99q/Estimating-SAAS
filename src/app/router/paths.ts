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
  /** Takeoff review (Sprint 2). PDF upload + AI extraction review table. */
  projectTakeoff: '/projects/:projectId/takeoff',
  materials: '/materials',
  /** Material detail / procurement view route pattern. */
  materialDetail: '/materials/:materialId',
  suppliers: '/suppliers',
  users: '/users',
  /** Sprint-10 S10-1 — founder-only admin page. */
  adminOrgs: '/admin/orgs',
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

/** Build the takeoff review URL for a project. */
export function projectTakeoffPath(projectId: string): string {
  return `/projects/${projectId}/takeoff`
}

/** Build the URL for a specific material's procurement workspace. */
export function materialPath(materialId: string): string {
  return `/materials/${materialId}`
}
