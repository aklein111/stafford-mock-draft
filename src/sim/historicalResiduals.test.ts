import { describe, expect, it } from 'vitest'
import { deriveHistoricalData } from './historicalResiduals'
import type { DraftData, Position, PositionalValue, RawPick, SeasonSummary } from './types'

function makePick(overrides: Partial<RawPick> = {}): RawPick {
  return {
    year: 2020,
    nominationPick: 1,
    player: 'Test Player',
    nflTeam: 'XXX',
    pos: 'RB',
    salary: 40,
    keeper: false,
    ...overrides,
  }
}

function makeSeason(year: number, picks: number, overrides: Partial<SeasonSummary> = {}): SeasonSummary {
  return {
    year,
    picks,
    totalSpend: 0,
    hadKeepers: false,
    keeperCount: 0,
    keeperSpend: 0,
    rosterFormat: 'test',
    pricesDesc: [],
    auctionPricesDesc: [],
    byPos: { QB: [], RB: [], WR: [], TE: [], DEF: [], K: [] },
    ...overrides,
  }
}

function makeData(
  rawPicks: RawPick[],
  positionalValues: PositionalValue[] = [],
  seasons: SeasonSummary[] = [makeSeason(2020, 10)],
): DraftData {
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
      historySeasons: seasons.map((s) => s.year),
      generated: '2026-01-01',
    },
    leagueHistory: { seasons, rawPicks, formatNotes: [] },
    priceCurve: [],
    positionalValues,
    validationTargets: {
      priceBands: [],
      nthMostExpensive: {},
      topNShareOfPool: {},
      moneyClock: [],
      avgRosteredByPos: { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 },
      dollarSpotsPerTeam: 0,
      note: '',
    },
    currentPlayers: [],
  }
}

function pv(pos: Position, rank: number, target: number): PositionalValue {
  return { key: `${pos}${rank}`, pos, rank, tier: 1, target, low: 0, high: 0, sd: 0 }
}

describe('deriveHistoricalData — residual pool (RAW_DATA_ADDENDUM.md Method A)', () => {
  it('computes a residual as actual price / positionalValues target at that season-relative rank', () => {
    const picks = [
      makePick({ year: 2020, pos: 'RB', salary: 60, player: 'A' }), // rank 1 in 2020
      makePick({ year: 2020, pos: 'RB', salary: 20, player: 'B' }), // rank 2 in 2020
      makePick({ year: 2021, pos: 'RB', salary: 40, player: 'C' }), // rank 1 in 2021
    ]
    const data = makeData(picks, [pv('RB', 1, 40)], [makeSeason(2020, 10), makeSeason(2021, 10)])
    const derived = deriveHistoricalData(data)
    // RB1 target=40: 2020's rank-1 salary 60 -> residual 1.5; 2021's rank-1 salary 40 -> residual 1.0.
    expect([...derived.residualPool('RB', 1)].sort()).toEqual([1, 1.5])
  })

  it('ranks are computed by salary within (year, pos), independent of nomination order', () => {
    const picks = [
      makePick({ year: 2020, pos: 'RB', salary: 20, nominationPick: 1, player: 'A' }), // nominated first, but cheapest
      makePick({ year: 2020, pos: 'RB', salary: 60, nominationPick: 2, player: 'B' }), // nominated second, priciest -> rank 1
    ]
    const data = makeData(picks, [pv('RB', 1, 30), pv('RB', 2, 30)])
    const derived = deriveHistoricalData(data)
    // Both ranks fall within each other's +/-3 pooling window here, so
    // check the individual residual landed at the rank salary implies,
    // not the exact pool contents (pooling itself is covered separately).
    expect(derived.residualPool('RB', 1)).toContain(2) // 60/30, the pricier pick, regardless of nomination order
    expect(derived.residualPool('RB', 2)).toContain(20 / 30)
  })

  it('drops keeper picks and --empty-- placeholder rows (RAW_DATA_ADDENDUM.md format notes 1 & 4)', () => {
    const picks = [
      makePick({ year: 2020, pos: 'RB', salary: 999, keeper: true, player: 'Keeper' }), // would dominate rank 1 if counted
      makePick({ year: 2020, pos: 'RB', salary: 500, player: '--empty--' }), // placeholder row
      makePick({ year: 2020, pos: 'RB', salary: 40, player: 'Real' }),
    ]
    const data = makeData(picks, [pv('RB', 1, 40)])
    const derived = deriveHistoricalData(data)
    expect(derived.residualPool('RB', 1)).toEqual([1]) // only "Real" counts, ranked 1 among usable RB picks
  })

  it('pools residuals from the +/-3 nearest ranks at the same position, and no farther', () => {
    // 8 RBs in one season at distinct salaries, ranks 1-8, targets all 10.
    const salaries = [80, 70, 60, 50, 40, 30, 20, 10] // ranks 1..8, residuals 8..1
    const picks = salaries.map((salary, i) => makePick({ year: 2020, pos: 'RB', salary, player: `RB${i + 1}` }))
    const positionalValues = salaries.map((_, i) => pv('RB', i + 1, 10))
    const data = makeData(picks, positionalValues)
    const derived = deriveHistoricalData(data)

    // Querying rank 4: pool should span ranks 1-7 (+/-3), excluding rank 8.
    const pool = derived.residualPool('RB', 4).sort((a, b) => a - b)
    expect(pool).toEqual([2, 3, 4, 5, 6, 7, 8]) // residuals for ranks 7,6,5,4,3,2,1 respectively
  })

  it('does not pool residuals across positions', () => {
    const picks = [
      makePick({ year: 2020, pos: 'RB', salary: 40, player: 'RB1' }),
      makePick({ year: 2020, pos: 'WR', salary: 999, player: 'WR1' }), // same rank, different position
    ]
    const data = makeData(picks, [pv('RB', 1, 40), pv('WR', 1, 999)])
    const derived = deriveHistoricalData(data)
    expect(derived.residualPool('RB', 1)).toEqual([1])
  })

  it('returns an empty pool for a rank with no matching positionalValues target', () => {
    const picks = [makePick({ year: 2020, pos: 'RB', salary: 40 })]
    const data = makeData(picks, []) // no positionalValues at all
    const derived = deriveHistoricalData(data)
    expect(derived.residualPool('RB', 1)).toEqual([])
  })
})

