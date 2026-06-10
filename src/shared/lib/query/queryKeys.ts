import type { ID } from '../../types/common.types'

/**
 * Org-scoped query-key factory. Every server cache key is namespaced by
 * organization id (`['org', orgId, ...]`) so that, in a shared-database
 * multi-tenant SAAS, cache from one tenant can never bleed into another. Feature
 * query hooks build keys *only* through this factory — they cannot forget the
 * tenant scope.
 */
export const queryKeys = {
  users: {
    all: (orgId: ID) => ['org', orgId, 'users'] as const,
    list: (orgId: ID, params: Record<string, unknown> = {}) =>
      ['org', orgId, 'users', 'list', params] as const,
    detail: (orgId: ID, userId: ID) => ['org', orgId, 'users', 'detail', userId] as const,
  },
  dashboard: {
    stats: (orgId: ID) => ['org', orgId, 'dashboard', 'stats'] as const,
  },
  projects: {
    all: (orgId: ID) => ['org', orgId, 'projects'] as const,
    list: (orgId: ID, params: Record<string, unknown> = {}) =>
      ['org', orgId, 'projects', 'list', params] as const,
    detail: (orgId: ID, projectId: ID) =>
      ['org', orgId, 'projects', 'detail', projectId] as const,
  },
  spaces: {
    all: (orgId: ID, projectId: ID) =>
      ['org', orgId, 'projects', 'detail', projectId, 'spaces'] as const,
    list: (orgId: ID, projectId: ID) =>
      ['org', orgId, 'projects', 'detail', projectId, 'spaces', 'list'] as const,
  },
  materials: {
    all: (orgId: ID) => ['org', orgId, 'materials'] as const,
    list: (orgId: ID, params: Record<string, unknown> = {}) =>
      ['org', orgId, 'materials', 'list', params] as const,
    detail: (orgId: ID, materialId: ID) =>
      ['org', orgId, 'materials', 'detail', materialId] as const,
  },
  suppliers: {
    all: (orgId: ID) => ['org', orgId, 'suppliers'] as const,
    list: (orgId: ID, params: Record<string, unknown> = {}) =>
      ['org', orgId, 'suppliers', 'list', params] as const,
    detail: (orgId: ID, supplierId: ID) =>
      ['org', orgId, 'suppliers', 'detail', supplierId] as const,
  },
  prices: {
    forMaterial: (orgId: ID, materialId: ID) =>
      ['org', orgId, 'materials', 'detail', materialId, 'prices'] as const,
  },
  priceHistory: {
    forMaterial: (orgId: ID, materialId: ID, params: Record<string, unknown> = {}) =>
      ['org', orgId, 'materials', 'detail', materialId, 'price-history', params] as const,
  },
} as const
