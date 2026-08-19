import { describe, expect, it } from 'vitest'
import type { RNG } from './rng'
import { mulberry32 } from './rng'
import { assignPlayer, createTeam } from './roster'
import { createInitialState } from './draftState'
import type { DraftData, Player } from './types'
import { CENTERING } from './constants'
import {
  buildBotValuations,
  computeInflation,
  inflationFactor,
  isPoorPerSlot,
  needFactor,
  playerKey,
  rollLockIn,
  timingFactor,
} from './valuation'
import type { BotTraits } from './botTraits'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    name: 'Test Player',
    team: 'XXX',
    pos: 'RB',
    marketRank: 1,
    posRank: 1,
    yahooAAV: 40,
    leagueOverall: 40,
    leaguePositional: 40,
    blended: 40,
    tier: 1,
    sd: 5,
    matchedYahoo: true,
    ...overrides,
  }
}

const neutralTraits: BotTraits = {
  aggression: 1,
  positionBias: { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 },
  starPreference: 0,
  disciplineDecay: 1,
  noiseScale: 1,
  restraint: 1, // unused by valuation.ts's formulas; included only to satisfy the type
}

// RAW_DATA_ADDENDUM.md Method A replaced the additive normal-noise term
// with a residual sampled from a per-(pos,rank) empirical pool — an empty
// pool means buildBotValuations falls back to a residual of exactly 1
// (see valuation.ts), which is the "zero noise" case these formula-shape
// tests want. The detailed pooling/sampling behavior itself is covered in
// historicalResiduals.test.ts.
function noResidualPool(): number[] {
  return []
}

// Only used where a test needs an actual RNG value threaded through (none
// of the formula-shape tests below do, since noResidualPool short-circuits
// the sampling), kept for tests elsewhere in this file that need a real RNG.
function zeroNoiseRng(): RNG {
  const seq = [0.5, 0.25]
  let i = 0
  return () => seq[i++ % seq.length]
}

// Minimal but real DraftData so computeInflation/needFactor/etc. have a
// real shape to read; leagueHistory/positionalValues/validationTargets are
// left empty here since these tests don't exercise timingFactor (see the
// dedicated fixture below for that).
function makeMiniData(): DraftData {
  return {
    meta: {
      league: 'Test',
      teams: 2,
      budget: 20,
      rosterSpots: 2,
      starters: ['RB', 'WR'],
      flexEligible: ['RB', 'WR', 'TE'],
      bench: 0,
      totalPool: 40,
      historySeasons: [2024],
      generated: '2026-01-01',
    },
    leagueHistory: { seasons: [], rawPicks: [], formatNotes: [] },
    priceCurve: [4, 1, 1, 1],
    positionalValues: [],
    validationTargets: {
      priceBands: [],
      nthMostExpensive: {},
      topNShareOfPool: {},
      moneyClock: [],
      avgRosteredByPos: { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 },
      dollarSpotsPerTeam: 0,
      note: '',
    },
    currentPlayers: [],
  }
}

describe('buildBotValuations (spec §3.2, adjusted per RAW_DATA_ADDENDUM.md Method A)', () => {
  // These formula-shape tests pass noiseK=1, centering=0 explicitly so
  // they stay decoupled from constants.ts's tuned production CENTERING
  // (see constants.ts and scripts/calibrate.ts for how that was chosen),
  // and an empty residual pool so the noise term is a no-op (residual 1).
  it('with neutral traits, no residual pool, and zero centering, values equal the blended price', () => {
    const players = [makePlayer({ name: 'A', blended: 40 }), makePlayer({ name: 'B', blended: 10 })]
    const values = buildBotValuations(players, neutralTraits, zeroNoiseRng(), noResidualPool, 1, 0)
    expect(values.get(playerKey(players[0]))).toBeCloseTo(40)
    expect(values.get(playerKey(players[1]))).toBeCloseTo(10)
  })

  it('positionBias scales the valuation for that position only', () => {
    const traits: BotTraits = { ...neutralTraits, positionBias: { ...neutralTraits.positionBias, RB: 1.2 } }
    const players = [makePlayer({ name: 'A', pos: 'RB', blended: 40 }), makePlayer({ name: 'B', pos: 'WR', blended: 40 })]
    const values = buildBotValuations(players, traits, zeroNoiseRng(), noResidualPool, 1, 0)
    expect(values.get(playerKey(players[0]))).toBeCloseTo(48)
    expect(values.get(playerKey(players[1]))).toBeCloseTo(40)
  })

  it('centering shifts every valuation by a flat dollar amount', () => {
    const players = [makePlayer({ name: 'A', blended: 40 }), makePlayer({ name: 'B', blended: 10 })]
    const values = buildBotValuations(players, neutralTraits, zeroNoiseRng(), noResidualPool, 1, 3)
    expect(values.get(playerKey(players[0]))).toBeCloseTo(43)
    expect(values.get(playerKey(players[1]))).toBeCloseTo(13)
  })

  it('defaults to the tuned CENTERING constant when not explicitly overridden', () => {
    const player = makePlayer({ blended: 40 })
    const values = buildBotValuations([player], neutralTraits, zeroNoiseRng(), noResidualPool)
    expect(values.get(playerKey(player))).toBeCloseTo(40 + CENTERING)
  })

  it('never returns a negative valuation', () => {
    const traits: BotTraits = { ...neutralTraits, aggression: -1 } // absurd on purpose, just to force a negative raw value
    const values = buildBotValuations([makePlayer({ blended: 40 })], traits, zeroNoiseRng(), noResidualPool)
    expect([...values.values()][0]).toBeGreaterThanOrEqual(0)
  })

  it('samples a residual from the pool and scales its deviation from 1 by noiseScale x noiseK', () => {
    // A pool with a single residual of 2 (double the smoothed target) and
    // an RNG that always picks index 0 -> rawResidual = 2. With
    // noiseScale=1 and noiseK=0.5, the applied residual is 1 + (2-1)*0.5 = 1.5.
    const pickFirst: RNG = () => 0 // Math.floor(0 * pool.length) = 0
    const traits: BotTraits = { ...neutralTraits, noiseScale: 1 }
    const values = buildBotValuations([makePlayer({ blended: 40 })], traits, pickFirst, () => [2], 0.5, 0)
    expect([...values.values()][0]).toBeCloseTo(40 * 1.5)
  })
})

