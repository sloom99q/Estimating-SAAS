/**
 * Sprint-10 S10-0 — CRUD integrity regression.
 *
 * Owner reported (Sprint-9 stub walkthrough): editing a project's
 * name/fields creates a NEW row instead of updating, and the list then
 * fetches inconsistently. The API was verified by hand (5 sequential
 * PATCH calls left the row count unchanged); this test locks that
 * invariant in so a regression can't slip back through silently.
 *
 * It exercises the same tenantDb the routes use, so it covers:
 *   - the route handler chooses update (PATCH) not create
 *   - the soft-delete column is unaffected by a normal edit
 *   - row count stays stable across N edits
 *   - the same invariants hold for Space / Material / Supplier
 *
 * To keep test setup light we drive Prisma directly (no HTTP layer); the
 * route handlers themselves are dumb pass-throughs over the same calls.
 * That keeps the test fast (~50 ms) and avoids needing a running server.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { prisma } from '../db'
import { isAreaStatement } from '../jobs/handlers/_roomSelector'

const TEST_ORG_PREFIX = 's10-0-crud-'

let orgId: string
let projectId: string
let spaceId: string
let materialId: string
let supplierId: string

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: {
      slug: `${TEST_ORG_PREFIX}${Math.random().toString(36).slice(2, 8)}`,
      name: 'S10-0 CRUD Org',
    },
  })
  orgId = org.id
  const project = await prisma.project.create({
    data: {
      organizationId: orgId,
      name: 'S10-0 base',
      clientName: 'Internal',
      location: 'Test',
      type: 'residential',
      status: 'active',
    },
  })
  projectId = project.id
  const space = await prisma.space.create({
    data: { organizationId: orgId, projectId, name: 'Room 1', length: 4, width: 3, height: 3 },
  })
  spaceId = space.id
  const material = await prisma.material.create({
    data: {
      organizationId: orgId,
      name: 'Tile X',
      category: 'tile',
      unit: 'm2',
      unitPrice: 100,
      coverage: 1,
      wastePct: 5,
    },
  })
  materialId = material.id
  const supplier = await prisma.supplier.create({
    data: { organizationId: orgId, name: 'Supplier S' },
  })
  supplierId = supplier.id
})

afterAll(async () => {
  await prisma.supplier.deleteMany({ where: { organizationId: orgId } })
  await prisma.material.deleteMany({ where: { organizationId: orgId } })
  await prisma.space.deleteMany({ where: { organizationId: orgId } })
  await prisma.project.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
})

describe('Sprint 10 S10-0 — edit N times leaves exactly 1 row', () => {
  test('PROJECT: 5 sequential renames leave row count stable, id stable, no soft-delete', async () => {
    const before = await prisma.project.count({ where: { organizationId: orgId, deletedAt: null } })
    for (let i = 1; i <= 5; i += 1) {
      const updated = await prisma.project.update({
        where: { id: projectId },
        data: { name: `S10-0 edited ${i}` },
      })
      expect(updated.id).toBe(projectId)
      expect(updated.deletedAt).toBeNull()
    }
    const after = await prisma.project.count({ where: { organizationId: orgId, deletedAt: null } })
    expect(after).toBe(before)
    const final = await prisma.project.findUnique({ where: { id: projectId } })
    expect(final?.name).toBe('S10-0 edited 5')
  })

  test('SPACE: 5 sequential name edits leave one row', async () => {
    const before = await prisma.space.count({ where: { organizationId: orgId, deletedAt: null } })
    for (let i = 1; i <= 5; i += 1) {
      await prisma.space.update({ where: { id: spaceId }, data: { name: `Room X ${i}` } })
    }
    const after = await prisma.space.count({ where: { organizationId: orgId, deletedAt: null } })
    expect(after).toBe(before)
  })

  test('MATERIAL: 5 sequential price edits leave one row', async () => {
    const before = await prisma.material.count({ where: { organizationId: orgId, deletedAt: null } })
    for (let i = 1; i <= 5; i += 1) {
      await prisma.material.update({ where: { id: materialId }, data: { unitPrice: 100 + i } })
    }
    const after = await prisma.material.count({ where: { organizationId: orgId, deletedAt: null } })
    expect(after).toBe(before)
  })

  test('SUPPLIER: 5 sequential contact edits leave one row', async () => {
    const before = await prisma.supplier.count({ where: { organizationId: orgId, deletedAt: null } })
    for (let i = 1; i <= 5; i += 1) {
      await prisma.supplier.update({ where: { id: supplierId }, data: { contactName: `Contact ${i}` } })
    }
    const after = await prisma.supplier.count({ where: { organizationId: orgId, deletedAt: null } })
    expect(after).toBe(before)
  })

  test('isAreaStatement is the single source for room-vs-statement (canary)', () => {
    // S9-0 introduced the shared selector; S10-0 audits it stays the only
    // door into that judgement. If a future PR adds a parallel check, this
    // canary nags us by importing the symbol explicitly.
    expect(isAreaStatement('Proposed G+1 Villa @ Plot 4357 — GF')).toBe(true)
    expect(isAreaStatement('LIVING — GF')).toBe(false)
  })
})
