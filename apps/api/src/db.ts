import { PrismaClient } from '@prisma/client'

/**
 * Singleton Prisma client. Bun re-imports modules cheaply on reload, but the
 * Prisma client is heavy — guarding against accidental duplicates keeps the
 * SQLite file from spawning multiple write connections under `--watch`.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? new PrismaClient({ log: ['error', 'warn'] })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}
