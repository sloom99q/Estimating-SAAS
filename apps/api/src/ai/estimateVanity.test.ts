import { describe, expect, it } from 'bun:test'
import { estimateVanityForRoom } from './estimateVanity'

describe('estimateVanityForRoom', () => {
  it('returns null for a room that is neither bathroom-finished nor bathroom-named', () => {
    expect(estimateVanityForRoom('LIVING', 'ST01')).toBeNull()
    expect(estimateVanityForRoom('MASTER BEDROOM', 'PR01')).toBeNull()
    expect(estimateVanityForRoom('CORRIDOR', 'PR01')).toBeNull()
    expect(estimateVanityForRoom('KITCHEN', null)).toBeNull()
  })

  it('high confidence (95) when BOTH bathroom finish AND bathroom name match', () => {
    const r = estimateVanityForRoom("MAID'S BATH", 'BATHROOM')
    expect(r).not.toBeNull()
    expect(r!.count).toBe(1)
    expect(r!.confidence).toBe(95)
    expect(r!.signals.finishMatch).toBe(true)
    expect(r!.signals.nameMatch).toBe(true)
    expect(r!.reasoning).toContain('finish=BATHROOM')
    expect(r!.reasoning).toContain('name matches bathroom pattern')
  })

  it('lower confidence (80) when only finish=BATHROOM (oddly-named bathroom)', () => {
    // e.g. a service room confirmed as BATHROOM finish but with a non-
    // bathroom-pattern name. Less certain — maybe a wet area without
    // a vanity.
    const r = estimateVanityForRoom('SERVICE ROOM 3', 'BATHROOM')
    expect(r!.confidence).toBe(80)
    expect(r!.signals.finishMatch).toBe(true)
    expect(r!.signals.nameMatch).toBe(false)
  })

  it('lower confidence (80) when only name matches (finish still pending)', () => {
    // Reviewer hasn't confirmed BATHROOM yet but the name says BATH —
    // worth suggesting so the line is ready when they get to it.
    const r = estimateVanityForRoom('POWDER ROOM', null)
    expect(r!.confidence).toBe(80)
    expect(r!.signals.finishMatch).toBe(false)
    expect(r!.signals.nameMatch).toBe(true)
  })

  it('matches each bathroom-pattern keyword', () => {
    expect(estimateVanityForRoom('BATH 02', null)).not.toBeNull()
    expect(estimateVanityForRoom('TOILET', null)).not.toBeNull()
    expect(estimateVanityForRoom('POWDER ROOM', null)).not.toBeNull()
    expect(estimateVanityForRoom('GUEST WC', null)).not.toBeNull()
    expect(estimateVanityForRoom('LAVATORY', null)).not.toBeNull()
    expect(estimateVanityForRoom('RESTROOM', null)).not.toBeNull()
  })

  it('case-insensitive name matching', () => {
    expect(estimateVanityForRoom('master bath', null)).not.toBeNull()
    expect(estimateVanityForRoom('Powder Room', null)).not.toBeNull()
  })

  it('always returns count=1 for v1 (reviewer overrides inline for double-vanity)', () => {
    expect(estimateVanityForRoom('MASTER BATH', 'BATHROOM')!.count).toBe(1)
    expect(estimateVanityForRoom('POWDER', null)!.count).toBe(1)
  })

  it('reasoning line is human-readable for the verify UI', () => {
    const r = estimateVanityForRoom("MAID'S BATH", 'BATHROOM')!
    expect(r.reasoning).toMatch(/1 stone-top vanity per bathroom/i)
    expect(r.reasoning).toMatch(/typical residential/i)
  })

  it('rejects ceiling skylights / voids that mention BATH (the run-6 false positive)', () => {
    expect(estimateVanityForRoom('SKYLIGHT 04 ABOVE BATH 01', null)).toBeNull()
    expect(estimateVanityForRoom('VOID OVER BATH 02', null)).toBeNull()
    expect(estimateVanityForRoom('Skylight above Powder', null)).toBeNull()
    expect(estimateVanityForRoom('Pipe duct under WC', null)).toBeNull()
  })
})
