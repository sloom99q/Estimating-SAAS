import { prisma } from '../db'

/**
 * Models whose rows are owned by a tenant (`organizationId`). The Prisma
 * extension below injects `organizationId` into every read / write filter
 * for these models, so application code physically cannot forget the scope.
 *
 * IMPORTANT — NESTED WRITES ARE BANNED ON TENANT MODELS:
 *
 *   await db.project.update({
 *     where: { id },
 *     data: {
 *       spaces: { create: [{ name, length, width, height }] }, // ❌ BAD
 *     },
 *   })
 *
 * Prisma's `data.<relation>.create` shortcut bypasses this extension —
 * the child row's `organizationId` would be left to fall back to the parent
 * relation, and a maliciously-crafted parent id could lead to cross-tenant
 * writes. (Architect review of Sprint 1.)
 *
 * Instead, use explicit per-model calls in a transaction:
 *
 *   await db.$transaction([
 *     db.project.update({ where: { id }, data: { ... } }),
 *     db.space.createMany({ data: [{ projectId: id, name, ... }] }),
 *   ])
 *
 * The example pattern in projects.ts (the cascade on delete) is the model to
 * follow for all multi-row writes on tenant models.
 *
 * Notes:
 *  - `User` is NOT here. Users are platform-wide (one person can belong to
 *    multiple orgs via `Membership`). Tenant scope on users is enforced
 *    indirectly through the `Membership` row resolved at auth time.
 *  - `Organization` is NOT here either — orgs are looked up by id during
 *    auth and never queried in bulk.
 *  - Sprint-2 takeoff models (`Document`, `Sheet`, `TakeoffItem`,
 *    `ValidationFlag`, `Correction`) are included.
 */
const TENANT_MODELS = new Set([
  'Project',
  'Space',
  'Material',
  'Supplier',
  'MaterialSupplierPrice',
  'PriceSnapshot',
  'Membership',
  'Job',
  'Usage',
  // Sprint-2 takeoff models.
  'Document',
  'Sheet',
  'TakeoffItem',
  'ValidationFlag',
  'Correction',
  // Sprint-3 money path. RateLibraryItem is deliberately ABSENT — see
  // apps/api/docs/adr/012-rate-library-nullable-org-scoping.md for the
  // explicit-scoping rule.
  'Assembly',
  'AssemblyComponent',
  'Boq',
  'BoqSection',
  'BoqLine',
  'Quotation',
])

const SCOPED_READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
])

const SCOPED_WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany'])

function mergeWhere<T extends object>(existing: T | undefined, orgId: string): T {
  return { ...(existing ?? {}), organizationId: orgId } as T
}

/**
 * Returns a Prisma client whose every operation against a tenant-owned model
 * is automatically scoped to `orgId`. Application code calls
 *
 *   const db = tenantDb(ctx.organizationId)
 *   await db.project.findMany({ where: { status: 'active' } })
 *
 * and the extension rewrites the `where` to
 *   `{ status: 'active', organizationId: ctx.organizationId }`
 *
 * before Prisma sees it. Same treatment on `create / createMany / upsert.create`.
 *
 * IMPORTANT: route handlers must derive `orgId` from the JWT, NEVER from the
 * request body. The middleware in apps/api/src/middleware/auth.ts already
 * does this; do not bypass it.
 */
export function tenantDb(orgId: string) {
  return prisma.$extends({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args)

          const a = args as Record<string, unknown>

          if (SCOPED_READ_OPS.has(operation) || SCOPED_WRITE_OPS.has(operation)) {
            a.where = mergeWhere(a.where as object | undefined, orgId)
          }

          if (operation === 'create') {
            a.data = { ...(a.data as object | undefined ?? {}), organizationId: orgId }
          }

          if (operation === 'createMany') {
            const data = a.data as Array<Record<string, unknown>> | Record<string, unknown>
            if (Array.isArray(data)) {
              a.data = data.map((d) => ({ ...d, organizationId: orgId }))
            } else {
              a.data = { ...data, organizationId: orgId }
            }
          }

          if (operation === 'upsert') {
            a.where = mergeWhere(a.where as object | undefined, orgId)
            const create = a.create as object | undefined
            if (create) a.create = { ...create, organizationId: orgId }
          }

          return query(a)
        },
      },
    },
  })
}

export type TenantDb = ReturnType<typeof tenantDb>
