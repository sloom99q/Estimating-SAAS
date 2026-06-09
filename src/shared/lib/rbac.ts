import type { Permission, Role } from '../types/identity.types'

/**
 * Role → permission policy. Kept here (shared) rather than in the auth feature
 * so any slice can run a permission check via {@link hasPermission} / `useCan`
 * without importing auth. Mirrors the RBAC tables in the reference DB schema.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    'users:read',
    'users:write',
    'estimates:read',
    'estimates:write',
    'materials:read',
    'materials:write',
    'settings:write',
  ],
  admin: [
    'users:read',
    'users:write',
    'estimates:read',
    'estimates:write',
    'materials:read',
    'materials:write',
    'settings:write',
  ],
  estimator: ['users:read', 'estimates:read', 'estimates:write', 'materials:read'],
  viewer: ['users:read', 'estimates:read', 'materials:read'],
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