describe('timingFactor (spec §4.1, adjusted per RAW_DATA_ADDENDUM.md)', () => {
  // The old fixed positionTiming/timingMultiplier data no longer exists —
  // timingFactor now delegates to historicalResiduals.ts's derivation from
  // leagueHistory.rawPicks, whose behavior is covered thoroughly in
  // historicalResiduals.test.ts. This just checks the wiring: pickNumber
  // maps to the right decile, and that decile's derived value comes back.
  function makeTimingData(): DraftData {
    const data = makeMiniData()
    data.positionalValues = [
      { key: 'RB1', pos: 'RB', rank: 1, tier: 1, target: 40, low: 0, high: 0, sd: 0 },
      { key: 'RB2', pos: 'RB', rank: 2, tier: 1, target: 10, low: 0, high: 0, sd: 0 },
    ]
    data.leagueHistory = {
      seasons: [
        {
          year: 2020,
          picks: 10,
          totalSpend: 0,
          hadKeepers: false,
          keeperCount: 0,
          keeperSpend: 0,
          rosterFormat: 'test',
          pricesDesc: [],
          auctionPricesDesc: [],
          byPos: { QB: [], RB: [], WR: [], TE: [], DEF: [], K: [] },
        },
      ],
      rawPicks: [
        { year: 2020, nominationPick: 1, player: 'Early', nflTeam: 'X', pos: 'RB', salary: 60, keeper: false }, // decile 0, residual 1.5
        { year: 2020, nominationPick: 10, player: 'Late', nflTeam: 'X', pos: 'RB', salary: 5, keeper: false }, // decile 9, residual 0.5
      ],
      formatNotes: [],
    }
    return data
  }

  it('maps an early pickNumber to a low decile', () => {
    const data = makeTimingData()
    const state = createInitialState(data, 1)
    state.pickNumber = 0
    expect(timingFactor(state, 'RB')).toBeCloseTo(1.5)
  })

  it('maps a late pickNumber to a high decile', () => {
    const data = makeTimingData()
    const state = createInitialState(data, 1)
    const totalSlots = data.meta.teams * data.meta.rosterSpots
    state.pickNumber = totalSlots
    expect(timingFactor(state, 'RB')).toBeCloseTo(0.5)
  })
})

describe('computeInflation / inflationFactor (spec §4.2)', () => {
  it('is 1 (no inflation) when remaining budget matches remaining blended value', () => {
    const data = makeMiniData()
    const state = createInitialState(data, 1)
    state.undrafted = [makePlayer({ blended: 20 }), makePlayer({ name: 'B', blended: 20 })]
    // 2 teams x $20 = $40 remaining budget; undrafted blended sums to $40.
    expect(computeInflation(state)).toBeCloseTo(1)
    expect(inflationFactor(computeInflation(state))).toBeCloseTo(1)
  })

  it('rises above 1 when there is more money left than nominal value left, and the damping softens it', () => {
    const data = makeMiniData()
    const state = createInitialState(data, 1)
    state.undrafted = [makePlayer({ blended: 10 })]
    // $40 remaining budget vs $10 remaining blended -> inflation = 4.
    const inflation = computeInflation(state)
    expect(inflation).toBeCloseTo(4)
    // Damping factor is 1 + 0.6*(4-1) = 2.8, well short of a full 4x reaction.
    expect(inflationFactor(inflation)).toBeCloseTo(2.8)
  })
})

