import { describe, expect, it } from 'vitest'
import { mulberry32 } from './rng'
import { traitsFromOwnerDraw } from './botTraits'
import { TRAIT_STATS, type DrawnOwnerTraits } from './ownerProfiles'

function leagueAverageDraw(overrides: Partial<DrawnOwnerTraits> = {}): DrawnOwnerTraits {
  return {
    qbShare: TRAIT_STATS.qbShare.leagueMean,
    rbShare: TRAIT_STATS.rbShare.leagueMean,
    wrShare: TRAIT_STATS.wrShare.leagueMean,
    teShare: TRAIT_STATS.teShare.leagueMean,
    top3Concentration: TRAIT_STATS.top3Concentration.leagueMean,
    shareSpentByNom40: TRAIT_STATS.shareSpentByNom40.leagueMean,
    dollarPlayers: TRAIT_STATS.dollarPlayers.leagueMean,
    biggestBuy: TRAIT_STATS.biggestBuy.leagueMean,
    overpayRatio: TRAIT_STATS.overpayRatio.leagueMean,
    ...overrides,
  }
}

describe('traitsFromOwnerDraw (BOT_PERSONALITIES.md)', () => {
  it('a draw exactly at the league mean produces neutral position bias and star preference', () => {
    const traits = traitsFromOwnerDraw(leagueAverageDraw(), mulberry32(1))
    for (const pos of ['QB', 'RB', 'WR', 'TE'] as const) {
      expect(traits.positionBias[pos]).toBeCloseTo(1)
    }
    expect(traits.starPreference).toBeCloseTo(0)
  })

  it('DEF bias always stays neutral — not a modelled owner trait', () => {
    const traits = traitsFromOwnerDraw(leagueAverageDraw({ rbShare: 0.7, wrShare: 0.2 }), mulberry32(1))
    expect(traits.positionBias.DEF).toBe(1)
  })

  it('above-average rbShare produces above-1 RB bias, damped below the raw ratio', () => {
    const mean = TRAIT_STATS.rbShare.leagueMean
    const traits = traitsFromOwnerDraw(leagueAverageDraw({ rbShare: mean * 1.4 }), mulberry32(1))
    expect(traits.positionBias.RB).toBeGreaterThan(1)
    expect(traits.positionBias.RB).toBeLessThan(1.4) // damped, not a 1:1 echo of the drawn share
  })

  it('overpayRatio passes through undamped — BOT_PERSONALITIES.md: "a small multiplier on its walk-away price"', () => {
    const traits = traitsFromOwnerDraw(leagueAverageDraw({ overpayRatio: 1.15 }), mulberry32(1))
    expect(traits.overpayRatio).toBe(1.15)
  })

  it('starPreference stays within its declared range even for an extreme top3Concentration draw', () => {
    const traits = traitsFromOwnerDraw(leagueAverageDraw({ top3Concentration: TRAIT_STATS.top3Concentration.observedMax }), mulberry32(1))
    expect(traits.starPreference).toBeLessThanOrEqual(0.1)
    expect(traits.starPreference).toBeGreaterThanOrEqual(-0.1)
  })

  it('keeps the non-owner-backed traits within their declared ranges and deterministic for a given seed', () => {
    const a = traitsFromOwnerDraw(leagueAverageDraw(), mulberry32(7))
    const b = traitsFromOwnerDraw(leagueAverageDraw(), mulberry32(7))
    expect(a).toEqual(b)

    expect(a.disciplineDecay).toBeGreaterThanOrEqual(0.5)
    expect(a.disciplineDecay).toBeLessThanOrEqual(1.5)
    expect(a.noiseScale).toBeGreaterThanOrEqual(0.7)
    expect(a.noiseScale).toBeLessThanOrEqual(1.3)
    expect(a.restraint).toBeGreaterThanOrEqual(0.85)
    expect(a.restraint).toBeLessThanOrEqual(0.95)
  })
})
