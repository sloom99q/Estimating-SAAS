/**
 * Sortable, non-sequential id matching the Prisma `cuid()` shape on the wire.
 * Used by the seeder + anywhere we want to mint an id before insert (we still
 * let Prisma default to its own cuid for normal create paths).
 */
export function generateId(prefix: string): string {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${time}${rand}`
}
