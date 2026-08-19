// Shapes of the data in src/data/stafford_draft_data_raw.json (spec §2, as
// amended by REVISIONS.md change 1: no personal ranking fields — the data
// file has none, and the app must not add its own — and by
// RAW_DATA_ADDENDUM.md: the file now carries every individual historical
// pick rather than pre-summarized calibration curves, so bots can draw
// their noise from what actually happened instead of a fitted
// distribution).

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'DEF'
export type FlexEligiblePosition = 'RB' | 'WR' | 'TE'

export interface LeagueMeta {
  league: string
  teams: number
  budget: number
  rosterSpots: number
  starters: string[]
  flexEligible: FlexEligiblePosition[]
  bench: number
  totalPool: number
  historySeasons: number[]
  generated: string
}

// One historical season's summary, kept alongside the raw picks for
// resampling (RAW_DATA_ADDENDUM.md's Method B) or quick sanity checks.
// `byPos` and `pricesDesc` are NOT keeper-filtered — RAW_DATA_ADDENDUM.md's
// format notes are explicit that keeper prices run below market, so
// modelling code should derive its own filtered vectors from `rawPicks`
// (see historicalResiduals.ts) rather than reading these directly.
export interface SeasonSummary {
  year: number
  picks: number
  totalSpend: number
  hadKeepers: boolean
  keeperCount: number
  keeperSpend: number
  rosterFormat: string
  pricesDesc: number[]
  auctionPricesDesc: number[]
  byPos: Record<Position | 'K', number[]>
}

// One individual historical pick. `nominationPick` is nomination order,
// not price order — it's what makes timing effects derivable directly
// from the raw data (RAW_DATA_ADDENDUM.md format note 3) instead of
// through a pre-summarized multiplier curve. Seven rows are `--empty--`
// placeholders (a price but no player/position — format note 4) and must
// be filtered out of any positional work, same as `keeper === true` rows.
export interface RawPick {
  year: number
  nominationPick: number
  player: string
  nflTeam: string | null
  pos: Position | null
  salary: number
  keeper: boolean
}

export interface LeagueHistory {
  seasons: SeasonSummary[]
  rawPicks: RawPick[]
  formatNotes: string[]
}

// REVISIONS.md change 2 — the real shape of a Stafford draft (price bands,
// price of the Nth-most-expensive player, top-N share of the pool), used
// as the calibration harness's acceptance criteria. RAW_DATA_ADDENDUM.md:
// "TESTS ONLY — not modelling inputs" — derived from the same raw data,
// for verifying the simulator reproduces reality, not for bots to read.
export interface PriceBand {
  low: number
  high: number | null
  playersPerDraft: number
}

export interface ValidationTargets {
  priceBands: PriceBand[]
  nthMostExpensive: Record<string, number>
  topNShareOfPool: Record<string, number>
  moneyClock: number[]
  avgRosteredByPos: Record<Position, number>
  dollarSpotsPerTeam: number
  note: string
}

export interface PositionalValue {
  key: string
  pos: Position
  rank: number
  tier: number
  target: number
  low: number
  high: number
  sd: number
}

// REVISIONS.md change 1 — no myRank/myValue/edge: the room's market view
// only, not the human's personal opinion of any player.
export interface Player {
  name: string
  team: string
  pos: Position
  marketRank: number
  posRank: number
  yahooAAV: number
  leagueOverall: number
  leaguePositional: number
  blended: number
  tier: number
  sd: number
  matchedYahoo: boolean
}

export interface DraftData {
  meta: LeagueMeta
  leagueHistory: LeagueHistory
  priceCurve: number[]
  positionalValues: PositionalValue[]
  validationTargets: ValidationTargets
  currentPlayers: Player[]
}