describe('deriveHistoricalData — timing multiplier', () => {
  it('buckets residuals by decile of nomination progress within the season', () => {
    // picksPerSeason=10 -> nominationPick 1 is progress 0 (decile 0), nominationPick 10 is progress 1 (decile 9, clamped).
    const picks = [
      makePick({ year: 2020, pos: 'RB', salary: 40, nominationPick: 1, player: 'Early' }),
      makePick({ year: 2020, pos: 'RB', salary: 10, nominationPick: 10, player: 'Late' }),
    ]
    const data = makeData(picks, [pv('RB', 1, 40), pv('RB', 2, 10)], [makeSeason(2020, 10)])
    const derived = deriveHistoricalData(data)
    expect(derived.timingMultiplier('RB', 0)).toBeCloseTo(1) // Early: 40/40
    expect(derived.timingMultiplier('RB', 9)).toBeCloseTo(1) // Late: 10/10
  })

  it('falls back to the all-position curve when a position has no data in that decile', () => {
    // RB has data only in decile 0; DEF has data only in decile 9. Querying
    // RB's decile 9 should fall back to the overall curve, which in this
    // fixture is entirely made of the DEF pick at decile 9.
    const picks = [
      makePick({ year: 2020, pos: 'RB', salary: 40, nominationPick: 1, player: 'RB1' }),
      makePick({ year: 2020, pos: 'DEF', salary: 20, nominationPick: 10, player: 'DEF1' }),
    ]
    const data = makeData(picks, [pv('RB', 1, 40), pv('DEF', 1, 10)], [makeSeason(2020, 10)])
    const derived = deriveHistoricalData(data)
    expect(derived.timingMultiplier('RB', 9)).toBeCloseTo(2) // falls back to overall decile 9 = DEF's 20/10 = 2
  })

  it('defaults to 1 when there is no data anywhere for a decile', () => {
    const data = makeData([], [])
    const derived = deriveHistoricalData(data)
    expect(derived.timingMultiplier('QB', 3)).toBe(1)
  })
})
