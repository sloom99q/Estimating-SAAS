import type { ID, ISODateString } from './common.types'

/**
 * Identity & access contract. This is the cross-cutting *session* shape that
 * the whole app reads. It lives in `shared/types` (not in the auth feature) so
 * that any feature or guard can depend on the type without importing the auth
 * slice — keeping vertical slices isolated.
 */

export type Role = 'owner' | 'admin' | 'estimator' | 'viewer'

export type Permission =
  | 'users:read'
  | 'users:write'
  | 'estimates:read'
  | 'estimates:write'
  | 'materials:read'
  | 'materials:write'
  | 'settings:write'

export interface AuthUser {
  id: ID
  organizationId: ID
  organizationName: string
  email: string
  fullName: string
  role: Role
  avatarUrl: string | null
}

export interface Session {
  user: AuthUser
  /** Opaque bearer token. In Phase 1 this is a mock value. */
  token: string
  issuedAt: ISODateString
}
