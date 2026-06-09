import { DEFAULT_CURRENCY } from '@/shared/config/constants'
import { dbClient } from '@/shared/db'
import type { ID } from '@/shared/types'
import type { Material } from '../domain/material.types'

/**
 * Demo material library. Construction of the rows is centralised here (no
 * longer hidden inside the service) so the seed script in `app/db/seed.ts`
 * can compose every feature's seed in one place. The dates are fixed so
 * the seed is deterministic across machines.
 */
export function materialsSeedRows(organizationId: ID): Material[] {
  const now = new Date('2026-06-01T09:00:00.000Z').toISOString()
  const audit = {
    organizationId,
    currency: DEFAULT_CURRENCY,
    active: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    notes: null,
  }
  return [
    {
      ...audit,
      id: dbClient.generateId('mat'),
      name: 'Ceramic floor tile — 60×60',
      category: 'tiles',
      unit: 'm2',
      unitPrice: 95,
      coverage: 1,
      wastePct: 10,
      supplier: 'Aurora Stone & Tile',
      imageUrl:
        'https://images.unsplash.com/photo-1581235720704-06d3acfcb36f?w=640&auto=format&fit=crop&q=80',
    },
    {
      ...audit,
      id: dbClient.generateId('mat'),
      name: 'Carrara marble — polished',
      category: 'marble',
      unit: 'm2',
      unitPrice: 620,
      coverage: 1,
      wastePct: 12,
      supplier: 'Aurora Stone & Tile',
      notes: 'Sealing recommended; check lead time.',
      imageUrl:
        'https://images.unsplash.com/photo-1614142933114-5acd5cd05e15?w=640&auto=format&fit=crop&q=80',
    },
    {
      ...audit,
      id: dbClient.generateId('mat'),
      name: 'Premium wall paint — matt',
      category: 'paint',
      unit: 'bag',
      unitPrice: 240,
      coverage: 28,
      wastePct: 8,
      supplier: 'Jotun Middle East',
      notes: '1 bucket covers ≈ 28 m² in two coats.',
      imageUrl:
        'https://images.unsplash.com/photo-1562184552-997c461abbe6?w=640&auto=format&fit=crop&q=80',
    },
    {
      ...audit,
      id: dbClient.generateId('mat'),
      name: 'Ceiling gypsum board — 12 mm',
      category: 'gypsum',
      unit: 'piece',
      unitPrice: 42,
      coverage: 2.88,
      wastePct: 5,
      supplier: 'Gulf Boards Co.',
      imageUrl:
        'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=640&auto=format&fit=crop&q=80',
    },
    {
      ...audit,
      id: dbClient.generateId('mat'),
      name: 'Tile adhesive',
      category: 'glue',
      unit: 'bag',
      unitPrice: 28,
      coverage: 4.5,
      wastePct: 5,
      supplier: 'Mapei Arabia',
      imageUrl: null,
    },
    {
      ...audit,
      id: dbClient.generateId('mat'),
      name: 'Tile grout — neutral',
      category: 'grout',
      unit: 'kg',
      unitPrice: 14,
      coverage: 6,
      wastePct: 5,
      supplier: 'Mapei Arabia',
      imageUrl: null,
    },
    {
      ...audit,
      id: dbClient.generateId('mat'),
      name: 'Walnut wood cladding',
      category: 'cladding',
      unit: 'm2',
      unitPrice: 380,
      coverage: 1,
      wastePct: 8,
      supplier: 'Levant Timber Works',
      imageUrl:
        'https://images.unsplash.com/photo-1503602642458-232111445657?w=640&auto=format&fit=crop&q=80',
    },
  ]
}
