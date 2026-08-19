import { describe, expect, it } from 'vitest'
import { mulberry32 } from './rng'
import { BOT_OWNERS, HUMAN_OWNER_NAME, TRAIT_STATS, drawOwnerTraits } from './ownerProfiles'

describe('ownerProfiles (BOT_PERSONALITIES.md)', () => {
  it('has exactly eleven bot owners, excluding the human', () => {
    expect(BOT_OWNERS).toHaveLength(11)
    expect(BOT_OWNERS.some((o) => o.name === HUMAN_OWNER_NAME)).toBe(false)
  })

  it('draws every trait clamped within its observed real-world range', () => {
    const owner = BOT_OWNERS[0]
    for (let seed = 0; seed < 50; seed++) {
      const drawn = drawOwnerTraits(owner, mulberry32(seed))
      for (const trait of Object.keys(drawn) as (keyof typeof drawn)[]) {
        const stats = TRAIT_STATS[trait]
        expect(drawn[trait]).toBeGreaterThanOrEqual(stats.observedMin)
        expect(drawn[trait]).toBeLessThanOrEqual(stats.observedMax)
      }
    }
  })

  it('is deterministic for a given seed', () => {
    const owner = BOT_OWNERS[0]
    const a = drawOwnerTraits(owner, mulberry32(7))
    const b = drawOwnerTraits(owner, mulberry32(7))
    expect(a).toEqual(b)
  })

  it('redraws differently draft to draft — the finding is the redraw, not a fixed personality', () => {
    const owner = BOT_OWNERS[0]
    const draws = new Set<number>()
    for (let seed = 0; seed < 20; seed++) {
      draws.add(drawOwnerTraits(owner, mulberry32(seed)).rbShare)
    }
    expect(draws.size).toBeGreaterThan(1)
  })

  it('centres on the owner\'s useThis value across many draws, not the raw observed value', () => {
    // Sherman's raw QB share (0.1043) shrinks hard to useThis (0.0714) per
    // BOT_PERSONALITIES.md's own example — the per-draft mean across many
    // redraws should track useThis, not the unshrunk raw figure.
    const sherman = BOT_OWNERS.find((o) => o.name === 'Sherman')!
    expect(sherman.traits.qbShare.observed).toBeCloseTo(0.1043)
    expect(sherman.traits.qbShare.useThis).toBeCloseTo(0.0714)

    let sum = 0
    const n = 500
    for (let seed = 0; seed < n; seed++) {
      sum += drawOwnerTraits(sherman, mulberry32(seed)).qbShare
    }
    const mean = sum / n
    expect(Math.abs(mean - sherman.traits.qbShare.useThis)).toBeLessThan(Math.abs(mean - sherman.traits.qbShare.observed))
  })
})
