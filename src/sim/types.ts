// Shapes of the data in src/data/stafford_draft_data.json (spec §2, as
// amended by REVISIONS.md change 1: no personal ranking fields — the data
// file has none, and the app must not add its own).

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

export interface PositionTiming {
  early: number
  mid: number
  late: number
}

// REVISIONS.md change 2 — the real shape of a Stafford draft (price bands,
// price of the Nth-most-expensive player, top-N share of the pool), used
// as the calibration harness's acceptance criteria.
export interface PriceBand {
  low: number
  high: number | null
  playersPerDraft: number
}

export interface CalibrationTargets {
  priceBands: PriceBand[]
  nthMostExpensive: Record<string, number>
  topNShareOfPool: Record<string, number>
  note: string
}

export interface Calibration {
  baselineInflation: number
  moneyClock: number[]
  timingMultiplier: number[]
  positionTiming: Record<Position, PositionTiming>
  avgRosteredByPos: Record<Position, number>
  dollarSpotsPerTeam: number
  targets: CalibrationTargets
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
  calibration: Calibration
  priceCurve: number[]
  positionalValues: PositionalValue[]
  players: Player[]
}
