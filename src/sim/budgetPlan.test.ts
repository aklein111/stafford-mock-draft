import { describe, expect, it } from 'vitest'
import { createTeam, assignPlayer } from './roster'
import type { Player } from './types'
import type { DrawnOwnerTraits } from './ownerProfiles'
import { computePlannedMaxBid, generateBudgetPlan } from './budgetPlan'

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

function makeDrawn(overrides: Partial<DrawnOwnerTraits> = {}): DrawnOwnerTraits {
  return {
    qbShare: 0.06,
    rbShare: 0.47,
    wrShare: 0.4,
    teShare: 0.06,
    top3Concentration: 0.6164, // league mean
    shareSpentByNom40: 0.54,
    dollarPlayers: 4,
    biggestBuy: 0.28,
    overpayRatio: 1,
    ...overrides,
  }
}

describe('generateBudgetPlan (REVISIONS.md Fix 2a, BOT_PERSONALITIES.md)', () => {
  it('always sums to exactly the total budget, with every slot at least $1', () => {
    for (const top3 of [0.42, 0.6164, 0.8]) {
      for (const biggestBuy of [0.16, 0.28, 0.37]) {
        const plan = generateBudgetPlan(makeDrawn({ top3Concentration: top3, biggestBuy }), 200, 9, 5)
        expect(plan).toHaveLength(14)
        expect(plan.reduce((a, b) => a + b, 0)).toBe(200)
        for (const share of plan) expect(share).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('is sorted biggest-first, not tied to any slot or position', () => {
    const plan = generateBudgetPlan(makeDrawn({ top3Concentration: 0.8 }), 200, 9, 5)
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]).toBeLessThanOrEqual(plan[i - 1])
    }
  })

  it('a higher drawn top3Concentration produces a plan with a larger top-3 share than a lower one', () => {
    // setTopSlot pins slot 1 to the drawn biggestBuy regardless of decay,
    // so check the top3Concentration signal where it actually shows up:
    // ranks 2-3, driven by the decay curve underneath the override.
    const top3Share = (plan: number[]) => plan.slice(0, 3).reduce((a, b) => a + b, 0) / plan.reduce((a, b) => a + b, 0)
    const concentrated = generateBudgetPlan(makeDrawn({ top3Concentration: 0.8 }), 200, 9, 5)
    const spread = generateBudgetPlan(makeDrawn({ top3Concentration: 0.42 }), 200, 9, 5)
    expect(top3Share(concentrated)).toBeGreaterThan(top3Share(spread))
  })

  it('the top slot tracks the drawn biggestBuy fraction of total budget', () => {
    const low = generateBudgetPlan(makeDrawn({ biggestBuy: 0.16 }), 200, 9, 5)
    const high = generateBudgetPlan(makeDrawn({ biggestBuy: 0.37 }), 200, 9, 5)
    expect(high[0]).toBeGreaterThan(low[0])
    expect(high[0]).toBeCloseTo(0.37 * 200, -1) // within a few dollars of the rounded/rescaled target
  })

  it('the smallest dollarPlayers entries land at the $1 floor', () => {
    const plan = generateBudgetPlan(makeDrawn({ dollarPlayers: 5 }), 200, 9, 5)
    const cheapest = [...plan].sort((a, b) => a - b).slice(0, 5)
    for (const v of cheapest) expect(v).toBe(1)
  })

  it('is deterministic for the same drawn traits — all its variance now comes from the upstream owner draw', () => {
    const a = generateBudgetPlan(makeDrawn(), 200, 9, 5)
    const b = generateBudgetPlan(makeDrawn(), 200, 9, 5)
    expect(a).toEqual(b)
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

  it('reserveScale scales the reserve, not the current-bid slot (BOT_PERSONALITIES.md shareSpentByNom40)', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR', 'TE'], 0)
    const plan = [100, 60, 40]
    const neutral = computePlannedMaxBid(team, makePlayer({ pos: 'RB' }), plan)
    const eager = computePlannedMaxBid(team, makePlayer({ pos: 'RB' }), plan, 0.5) // half the reserve held back
    const patient = computePlannedMaxBid(team, makePlayer({ pos: 'RB' }), plan, 1.5) // more held back
    expect(neutral).toBe(200 - 0 - 100) // reserve = 60+40
    expect(eager).toBe(200 - 0 - 50) // reserve halved
    expect(patient).toBe(200 - 0 - 150) // reserve 1.5x
    expect(eager).toBeGreaterThan(neutral)
    expect(patient).toBeLessThan(neutral)
  })
})
