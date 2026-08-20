import { describe, expect, it } from 'vitest'
import { createInitialState } from './draftState'
import { draftData } from './data'
import { createTeam } from './roster'
import { buildPrivateTiers, tierPanicFactor } from './tierPanic'
import { playerKey } from './valuation'
import type { Player } from './types'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    name: 'Test Player',
    team: 'XXX',
    pos: 'RB',
    marketRank: 1,
    posRank: 1,
    yahooAAV: 30,
    leagueOverall: 30,
    leaguePositional: 30,
    blended: 30,
    tier: 1,
    sd: 2,
    matchedYahoo: true,
    ...overrides,
  }
}

function valuationsFor(players: Player[], values: number[]): Map<string, number> {
  return new Map(players.map((p, i) => [playerKey(p), values[i]]))
}

describe('buildPrivateTiers', () => {
  it('groups players whose values sit close together and breaks at a real cliff', () => {
    // 40/38/37 are within 15% of 40; 20 is a cliff; 19 rejoins the new tier.
    const players = [
      makePlayer({ name: 'A' }),
      makePlayer({ name: 'B' }),
      makePlayer({ name: 'C' }),
      makePlayer({ name: 'D' }),
      makePlayer({ name: 'E' }),
    ]
    const tiers = buildPrivateTiers(players, valuationsFor(players, [40, 38, 37, 20, 19]))
    expect(tiers.get(playerKey(players[0]))).toBe(0)
    expect(tiers.get(playerKey(players[1]))).toBe(0)
    expect(tiers.get(playerKey(players[2]))).toBe(0)
    expect(tiers.get(playerKey(players[3]))).toBe(1)
    expect(tiers.get(playerKey(players[4]))).toBe(1)
  })

  it('breaks a long gentle slide into several tiers rather than one giant one', () => {
    // A steady 5%-per-step decline never has a big single gap, but the
    // top and bottom are nothing alike — measuring against the tier's top
    // is what catches that.
    const players = Array.from({ length: 12 }, (_, i) => makePlayer({ name: `P${i}` }))
    const values = players.map((_, i) => 50 * Math.pow(0.95, i))
    const tiers = buildPrivateTiers(players, valuationsFor(players, values))
    const distinct = new Set(players.map((p) => tiers.get(playerKey(p))))
    expect(distinct.size).toBeGreaterThan(1)
    expect(tiers.get(playerKey(players[0]))).toBe(0)
    expect(tiers.get(playerKey(players[11]))).toBeGreaterThan(0)
  })

  it('tiers each position independently', () => {
    const rb = makePlayer({ name: 'RB1', pos: 'RB' })
    const wr = makePlayer({ name: 'WR1', pos: 'WR' })
    // Wildly different values, but each is the best at its own position.
    const tiers = buildPrivateTiers([rb, wr], valuationsFor([rb, wr], [60, 3]))
    expect(tiers.get(playerKey(rb))).toBe(0)
    expect(tiers.get(playerKey(wr))).toBe(0)
  })
})

describe('tierPanicFactor (user report: teams overpay late chasing the last player of a tier)', () => {
  // One tier of RBs, a team that still needs one, and rivals who do too.
  function scenario(opts: { remaining: number; rivals: number; pickNumber: number; proneness?: number }) {
    const state = createInitialState(draftData, 1)
    const me = createTeam(1, 'Me', 200, ['RB'], 0)
    const teams = [me]
    for (let i = 0; i < opts.rivals; i++) teams.push(createTeam(i + 2, `R${i}`, 200, ['RB'], 0))
    state.teams = teams
    state.pickNumber = opts.pickNumber

    const pool = Array.from({ length: opts.remaining }, (_, i) => makePlayer({ name: `RB${i}`, pos: 'RB' }))
    state.undrafted = pool
    const valuations = valuationsFor(pool, pool.map(() => 30)) // all one tier
    const tiers = buildPrivateTiers(pool, valuations)
    return {
      factor: tierPanicFactor(state, me, pool[0], tiers, valuations, opts.proneness ?? 1),
    }
  }

  const LATE = Math.round(draftData.meta.teams * draftData.meta.rosterSpots * 0.85)
  const EARLY = Math.round(draftData.meta.teams * draftData.meta.rosterSpots * 0.1)

  it('does not fire early in the draft, however thin the tier is', () => {
    expect(scenario({ remaining: 1, rivals: 11, pickNumber: EARLY }).factor).toBe(1)
  })

  it('fires late when the tier is nearly gone and the room still wants it', () => {
    expect(scenario({ remaining: 1, rivals: 11, pickNumber: LATE }).factor).toBeGreaterThan(1)
  })

  it('does not fire when supply comfortably covers everyone who wants one', () => {
    expect(scenario({ remaining: 12, rivals: 5, pickNumber: LATE }).factor).toBe(1)
  })

  it('gets stronger as the tier empties out', () => {
    const roomy = scenario({ remaining: 6, rivals: 11, pickNumber: LATE }).factor
    const tight = scenario({ remaining: 2, rivals: 11, pickNumber: LATE }).factor
    const last = scenario({ remaining: 1, rivals: 11, pickNumber: LATE }).factor
    expect(tight).toBeGreaterThan(roomy)
    expect(last).toBeGreaterThan(tight)
  })

  it('gets stronger the later it gets', () => {
    const totalSlots = draftData.meta.teams * draftData.meta.rosterSpots
    const mid = scenario({ remaining: 1, rivals: 11, pickNumber: Math.round(totalSlots * 0.5) }).factor
    const late = scenario({ remaining: 1, rivals: 11, pickNumber: Math.round(totalSlots * 0.95) }).factor
    expect(late).toBeGreaterThan(mid)
  })

  it('scales with the bot\'s own per-draft panic proneness — "certain teams", not all of them', () => {
    const calm = scenario({ remaining: 1, rivals: 11, pickNumber: LATE, proneness: 0 }).factor
    const jumpy = scenario({ remaining: 1, rivals: 11, pickNumber: LATE, proneness: 1 }).factor
    expect(calm).toBe(1)
    expect(jumpy).toBeGreaterThan(1)
  })

  it('never fires for a team with no open slot for the position', () => {
    const state = createInitialState(draftData, 1)
    const full = createTeam(1, 'Me', 200, ['WR'], 0) // no RB slot at all
    state.teams = [full, createTeam(2, 'R', 200, ['RB'], 0)]
    state.pickNumber = LATE
    const pool = [makePlayer({ name: 'RB0', pos: 'RB' })]
    state.undrafted = pool
    const valuations = valuationsFor(pool, [30])
    expect(tierPanicFactor(state, full, pool[0], buildPrivateTiers(pool, valuations), valuations, 1)).toBe(1)
  })

  it('never fires over replacement-level filler, however scarce', () => {
    const state = createInitialState(draftData, 1)
    const me = createTeam(1, 'Me', 200, ['RB'], 0)
    state.teams = [me, createTeam(2, 'R', 200, ['RB'], 0), createTeam(3, 'R2', 200, ['RB'], 0)]
    state.pickNumber = LATE
    const pool = [makePlayer({ name: 'Scrub', pos: 'RB', blended: 1 })]
    state.undrafted = pool
    const valuations = valuationsFor(pool, [1]) // below PANIC_MIN_VALUE
    expect(tierPanicFactor(state, me, pool[0], buildPrivateTiers(pool, valuations), valuations, 1)).toBe(1)
  })
})
