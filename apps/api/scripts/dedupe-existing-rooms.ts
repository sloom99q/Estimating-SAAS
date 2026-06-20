/**
 * One-shot — apply the upgraded normalizeRoomName to an existing project's
 * rooms and collapse duplicates that the old normalizer missed.
 *
 * Mirrors the cross-sheet dedup loop in
 * apps/api/src/jobs/handlers/extractRooms.ts (around line 740 onwards):
 *   - Group rooms by normalizeRoomName
 *   - For each multi-row group, score by (qtyAi present? + tag? + confidence)
 *     and keep the highest-scoring row
 *   - Propagate finish_code + finishSuggestion + rawFinishObservation
 *     from any loser into the survivor when the survivor lacks it
 *     (PIVOT pattern — the finish data is precious; never drop it)
 *   - Soft-delete the losers
 *   - Soft-delete any SKIRTING/VANITY (SK-* / VAN-*) rows still at
 *     status='AI' whose meta.roomId points at a soon-to-be-deleted room.
 *     Promoted (EDITED/APPROVED) estimated rows survive — they're the
 *     reviewer's confirmations and stay attached even if the source
 *     room consolidated; QUANTIFY's housekeeping sweep won't touch them.
 *
 * Idempotent: a second run finds no duplicates and exits cleanly.
 *
 *   bun apps/api/scripts/dedupe-existing-rooms.ts <projectId> [--dry-run] [--confirm]
 *
 * Always preview with --dry-run first. --confirm executes.
 */
import type { Prisma, TakeoffItem } from '@prisma/client'
import { prisma } from '../src/db'
import { normalizeRoomName } from '../src/jobs/handlers/extractRooms'

interface DedupResult {
  projectId: string
  roomsBefore: number
  uniqueKeys: number
  mergeGroups: Array<{
    key: string
    survivor: { id: string; name: string }
    losers: Array<{ id: string; name: string }>
    propagatedFromLoserId: string | null
  }>
  losersSoftDeleted: number
  orphanedEstimatesSoftDeleted: number
}

function roomScore(r: TakeoffItem): number {
  const tagBonus = r.tag !== null ? 2 : 0
  const areaBonus = r.qtyAi !== null ? 4 : 0
  return areaBonus + tagBonus + r.confidence / 100
}

function nameOf(r: TakeoffItem): string {
  return r.description.split('—')[0]!.trim()
}

