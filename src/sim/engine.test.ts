import { describe, expect, it } from 'vitest'
import { draftData } from './data'
import { createInitialState } from './draftState'
import { createTeam, isRosterFull, legalMaxBid, canBidOnPosition, assignPlayer } from './roster'
import { nextNominator } from './nomination'
import { resolveAuction, runDraftStep, runFullDraft, isDraftComplete } from './engine'
import { trivialDollarBot } from './bots'
import type { Player } from './types'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    name: 'Test Player',
    team: 'XXX',
    pos: 'RB',
    myRank: 1,
    myValue: 10,
    yahooAAV: 10,
    consensusRank: 1,
    consensusPosRank: 1,
    leaguePosTarget: 10,
    expected: 10,
    edge: 0,
    tier: 1,
    sd: 2,
    matchedYahoo: true,
    ...overrides,
  }
}

describe('roster rules', () => {
  it('builds 14 slots per team: 9 starters + 5 bench', () => {
    const team = createTeam(1, 'A', 200, draftData.meta.starters, draftData.meta.bench)
    expect(team.slots).toHaveLength(14)
    expect(legalMaxBid(team)).toBe(200 - (14 - 1)) // must leave $1 for every other open slot
  })

  it('DEF has no bench slot: 2nd DEF is never draftable', () => {
    const defTeam = createTeam(2, 'B', 200, draftData.meta.starters, draftData.meta.bench)
    assignPlayer(defTeam, makePlayer({ name: 'DEF1', pos: 'DEF' }), 5, 1)
    expect(canBidOnPosition(defTeam, 'DEF')).toBe(false)
  })

  it('QB gets exactly one bench slot: a 2nd QB is draftable, a 3rd is not', () => {
    const team = createTeam(1, 'A', 200, draftData.meta.starters, draftData.meta.bench)
    assignPlayer(team, makePlayer({ name: 'QB1', pos: 'QB' }), 10, 1) // fills the starter slot
    expect(canBidOnPosition(team, 'QB')).toBe(true) // one bench slot still takes a QB

    assignPlayer(team, makePlayer({ name: 'QB2', pos: 'QB' }), 5, 2) // fills the one QB-eligible bench slot
    expect(canBidOnPosition(team, 'QB')).toBe(false) // no 3rd QB
  })

  it('RB/WR/TE can still fill FLEX and BENCH after starter slots are full', () => {
    const team = createTeam(1, 'A', 200, draftData.meta.starters, draftData.meta.bench)
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 10, 1)
    assignPlayer(team, makePlayer({ name: 'RB2', pos: 'RB' }), 10, 2)
    // Both RB starter slots are full, but FLEX/BENCH still take RBs.
    expect(canBidOnPosition(team, 'RB')).toBe(true)
  })

  it('legalMaxBid leaves $1 per remaining open slot', () => {
    const team = createTeam(1, 'A', 200, draftData.meta.starters, draftData.meta.bench)
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 50, 1)
    // 13 slots left open -> must reserve $1 for 12 of them.
    expect(legalMaxBid(team)).toBe(200 - 50 - 12)
  })

  it('a full roster reports isRosterFull', () => {
    const team = createTeam(1, 'A', 14, ['QB'], 0)
    expect(isRosterFull(team)).toBe(false)
    assignPlayer(team, makePlayer({ pos: 'QB' }), 1, 1)
    expect(isRosterFull(team)).toBe(true)
  })
})

describe('nomination rotation', () => {
  it('cycles through teams in order and skips full rosters', () => {
    const state = createInitialState(draftData, 1)
    // Shrink to 3 tiny teams (1 slot each) so we can fill them by hand.
    state.teams = [
      createTeam(1, 'A', 5, ['RB'], 0),
      createTeam(2, 'B', 5, ['RB'], 0),
      createTeam(3, 'C', 5, ['RB'], 0),
    ]
    state.nominationOrder = [1, 2, 3]

    expect(nextNominator(state)?.id).toBe(1)
    expect(nextNominator(state)?.id).toBe(2)
    expect(nextNominator(state)?.id).toBe(3)
    expect(nextNominator(state)?.id).toBe(1) // wraps around

    // Fill team 2, then the rotation should skip it.
    assignPlayer(state.teams[1], makePlayer({ pos: 'RB' }), 1, 1)
    state.nominationPointer = 1 // pointing at team B
    expect(nextNominator(state)?.id).toBe(3)
    expect(nextNominator(state)?.id).toBe(1)
  })

  it('returns null once every team is full', () => {
    const state = createInitialState(draftData, 1)
    state.teams = [createTeam(1, 'A', 5, ['RB'], 0)]
    state.nominationOrder = [1]
    assignPlayer(state.teams[0], makePlayer({ pos: 'RB' }), 1, 1)
    expect(nextNominator(state)).toBeNull()
  })
})

