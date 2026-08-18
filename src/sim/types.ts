// Shapes of the data in src/data/stafford_draft_data.json (spec §2).

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

export interface Calibration {
  baselineInflation: number
  note: string
  moneyClock: number[]
  timingMultiplier: number[]
  positionTiming: Record<Position, PositionTiming>
  avgRosteredByPos: Record<Position, number>
  dollarSpotsPerTeam: number
  positionScheme: Record<Position, string>
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

export interface Player {
  name: string
  team: string
  pos: Position
  myRank: number
  myValue: number
  yahooAAV: number
  consensusRank: number
  consensusPosRank: number
  leaguePosTarget: number
  expected: number
  edge: number
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
