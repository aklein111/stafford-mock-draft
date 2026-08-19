import type { DraftData, Player } from './types'
import { createTeam, type Team, type DraftedPick } from './roster'
import { mulberry32, type RNG } from './rng'

export interface DraftState {
  data: DraftData
  teams: Team[]
  undrafted: Player[]
  drafted: DraftedPick[]
  pickNumber: number
  // Fixed team-id rotation, e.g. [1, 2, ..., 12]. Nomination cycles through
  // this in order, skipping any team whose roster is already full.
  nominationOrder: number[]
  nominationPointer: number
  rng: RNG
  log: string[]
}

export function createInitialState(data: DraftData, seed: number, teamNames?: string[]): DraftState {
  const teamCount = data.meta.teams
  const teams: Team[] = []
  for (let i = 0; i < teamCount; i++) {
    teams.push(
      createTeam(i + 1, teamNames?.[i] ?? `Team ${i + 1}`, data.meta.budget, data.meta.starters, data.meta.bench),
    )
  }
  return {
    data,
    teams,
    undrafted: [...data.currentPlayers],
    drafted: [],
    pickNumber: 0,
    nominationOrder: teams.map((t) => t.id),
    nominationPointer: 0,
    rng: mulberry32(seed),
    log: [],
  }
}
