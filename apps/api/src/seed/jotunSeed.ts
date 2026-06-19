/**
 * Seed the Jotun reference assembly + components for a specific org. Used
 * by the main seed (idempotent: re-running updates rather than duplicates).
 */
import type { PrismaClient } from '@prisma/client'
import { JOTUN_INTERIOR_PAINT_SYSTEM_A } from '../pricing/assemblyEngine'

export async function seedJotunForOrg(
  client: PrismaClient,
  organizationId: string,
): Promise<string> {
  const existing = await client.assembly.findFirst({
    where: {
      organizationId,
      name: JOTUN_INTERIOR_PAINT_SYSTEM_A.name,
      deletedAt: null,
    },
    select: { id: true },
  })
  let assemblyId: string
  if (existing) {
    assemblyId = existing.id
    await client.assembly.update({
      where: { id: existing.id },
      data: {
        appliesTo: JOTUN_INTERIOR_PAINT_SYSTEM_A.appliesTo,
        outputUnit: JOTUN_INTERIOR_PAINT_SYSTEM_A.outputUnit,
      },
    })
    // Replace-all semantics: clear and re-create components so edits in
    // assemblyEngine.ts propagate without an orphan trail.
    await client.assemblyComponent.deleteMany({ where: { assemblyId } })
  } else {
    const created = await client.assembly.create({
      data: {
        organizationId,
        name: JOTUN_INTERIOR_PAINT_SYSTEM_A.name,
        appliesTo: JOTUN_INTERIOR_PAINT_SYSTEM_A.appliesTo,
        outputUnit: JOTUN_INTERIOR_PAINT_SYSTEM_A.outputUnit,
      },
    })
    assemblyId = created.id
  }
  await client.assemblyComponent.createMany({
    data: JOTUN_INTERIOR_PAINT_SYSTEM_A.components.map((c, i) => ({
      organizationId,
      assemblyId,
      kind: c.kind,
      label: c.label,
      unitPrice: 'unitPrice' in c ? c.unitPrice : null,
      coverage: 'coverage' in c ? c.coverage : null,
      coats: 'coats' in c ? c.coats : 1,
      wastagePct: 'wastagePct' in c ? c.wastagePct : 0,
      fixedCost: 'fixedCost' in c ? c.fixedCost : null,
      sortOrder: i,
    })),
  })
  return assemblyId
}