async function dedupe(projectId: string, dryRun: boolean): Promise<DedupResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, organizationId: true, name: true },
  })
  if (!project) throw new Error(`Project ${projectId} not found`)

  const rooms = await prisma.takeoffItem.findMany({
    where: {
      organizationId: project.organizationId,
      projectId: project.id,
      deletedAt: null,
      category: 'ROOM',
    },
    orderBy: { createdAt: 'asc' },
  })

  const groups = new Map<string, typeof rooms>()
  for (const r of rooms) {
    const key = normalizeRoomName(r.description)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(r)
    else groups.set(key, [r])
  }

  const result: DedupResult = {
    projectId,
    roomsBefore: rooms.length,
    uniqueKeys: groups.size,
    mergeGroups: [],
    losersSoftDeleted: 0,
    orphanedEstimatesSoftDeleted: 0,
  }

  for (const [key, list] of groups) {
    if (list.length === 1) continue
    const sorted = list.slice().sort((a, b) => roomScore(b) - roomScore(a))
    const survivor = sorted[0]!
    const losers = sorted.slice(1)
    const survivorMeta = (survivor.meta ?? {}) as Record<string, unknown>
    const survivorFinish = survivorMeta.finish_code as string | null | undefined
    const survivorSuggestion = (survivorMeta.finishSuggestion as { code?: string | null } | null | undefined)?.code ?? null

    let propagatedFromLoserId: string | null = null

    // Propagate finish_code from a loser into the survivor when the
    // survivor lacks one. The Sprint-9/PIVOT rule: the finish data
    // (whether human-confirmed or AI-suggested) is precious; never drop
    // it on dedup.
    if (!survivorFinish && losers.length > 0) {
      const donorWithCode = losers.find((l) => {
        const lm = (l.meta ?? {}) as Record<string, unknown>
        return typeof lm.finish_code === 'string' && lm.finish_code !== ''
      })
      if (donorWithCode) {
        const dm = donorWithCode.meta as Record<string, unknown>
        const mergedMeta: Record<string, unknown> = {
          ...survivorMeta,
          finish_code: dm.finish_code,
          finishSource: dm.finishSource ?? 'dedup-propagated',
          finishConfirmedAt: dm.finishConfirmedAt ?? null,
          dedupePropagatedFrom: donorWithCode.id,
        }
        if (!survivorMeta.rawFinishObservation && dm.rawFinishObservation) {
          mergedMeta.rawFinishObservation = dm.rawFinishObservation
        }
        if (!dryRun) {
          await prisma.takeoffItem.update({
            where: { id: survivor.id },
            data: { meta: mergedMeta as Prisma.JsonObject },
          })
        }
        propagatedFromLoserId = donorWithCode.id
      }
    } else if (!survivorSuggestion && losers.length > 0) {
      // No confirmed finish to propagate, but maybe a loser had a
      // finishSuggestion the survivor missed.
      const donorWithSugg = losers.find((l) => {
        const lm = (l.meta ?? {}) as Record<string, unknown>
        const lsugg = lm.finishSuggestion as { code?: string | null } | null | undefined
        return !!lsugg?.code
      })
      if (donorWithSugg) {
        const dm = donorWithSugg.meta as Record<string, unknown>
        const mergedMeta: Record<string, unknown> = {
          ...survivorMeta,
          finishSuggestion: dm.finishSuggestion,
          dedupePropagatedFrom: donorWithSugg.id,
        }
        if (!survivorMeta.rawFinishObservation && dm.rawFinishObservation) {
          mergedMeta.rawFinishObservation = dm.rawFinishObservation
        }
        if (!dryRun) {
          await prisma.takeoffItem.update({
            where: { id: survivor.id },
            data: { meta: mergedMeta as Prisma.JsonObject },
          })
        }
        propagatedFromLoserId = donorWithSugg.id
      }
    }

    // Soft-delete losers (and orphaned AI-status estimates pointing at
    // them, e.g. SK-/VAN- rows that QUANTIFY emitted for the loser room).
    if (!dryRun && losers.length > 0) {
      await prisma.takeoffItem.updateMany({
        where: { id: { in: losers.map((l) => l.id) } },
        data: { deletedAt: new Date() },
      })
      const loserIds = losers.map((l) => l.id)
      const orphans = await prisma.takeoffItem.findMany({
        where: {
          organizationId: project.organizationId,
          projectId: project.id,
          deletedAt: null,
          basis: 'ESTIMATED',
          status: 'AI',
        },
        select: { id: true, meta: true },
      })
      const orphanIds: string[] = []
      for (const o of orphans) {
        const om = (o.meta ?? {}) as Record<string, unknown>
        const rid = typeof om.roomId === 'string' ? om.roomId : null
        if (rid && loserIds.includes(rid)) orphanIds.push(o.id)
      }
      if (orphanIds.length > 0) {
        await prisma.takeoffItem.updateMany({
          where: { id: { in: orphanIds } },
          data: { deletedAt: new Date() },
        })
        result.orphanedEstimatesSoftDeleted += orphanIds.length
      }
    }
    result.losersSoftDeleted += losers.length

    result.mergeGroups.push({
      key,
      survivor: { id: survivor.id, name: nameOf(survivor) },
      losers: losers.map((l) => ({ id: l.id, name: nameOf(l) })),
      propagatedFromLoserId,
    })
  }
  return result
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const projectId = args.find((a) => !a.startsWith('--'))
  const dryRun = args.includes('--dry-run')
  const confirm = args.includes('--confirm')
  if (!projectId) {
    console.error('Usage: bun apps/api/scripts/dedupe-existing-rooms.ts <projectId> [--dry-run] [--confirm]')
    process.exit(2)
  }
  if (!dryRun && !confirm) {
    console.error('Pass either --dry-run (preview) or --confirm (execute).')
    process.exit(2)
  }
  const result = await dedupe(projectId, dryRun)
  console.log('')
  console.log(`Project: ${result.projectId}`)
  console.log(`Before: ${result.roomsBefore} ROOM TakeoffItems`)
  console.log(`After:  ${result.uniqueKeys} unique buckets`)
  console.log('')
  if (result.mergeGroups.length === 0) {
    console.log('No duplicates. Idempotent.')
    return
  }
  console.log(`=== ${result.mergeGroups.length} merge groups ===`)
  for (const g of result.mergeGroups) {
    console.log('')
    console.log(`  [${g.key}]`)
    console.log(`    survivor   : ${g.survivor.name}`)
    for (const l of g.losers) console.log(`    soft-delete: ${l.name}`)
    if (g.propagatedFromLoserId) {
      const donor = g.losers.find((l) => l.id === g.propagatedFromLoserId)
      console.log(`    propagated finish from: ${donor?.name ?? g.propagatedFromLoserId}`)
    }
  }
  console.log('')
  console.log(`Losers soft-deleted          : ${result.losersSoftDeleted}`)
  console.log(`Orphaned AI estimates removed: ${result.orphanedEstimatesSoftDeleted}`)
  if (dryRun) {
    console.log('')
    console.log('Dry run — no DB changes. Re-run with --confirm to execute.')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
