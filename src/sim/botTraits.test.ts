import { describe, expect, it } from 'vitest'
import { mulberry32 } from './rng'
import { assignArchetypes, generateBotTraits } from './botTraits'

describe('bot traits (spec §3.1)', () => {
  it('assigns the room archetypes the spec calls out: 2 RB-heavy, 2 WR-heavy, 1 early-QB, 1 punt-TE, rest neutral', () => {
    const archetypes = assignArchetypes(11, mulberry32(1))
    const counts = archetypes.reduce<Record<string, number>>((acc, a) => {
      acc[a] = (acc[a] ?? 0) + 1
      return acc
    }, {})
    expect(counts.RB_HEAVY).toBe(2)
    expect(counts.WR_HEAVY).toBe(2)
    expect(counts.EARLY_QB).toBe(1)
    expect(counts.PUNT_TE).toBe(1)
    expect(counts.NEUTRAL).toBe(5)
  })

  it('keeps every trait within its declared range', () => {
    const traits = generateBotTraits(11, mulberry32(42))
    for (const t of traits) {
      expect(t.aggression).toBeGreaterThanOrEqual(0.9)
      expect(t.aggression).toBeLessThanOrEqual(1.1)
      expect(t.starPreference).toBeGreaterThanOrEqual(-0.1)
      expect(t.starPreference).toBeLessThanOrEqual(0.1)
      expect(t.disciplineDecay).toBeGreaterThanOrEqual(0.5)
      expect(t.disciplineDecay).toBeLessThanOrEqual(1.5)
      expect(t.noiseScale).toBeGreaterThanOrEqual(0.7)
      expect(t.noiseScale).toBeLessThanOrEqual(1.3)
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'DEF'] as const) {
        expect(t.positionBias[pos]).toBeGreaterThan(0)
      }
    }
  })

  it('is deterministic for a given seed', () => {
    const a = generateBotTraits(11, mulberry32(7))
    const b = generateBotTraits(11, mulberry32(7))
    expect(a).toEqual(b)
  })
})
