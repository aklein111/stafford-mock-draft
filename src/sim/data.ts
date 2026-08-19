import raw from '../data/stafford_draft_data_raw.json'
import type { DraftData } from './types'

// The JSON file is loaded once, at import time (spec §2: "Load it once at
// startup"). We cast it through `unknown` because TypeScript can't verify a
// JSON file matches our hand-written types — validate() below does a
// lightweight runtime sanity check instead.
export const draftData = raw as unknown as DraftData

export function validateDraftData(data: DraftData): void {
  if (!data.meta || !Array.isArray(data.currentPlayers) || !Array.isArray(data.priceCurve)) {
    throw new Error('stafford_draft_data_raw.json is missing required fields (meta/currentPlayers/priceCurve)')
  }
  if (data.currentPlayers.length === 0) {
    throw new Error('stafford_draft_data_raw.json has no currentPlayers')
  }
  if (!data.leagueHistory || !Array.isArray(data.leagueHistory.rawPicks) || data.leagueHistory.rawPicks.length === 0) {
    throw new Error('stafford_draft_data_raw.json is missing leagueHistory.rawPicks')
  }
  const expectedSlots = data.meta.teams * data.meta.rosterSpots
  if (data.priceCurve.length !== expectedSlots) {
    throw new Error(
      `priceCurve has ${data.priceCurve.length} entries but ${data.meta.teams} teams x ${data.meta.rosterSpots} roster spots = ${expectedSlots}`,
    )
  }
}

validateDraftData(draftData)
