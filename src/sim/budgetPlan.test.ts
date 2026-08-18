import { describe, expect, it } from 'vitest'
import { mulberry32 } from './rng'
import { createTeam, assignPlayer } from './roster'
import type { Player } from './types'
import { assignBudgetPlanArchetypes, computePlannedMaxBid, generateBudgetPlan } from './budgetPlan'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    name: 'Test Player',
    team: 'XXX',
    pos: 'RB',
    marketRank: 1,
    posRank: 1,
    yahooAAV: 10,
    leagueOverall: 10,
    leaguePositional: 10,
    blended: 10,
    tier: 1,
    sd: 2,
    matchedYahoo: true,
    ...overrides,
  }
}

describe('assignBudgetPlanArchetypes (REVISIONS.md Fix 2a)', () => {
  it('assigns exactly one stars-and-scrubs, one even-spread, rest balanced', () => {
    const archetypes = assignBudgetPlanArchetypes(11, mulberry32(1))
    const counts = archetypes.reduce<Record<string, number>>((acc, a) => {
      acc[a] = (acc[a] ?? 0) + 1
      return acc
    }, {})
    expect(counts.STARS_AND_SCRUBS).toBe(1)
    expect(counts.EVEN_SPREAD).toBe(1)
    expect(counts.BALANCED).toBe(9)
  })

  it('is deterministic for a given seed', () => {
    const a = assignBudgetPlanArchetypes(11, mulberry32(7))
    const b = assignBudgetPlanArchetypes(11, mulberry32(7))
    expect(a).toEqual(b)
  })
})

describe('generateBudgetPlan (REVISIONS.md Fix 2a)', () => {
  it('always sums to exactly the total budget, with every slot at least $1', () => {
    for (const archetype of ['STARS_AND_SCRUBS', 'BALANCED', 'EVEN_SPREAD'] as const) {
      const plan = generateBudgetPlan(archetype, 200, 9, 5, mulberry32(3))
      expect(plan).toHaveLength(14)
      expect(plan.reduce((a, b) => a + b, 0)).toBe(200)
      for (const share of plan) expect(share).toBeGreaterThanOrEqual(1)
    }
  })

  it('stars-and-scrubs concentrates far more than even-spread', () => {
    const stars = generateBudgetPlan('STARS_AND_SCRUBS', 200, 9, 5, mulberry32(1))
    const even = generateBudgetPlan('EVEN_SPREAD', 200, 9, 5, mulberry32(1))
    const spread = (plan: number[]) => Math.max(...plan) - Math.min(...plan)
    expect(spread(stars)).toBeGreaterThan(spread(even))
    // Even-spread should land close to a flat 200/14 ~ 14.3 per slot.
    for (const share of even) expect(share).toBeGreaterThan(10)
  })

  it('starter slots collectively get more than bench slots for a concentrated plan', () => {
    const plan = generateBudgetPlan('STARS_AND_SCRUBS', 200, 9, 5, mulberry32(2))
    const starterTotal = plan.slice(0, 9).reduce((a, b) => a + b, 0)
    const benchTotal = plan.slice(9).reduce((a, b) => a + b, 0)
    expect(starterTotal).toBeGreaterThan(benchTotal)
  })
})

describe('computePlannedMaxBid (REVISIONS.md Fix 2a)', () => {
  it('caps the bid at budget minus spend minus the plan for every other open slot', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR'], 0) // 2 slots
    const plan = [120, 80] // reserve $80 for the WR slot when bidding on the RB slot
    const maxBid = computePlannedMaxBid(team, makePlayer({ pos: 'RB' }), plan)
    expect(maxBid).toBe(200 - 0 - 80) // = 120, exactly the RB slot's own planned share
  })

  it('drops a slot from the reserve once it fills, freeing up room for what is left', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR', 'TE'], 0)
    const plan = [100, 60, 40]
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 100, 1) // spent exactly to plan
    // Only WR/TE remain open; bidding on WR should reserve TE's $40.
    const maxBid = computePlannedMaxBid(team, makePlayer({ pos: 'WR' }), plan)
    expect(maxBid).toBe(200 - 100 - 40) // = 60
  })

  it('shrinks future room when an earlier slot overspends its plan (self-correcting)', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR', 'TE'], 0)
    const plan = [100, 60, 40]
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 150, 1) // way over the $100 plan
    const maxBid = computePlannedMaxBid(team, makePlayer({ pos: 'WR' }), plan)
    // Only $50 left total, $40 of it reserved for TE -> $10 left for WR,
    // well under the WR slot's own $60 plan.
    expect(maxBid).toBe(200 - 150 - 40)
    expect(maxBid).toBeLessThan(plan[1])
  })

  it('returns 0 when the team has no eligible slot for the position', () => {
    const team = createTeam(1, 'A', 200, ['WR'], 0)
    const plan = [200]
    expect(computePlannedMaxBid(team, makePlayer({ pos: 'RB' }), plan)).toBe(0)
  })
})
