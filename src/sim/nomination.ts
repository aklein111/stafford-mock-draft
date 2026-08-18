import type { DraftState } from './draftState'
import { isRosterFull, type Team } from './roster'
import type { Player } from './types'

// Finds the next team in rotation order that still has open roster slots,
// and advances the pointer so the following call continues from there.
// Returns null once every team's roster is full (nothing left to nominate).
export function nextNominator(state: DraftState): Team | null {
  const n = state.nominationOrder.length
  for (let i = 0; i < n; i++) {
    const idx = (state.nominationPointer + i) % n
    const teamId = state.nominationOrder[idx]
    const team = state.teams.find((t) => t.id === teamId)!
    if (!isRosterFull(team)) {
      state.nominationPointer = (idx + 1) % n
      return team
    }
  }
  return null
}

// Placeholder nomination strategy for phases 1-2: always put up the
// highest-`expected` undrafted player. Real bot nomination strategy (budget
// drain / value grab / need fill / random, spec §3.7) replaces this in
// phase 3 — this version exists only to exercise the engine end to end.
export function defaultNominationStrategy(state: DraftState): Player | null {
  if (state.undrafted.length === 0) return null
  let best = state.undrafted[0]
  for (const p of state.undrafted) {
    if (p.expected > best.expected) best = p
  }
  return best
}
