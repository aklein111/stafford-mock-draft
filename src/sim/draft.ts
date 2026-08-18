// Wires every piece from spec §3 together into one runnable draft: real
// bot personalities and private valuations (§3.1-§3.2), situational
// bidding (§3.3-§3.5), and nomination strategy (§3.7). This is what the
// phase 4 calibration harness runs 200 times headless, and what the
// phase 5 UI will eventually drive interactively for the 11 bot seats.

import type { DraftData } from './types'
import { createInitialState, type DraftState } from './draftState'
import { createBotStates, createRealBotMaxBidFn } from './bots'
import { createBotNominationStrategy } from './nomination'
import { runFullDraft } from './engine'

export interface CalibrationOverrides {
  noiseK?: number
  centering?: number
}

export function createFullBotDraft(
  data: DraftData,
  seed: number,
  teamNames?: string[],
  overrides?: CalibrationOverrides,
): DraftState {
  const state = createInitialState(data, seed, teamNames)
  const teamIds = state.teams.map((t) => t.id)
  const botStates = createBotStates(teamIds, data.players, state.rng, overrides?.noiseK, overrides?.centering)
  const maxBidFn = createRealBotMaxBidFn(botStates)
  const nominate = createBotNominationStrategy(botStates)
  runFullDraft(state, maxBidFn, nominate)
  return state
}
