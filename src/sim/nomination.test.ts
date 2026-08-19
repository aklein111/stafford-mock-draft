import { describe, expect, it } from 'vitest'
import { assignPlayer, createTeam } from './roster'
import { createInitialState } from './draftState'
import { draftData } from './data'
import { createBotNominationStrategy } from './nomination'
import type { BotState } from './bots'
import type { Player } from './types'
import { playerKey } from './valuation'

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

// A fixed sequence of return values, one per rng() call.
function scriptedRng(values: number[]) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('bot nomination strategy (spec §3.7)', () => {
  it('budget drain: nominates a player at a position the team cannot use', () => {
    const state = createInitialState(draftData, 1)
    const nominator = createTeam(1, 'A', 200, ['RB', 'WR'], 0)
    assignPlayer(nominator, makePlayer({ name: 'RB1', pos: 'RB' }), 10, 1) // RB now full
    state.teams = [nominator]

    const rbCandidate = makePlayer({ name: 'ExpensiveRB', pos: 'RB', blended: 50 })
    const wrCandidate = makePlayer({ name: 'SomeWR', pos: 'WR', blended: 10 })
    state.undrafted = [rbCandidate, wrCandidate]
    state.rng = scriptedRng([0.1, 0.5]) // 0.1 < 0.45 -> budget drain

    const strategy = createBotNominationStrategy([])
    const nominated = strategy(state, nominator)
    expect(nominated?.name).toBe('ExpensiveRB') // the only player this team can't use
  })

  it('value grab: nominates a player the bot wants, when flush relative to the room', () => {
    const state = createInitialState(draftData, 1)
    const flush = createTeam(1, 'A', 200, ['RB', 'WR'], 0) // $100/slot
    const poor = createTeam(2, 'B', 20, ['RB', 'WR'], 0) // $10/slot, drags the average down
    state.teams = [flush, poor]

    const wanted = makePlayer({ name: 'WantedWR', pos: 'WR', blended: 30 })
    const unwanted = makePlayer({ name: 'FullPositionRB', pos: 'RB', blended: 60 })
    assignPlayer(flush, makePlayer({ name: 'RB1', pos: 'RB' }), 10, 1) // flush team's RB slot is full
    state.undrafted = [wanted, unwanted]
    state.rng = scriptedRng([0.5, 0.5]) // between 0.45 and 0.75 -> value grab

    const botState: BotState = {
      teamId: 1,
      archetype: 'NEUTRAL',
      traits: { aggression: 1, positionBias: { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 }, starPreference: 0, disciplineDecay: 1, noiseScale: 1, restraint: 1 },
      valuations: new Map([[playerKey(wanted), 30], [playerKey(unwanted), 60]]),
      budgetPlanArchetype: 'BALANCED',
      budgetPlan: new Array(14).fill(200 / 14),
    }

    const strategy = createBotNominationStrategy([botState])
    const nominated = strategy(state, flush)
    expect(nominated?.name).toBe('WantedWR') // the only player flush's roster can still use
  })

  it('need fill: nominates to plug an open starting slot', () => {
    const state = createInitialState(draftData, 1)
    const nominator = createTeam(1, 'A', 200, ['RB', 'TE'], 0)
    assignPlayer(nominator, makePlayer({ name: 'RB1', pos: 'RB' }), 10, 1) // only TE starter open

    const tePlayer = makePlayer({ name: 'OpenHoleTE', pos: 'TE', blended: 15 })
    const rbPlayer = makePlayer({ name: 'AlreadyFullRB', pos: 'RB', blended: 15 })
    state.teams = [nominator]
    state.undrafted = [tePlayer, rbPlayer]
    state.rng = scriptedRng([0.8, 0.5]) // between 0.75 and 0.90 -> need fill

    const strategy = createBotNominationStrategy([])
    const nominated = strategy(state, nominator)
    expect(nominated?.name).toBe('OpenHoleTE')
  })

  it('random: falls back to a uniform pick from the pool', () => {
    const state = createInitialState(draftData, 1)
    const nominator = createTeam(1, 'A', 200, ['RB'], 0)
    state.teams = [nominator]
    const players = [makePlayer({ name: 'P0' }), makePlayer({ name: 'P1' }), makePlayer({ name: 'P2' })]
    state.undrafted = players
    state.rng = scriptedRng([0.95, 0.5]) // >= 0.90 -> random; second roll picks index floor(0.5*3)=1

    const strategy = createBotNominationStrategy([])
    const nominated = strategy(state, nominator)
    expect(nominated?.name).toBe('P1')
  })

  it('returns null once the pool is empty', () => {
    const state = createInitialState(draftData, 1)
    const nominator = createTeam(1, 'A', 200, ['RB'], 0)
    state.teams = [nominator]
    state.undrafted = []
    const strategy = createBotNominationStrategy([])
    expect(strategy(state, nominator)).toBeNull()
  })
})