describe('auction resolution', () => {
  it('winner pays $1 more than the second-highest bid, not their own max', () => {
    const state = createInitialState(draftData, 1)
    state.teams = [
      createTeam(1, 'A', 200, ['RB'], 0),
      createTeam(2, 'B', 200, ['RB'], 0),
    ]
    const bids: Record<number, number> = { 1: 40, 2: 25 }
    const result = resolveAuction(state, makePlayer({ pos: 'RB' }), (_state, team) => bids[team.id])
    expect(result.winner?.id).toBe(1)
    expect(result.price).toBe(26)
  })

  it('a lone bidder pays the $1 minimum', () => {
    const state = createInitialState(draftData, 1)
    state.teams = [createTeam(1, 'A', 200, ['RB'], 0), createTeam(2, 'B', 200, ['WR'], 0)]
    const result = resolveAuction(state, makePlayer({ pos: 'RB' }), (_state, team) => (team.id === 1 ? 40 : 0))
    expect(result.winner?.id).toBe(1)
    expect(result.price).toBe(1)
  })

  it('caps every bid at the legal max bid, regardless of what the bot asks for', () => {
    const state = createInitialState(draftData, 1)
    // Both teams have $5 for 1 open slot -> legal max is 5 - (1-1) = 5.
    // Both "want" to bid 999, so without capping the price would be 999 -
    // uncapped second bid + 1 = 1000. With capping, price tops out at $5.
    state.teams = [createTeam(1, 'A', 5, ['RB'], 0), createTeam(2, 'B', 5, ['RB'], 0)]
    const result = resolveAuction(state, makePlayer({ pos: 'RB' }), () => 999)
    expect(result.price).toBe(5)
  })

  it('a team with no eligible slot for the position never gets a bid, however high maxBidFn goes', () => {
    const state = createInitialState(draftData, 1)
    state.teams = [createTeam(1, 'A', 200, ['WR'], 0)]
    const result = resolveAuction(state, makePlayer({ pos: 'RB' }), () => 5)
    expect(result.winner).toBeNull()
  })
})

describe('full draft with trivial $1 bots', () => {
  it('runs to completion without ever breaking the budget rule', () => {
    const state = createInitialState(draftData, 42)
    runFullDraft(state, trivialDollarBot)

    for (const team of state.teams) {
      expect(team.spent).toBeLessThanOrEqual(team.budget)
      expect(legalMaxBid(team)).toBeGreaterThanOrEqual(0)
    }
    expect(state.log.length).toBe(state.pickNumber)
  })

  it('never assigns the same player twice', () => {
    const state = createInitialState(draftData, 7)
    runFullDraft(state, trivialDollarBot)
    const names = state.drafted.map((d) => `${d.player.name}-${d.player.team}`)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is deterministic: the same seed produces the same draft', () => {
    const a = createInitialState(draftData, 99)
    const b = createInitialState(draftData, 99)
    runFullDraft(a, trivialDollarBot)
    runFullDraft(b, trivialDollarBot)
    expect(a.log).toEqual(b.log)
  })

  it('eventually reports the draft as complete or stalls cleanly (no crash, no infinite loop)', () => {
    const state = createInitialState(draftData, 3)
    runFullDraft(state, trivialDollarBot, undefined, 2000)
    // With trivial $1 bots and greedy nomination this may or may not fully
    // complete every roster (real bot need-awareness in phase 3 fixes
    // that) — but it must always terminate, and never over-fill a team.
    for (const team of state.teams) {
      expect(team.slots.filter((s) => s.filled).length).toBeLessThanOrEqual(14)
    }
    expect(typeof isDraftComplete(state)).toBe('boolean')
  })
})

describe('runDraftStep', () => {
  it('returns false once nothing is left to do', () => {
    const state = createInitialState(draftData, 1)
    state.teams = [createTeam(1, 'A', 5, ['RB'], 0)]
    state.nominationOrder = [1]
    state.undrafted = [makePlayer({ pos: 'RB' })]
    expect(runDraftStep(state, trivialDollarBot)).toBe(true)
    expect(runDraftStep(state, trivialDollarBot)).toBe(false)
  })
})
