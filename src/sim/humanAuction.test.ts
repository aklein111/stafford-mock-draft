import { describe, expect, it } from 'vitest'
import { createInitialState } from './draftState'
import { draftData } from './data'
import { createTeam } from './roster'
import { computeBotBids, currentStanding, finalizeAuction } from './humanAuction'
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
    expected: 20,
    edge: 0,
    tier: 1,
    sd: 2,
    matchedYahoo: true,
    ...overrides,
  }
}

describe('computeBotBids', () => {
  it('excludes the human team entirely', () => {
    const state = createInitialState(draftData, 1)
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    const bot = createTeam(2, 'Bot', 200, ['RB'], 0)
    state.teams = [human, bot]
    const player = makePlayer()
    const bids = computeBotBids(state, player, () => 15, 1)
    expect(bids).toHaveLength(1)
    expect(bids[0].team.id).toBe(2)
  })
})

describe('currentStanding', () => {
  it('returns null when nobody is bidding', () => {
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    expect(currentStanding([], human, 0)).toBeNull()
  })

  it('the human wins outright when no bots are bidding', () => {
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    const result = currentStanding([], human, 10)
    expect(result?.winner?.id).toBe(1)
    expect(result?.price).toBe(1) // lone bidder pays the $1 minimum
  })

  it('a bot outbids the human when its max exceeds the human bid', () => {
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    const bot = createTeam(2, 'Bot', 200, ['RB'], 0)
    const result = currentStanding([{ team: bot, maxBid: 30 }], human, 10)
    expect(result?.winner?.id).toBe(2)
    expect(result?.price).toBe(11) // $1 more than the human's bid
  })

  it('the human wins by beating the bot, paying $1 more than the bot bid', () => {
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    const bot = createTeam(2, 'Bot', 200, ['RB'], 0)
    const result = currentStanding([{ team: bot, maxBid: 15 }], human, 25)
    expect(result?.winner?.id).toBe(1)
    expect(result?.price).toBe(16)
  })

  it('caps the human bid at their legal max bid', () => {
    const human = createTeam(1, 'Me', 3, ['RB', 'WR'], 0) // legal max = 3 - (2-1) = 2
    const result = currentStanding([], human, 999)
    expect(result?.price).toBe(1) // lone bidder still just pays $1, but capped internally
    const bot = createTeam(2, 'Bot', 200, ['RB'], 0)
    const contested = currentStanding([{ team: bot, maxBid: 50 }], human, 999)
    expect(contested?.winner?.id).toBe(2) // human's real cap (2) loses to the bot's 50
  })

  it('updates live as the human raises their bid, without needing to touch bot bids', () => {
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    const bot = createTeam(2, 'Bot', 200, ['RB'], 0)
    const botBids = [{ team: bot, maxBid: 20 }]
    expect(currentStanding(botBids, human, 5)?.winner?.id).toBe(2)
    expect(currentStanding(botBids, human, 25)?.winner?.id).toBe(1)
  })
})

describe('finalizeAuction', () => {
  it('when the human never bid, behaves like the bot-only resolution (may apply drop-early realism)', () => {
    const state = createInitialState(draftData, 1)
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    const bot = createTeam(2, 'Bot', 200, ['RB'], 0)
    const result = finalizeAuction(state, [{ team: bot, maxBid: 20 }], human, 0)
    expect(result?.winner?.id).toBe(2)
    expect(result?.price).toBeGreaterThanOrEqual(1)
  })

  it('when the human did bid, resolves deterministically with no perturbation', () => {
    const state = createInitialState(draftData, 1)
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    const bot = createTeam(2, 'Bot', 200, ['RB'], 0)
    const result = finalizeAuction(state, [{ team: bot, maxBid: 20 }], human, 30)
    expect(result?.winner?.id).toBe(1)
    expect(result?.price).toBe(21)
  })

  it('returns null when nobody bids at all', () => {
    const state = createInitialState(draftData, 1)
    const human = createTeam(1, 'Me', 200, ['RB'], 0)
    expect(finalizeAuction(state, [], human, 0)).toBeNull()
  })
})
