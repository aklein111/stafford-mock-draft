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
      for (const seed of [1, 2, 3, 4, 5]) {
        const plan = generateBudgetPlan(archetype, 200, 9, 5, mulberry32(seed))
        expect(plan).toHaveLength(14)
        expect(plan.reduce((a, b) => a + b, 0)).toBe(200)
        for (const share of plan) expect(share).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('is sorted biggest-first, not tied to any slot or position', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const plan = generateBudgetPlan('STARS_AND_SCRUBS', 200, 9, 5, mulberry32(seed))
      for (let i = 1; i < plan.length; i++) {
        expect(plan[i]).toBeLessThanOrEqual(plan[i - 1])
      }
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

  it('is deterministic for a given seed', () => {
    const a = generateBudgetPlan('BALANCED', 200, 9, 5, mulberry32(9))
    const b = generateBudgetPlan('BALANCED', 200, 9, 5, mulberry32(9))
    expect(a).toEqual(b)
  })

  it('the top slot varies draft to draft (REVISIONS.md Change 3, step 5)', () => {
    // Without per-draft variance in the ceiling, an archetype's best-pick
    // room is identical every draft, which is what made elite players
    // land below blended in 88%+ of simulations even after the ceiling's
    // average level was raised.
    const topValues = new Set<number>()
    for (let seed = 0; seed < 20; seed++) {
      const plan = generateBudgetPlan('BALANCED', 200, 9, 5, mulberry32(seed))
      topValues.add(plan[0])
    }
    expect(topValues.size).toBeGreaterThan(1)
  })
})

describe('computePlannedMaxBid (REVISIONS.md Fix 2a)', () => {
  it('caps the bid at budget minus spend minus the plan for every other open slot', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR'], 0) // 2 slots, both open
    const plan = [120, 80] // sorted biggest-first
    const maxBid = computePlannedMaxBid(team, makePlayer({ pos: 'RB' }), plan)
    expect(maxBid).toBe(200 - 0 - 80) // = 120: the current bid gets the biggest unconsumed value
  })

  it('drops the biggest remaining plan value from reserve once any slot fills', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR', 'TE'], 0)
    const plan = [100, 60, 40]
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 100, 1) // one slot filled, any position
    // Two slots remain open; the plan's *next*-biggest values ($60, $40)
    // are what's left, regardless of which position the first fill was.
    const maxBid = computePlannedMaxBid(team, makePlayer({ pos: 'WR' }), plan)
    expect(maxBid).toBe(200 - 100 - 40) // = 60
  })

  it('shrinks future room when an earlier slot overspends its plan (self-correcting)', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR', 'TE'], 0)
    const plan = [100, 60, 40]
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 150, 1) // way over the $100 plan
    const maxBid = computePlannedMaxBid(team, makePlayer({ pos: 'WR' }), plan)
    // Only $50 left total, $40 of it reserved for TE -> $10 left for WR,
    // well under the plan's second-biggest value.
    expect(maxBid).toBe(200 - 150 - 40)
    expect(maxBid).toBeLessThan(plan[1])
  })

  it('the reserve depends on how many slots have filled, not which position filled them (the Fix 2a bug this fixes)', () => {
    // Same plan, same team shape, but a different position fills first in
    // each case. An earlier version pinned the plan to team.slots by
    // index, so a stars-and-scrubs bot's big splurge value could only
    // ever apply to whichever position happened to get it at plan
    // creation — here, the cap on the remaining WR slot should be
    // identical either way, since one slot filling (for $1, no splurge)
    // is all that matters, not which one.
    const plan = [150, 30, 20]

    const rbFilledFirst = createTeam(1, 'A', 200, ['RB', 'WR', 'TE'], 0)
    assignPlayer(rbFilledFirst, makePlayer({ name: 'RB1', pos: 'RB' }), 1, 1)
    const wrCapAfterRB = computePlannedMaxBid(rbFilledFirst, makePlayer({ pos: 'WR' }), plan)

    const teFilledFirst = createTeam(1, 'A', 200, ['RB', 'WR', 'TE'], 0)
    assignPlayer(teFilledFirst, makePlayer({ name: 'TE1', pos: 'TE' }), 1, 1)
    const wrCapAfterTE = computePlannedMaxBid(teFilledFirst, makePlayer({ pos: 'WR' }), plan)

    expect(wrCapAfterRB).toBe(wrCapAfterTE)
    expect(wrCapAfterRB).toBe(200 - 1 - 20) // one slot consumed -> $30 available, $20 reserved for TE/RB
  })

  it('returns 0 when the team has no eligible slot for the position', () => {
    const team = createTeam(1, 'A', 200, ['WR'], 0)
    const plan = [200]
    expect(computePlannedMaxBid(team, makePlayer({ pos: 'RB' }), plan)).toBe(0)
  })
})