describe('needFactor (spec §3.4)', () => {
  // Budgets below are picked to stay under the "$8+ per remaining slot"
  // rich-team bonus (§3.4's last bullet), so each test isolates just the
  // one adjustment it's checking — that bonus is meant to stack with the
  // others, not replace them, and has its own dedicated test below.
  it('is 1.00 when the player would fill their own dedicated starter slot', () => {
    const team = createTeam(1, 'A', 28, ['RB', 'WR'], 2) // $28 / 4 slots = $7/slot
    expect(needFactor(team, makePlayer({ pos: 'RB' }), 1)).toBeCloseTo(1.0)
  })

  it('drops to 0.80 when only FLEX/BENCH would be filled', () => {
    const team = createTeam(1, 'A', 28, ['RB', 'WR', 'FLEX'], 2)
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 10, 1) // $18 left / 3 slots = $6/slot
    // RB starter is full; an RB now only fills FLEX or BENCH.
    expect(needFactor(team, makePlayer({ pos: 'RB' }), 1)).toBeCloseTo(0.8)
  })

  it('boosts above 1.0 late in the draft with an unfilled starter, scaled by disciplineDecay', () => {
    // 1 starter (TE) left open, budget/roster small so "remaining < 4" holds.
    const team = createTeam(1, 'A', 20, ['TE'], 2) // $20 / 3 slots = $6.7/slot, under the rich threshold
    const lowDecay = needFactor(team, makePlayer({ pos: 'TE' }), 0.5)
    const highDecay = needFactor(team, makePlayer({ pos: 'TE' }), 1.5)
    expect(highDecay).toBeGreaterThan(lowDecay)
    expect(highDecay).toBeLessThanOrEqual(1.25 + 1e-9)
  })

  it('stacks the rich-team 5% bonus on top of the base factor when budget per slot is high', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR'], 2) // $200 / 4 slots = $50/slot, well over $8
    expect(needFactor(team, makePlayer({ pos: 'RB' }), 1)).toBeCloseTo(1.05)
  })

  it('a backup QB gets its own (lower) factor, distinct from the flex/bench rate', () => {
    const team = createTeam(1, 'A', 28, ['QB'], 2) // $28 / 3 slots = $9.3/slot -> triggers the rich bonus
    assignPlayer(team, makePlayer({ name: 'QB1', pos: 'QB' }), 5, 1) // starter QB filled; one bench slot is QB-eligible
    // Without the override this would be BACKUP_QB_NEED_FACTOR from constants.ts; passing 0.3 explicitly
    // decouples this test from that tuned value, matching the pattern used for noiseK/centering elsewhere.
    expect(needFactor(team, makePlayer({ pos: 'QB' }), 1, 0.3)).toBeCloseTo(0.3 * 1.05)
  })

  it('a bench RB/WR/TE still gets the ordinary flex/bench factor, unaffected by backupQbFactor', () => {
    const team = createTeam(1, 'A', 28, ['RB'], 2)
    assignPlayer(team, makePlayer({ name: 'RB1', pos: 'RB' }), 5, 1)
    expect(needFactor(team, makePlayer({ pos: 'RB' }), 1, 0.1)).toBeCloseTo(0.8 * 1.05)
  })
})

describe('isPoorPerSlot (spec §3.4)', () => {
  it('flags a team with less than $2 per remaining slot', () => {
    const team = createTeam(1, 'A', 3, ['RB', 'WR'], 0) // $3 for 2 slots = $1.50/slot
    expect(isPoorPerSlot(team)).toBe(true)
  })

  it('does not flag a team with plenty of budget per slot', () => {
    const team = createTeam(1, 'A', 200, ['RB', 'WR'], 0)
    expect(isPoorPerSlot(team)).toBe(false)
  })
})

describe('rollLockIn (spec §3.5)', () => {
  it('returns 1 (no boost) when the roll is above the lock-in probability', () => {
    const rng = () => 0.99
    expect(rollLockIn(rng)).toBe(1)
  })

  it('returns a 10-25% boost when the roll hits the lock-in chance', () => {
    const seq = [0.01, 0.5] // first roll wins the 8% chance, second picks a spot in the boost range
    let i = 0
    const rng = () => seq[i++]
    const boost = rollLockIn(rng)
    expect(boost).toBeGreaterThanOrEqual(1.1)
    expect(boost).toBeLessThanOrEqual(1.25)
  })

  it('is deterministic for a fixed seed', () => {
    expect(rollLockIn(mulberry32(5))).toBe(rollLockIn(mulberry32(5)))
  })
})
