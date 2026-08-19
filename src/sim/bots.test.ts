import { describe, expect, it } from 'vitest'
import { createInitialState } from './draftState'
import { draftData } from './data'
import { createTeam } from './roster'
import { createRealBotMaxBidFn, type BotState } from './bots'
import type { Player } from './types'
import type { BotTraits } from './botTraits'
import type { DrawnOwnerTraits } from './ownerProfiles'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    name: 'Test Player',
    team: 'XXX',
    pos: 'RB',
    marketRank: 1,
    posRank: 1,
    yahooAAV: 100,
    leagueOverall: 100,
    leaguePositional: 100,
    blended: 100,
    tier: 1,
    sd: 0,
    matchedYahoo: true,
    ...overrides,
  }
}

const neutralTraits: BotTraits = {
  overpayRatio: 1,
  positionBias: { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 },
  starPreference: 0,
  disciplineDecay: 1,
  noiseScale: 1,
  restraint: 1,
}

const neutralDrawnTraits: DrawnOwnerTraits = {
  qbShare: 0.06,
  rbShare: 0.47,
  wrShare: 0.4,
  teShare: 0.06,
  top3Concentration: 0.6,
  shareSpentByNom40: 0.54,
  dollarPlayers: 4,
  biggestBuy: 0.28,
  overpayRatio: 1,
}

function makeBotState(overrides: Partial<BotState> = {}): BotState {
  return {
    teamId: 1,
    name: 'TestBot',
    drawnTraits: neutralDrawnTraits,
    traits: neutralTraits,
    valuations: new Map(),
    budgetPlan: new Array(14).fill(200 / 14),
    ...overrides,
  }
}

describe('restraint (REVISIONS.md Fix 2b)', () => {
  it('scales the max bid down proportionally, all else equal', () => {
    const player = makePlayer({ blended: 100 })

    // Two independent states from the same seed, so both draw the exact
    // same "locked in" roll (state.rng) — otherwise the two calls could
    // disagree on lock-in and make the proportionality check flaky.
    const teamA = createTeam(1, 'A', 200, ['RB'], 0) // one open slot, no reserve pressure
    const stateA = createInitialState(draftData, 1)
    stateA.teams = [teamA]
    const teamB = createTeam(1, 'A', 200, ['RB'], 0)
    const stateB = createInitialState(draftData, 1)
    stateB.teams = [teamB]

    const fullBot = makeBotState({ traits: { ...neutralTraits, restraint: 1 }, valuations: new Map([['Test Player|XXX', 100]]) })
    const restrainedBot = makeBotState({ traits: { ...neutralTraits, restraint: 0.9 }, valuations: new Map([['Test Player|XXX', 100]]) })

    const fullBid = createRealBotMaxBidFn([fullBot])(stateA, teamA, player)
    const restrainedBid = createRealBotMaxBidFn([restrainedBot])(stateB, teamB, player)

    expect(restrainedBid).toBeLessThan(fullBid)
    // Both go through independent Math.round() calls, so check the ratio
    // loosely rather than expecting an exact 0.9x match.
    expect(restrainedBid / fullBid).toBeGreaterThan(0.85)
    expect(restrainedBid / fullBid).toBeLessThan(0.95)
  })

  it('never lets a bot bid its full private valuation once restraint is below 1', () => {
    const player = makePlayer({ blended: 50 })
    const team = createTeam(1, 'A', 200, ['RB'], 0)
    const state = createInitialState(draftData, 1)
    state.teams = [team]

    const bot = makeBotState({ traits: { ...neutralTraits, restraint: 0.85 }, valuations: new Map([['Test Player|XXX', 50]]) })
    const bid = createRealBotMaxBidFn([bot])(state, team, player)
    expect(bid).toBeLessThanOrEqual(50 * 0.85 + 1) // +1 for rounding
  })
})
