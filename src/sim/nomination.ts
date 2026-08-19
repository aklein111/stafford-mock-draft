import type { DraftState } from './draftState'
import { canBidOnPosition, isRosterFull, openSlots, type Team } from './roster'
import type { Player } from './types'
import type { RNG } from './rng'
import type { BotState } from './bots'
import { playerKey } from './valuation'
import { NOMINATION_STRATEGY_WEIGHTS, NOMINATION_VALUE_EXPONENT } from './constants'

export type NominationStrategy = (state: DraftState, nominator: Team) => Player | null

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
// highest-`blended` undrafted player. Real bot nomination strategy (§3.7,
// below) replaces this for real drafts — this version exists only to
// exercise the engine end to end without needing bot state.
export function defaultNominationStrategy(state: DraftState): Player | null {
  if (state.undrafted.length === 0) return null
  let best = state.undrafted[0]
  for (const p of state.undrafted) {
    if (p.blended > best.blended) best = p
  }
  return best
}

function dollarsPerSlot(team: Team): number {
  return (team.budget - team.spent) / Math.max(openSlots(team).length, 1)
}

function averageDollarsPerSlot(teams: Team[]): number {
  const active = teams.filter((t) => !isRosterFull(t))
  if (active.length === 0) return 0
  return active.reduce((sum, t) => sum + dollarsPerSlot(t), 0) / active.length
}

// Picks one player from `candidates`, weighted by `weight(player)` (higher
// weight = more likely). Falls back to a uniform pick if every weight is
// zero or the list is empty-safe (callers already guard length 0).
function weightedPick(candidates: Player[], weight: (p: Player) => number, rng: RNG): Player {
  const weights = candidates.map((p) => Math.max(weight(p), 0.0001))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = rng() * total
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

// §3.7 — a bot's turn to nominate. Mixes four strategies: budget drain
// (45%), value grab (30%), need fill (15%), random (10%). Budget-drain and
// value-grab both weight candidates by value, which skews early
// nominations toward high-`blended` players without needing to force it
// separately as a *direction* — but raising that weight to
// NOMINATION_VALUE_EXPONENT is what makes the skew strong enough to match
// how front-loaded real nominations actually are (see constants.ts).
export function createBotNominationStrategy(botStates: BotState[]): NominationStrategy {
  const byTeamId = new Map(botStates.map((b) => [b.teamId, b]))

  return (state, nominator) => {
    const pool = state.undrafted
    if (pool.length === 0) return null

    const bot = byTeamId.get(nominator.id)
    const rng = state.rng
    const roll = rng()
    const { budgetDrain, valueGrab, needFill } = NOMINATION_STRATEGY_WEIGHTS

    // Budget drain: put up an expensive player at a position we're already
    // full at, so the money leaves the room without costing us anything.
    if (roll < budgetDrain) {
      const cantUse = pool.filter((p) => !canBidOnPosition(nominator, p.pos))
      const candidates = cantUse.length > 0 ? cantUse : pool
      return weightedPick(candidates, (p) => p.blended ** NOMINATION_VALUE_EXPONENT, rng)
    }

    // Value grab: put up someone we actually want, but only when we're
    // flush relative to the room (otherwise this just funds a rival).
    if (roll < budgetDrain + valueGrab) {
      if (bot && dollarsPerSlot(nominator) > averageDollarsPerSlot(state.teams)) {
        const wanted = pool.filter((p) => canBidOnPosition(nominator, p.pos))
        const candidates = wanted.length > 0 ? wanted : pool
        return weightedPick(candidates, (p) => (bot.valuations.get(playerKey(p)) ?? p.blended) ** NOMINATION_VALUE_EXPONENT, rng)
      }
      return weightedPick(pool, (p) => p.blended ** NOMINATION_VALUE_EXPONENT, rng)
    }

    // Need fill: nominate to plug one of our own open starting slots.
    if (roll < budgetDrain + valueGrab + needFill) {
      const openStarterPositions = new Set(
        nominator.slots.filter((s) => s.filled === null && s.type !== 'BENCH' && s.type !== 'FLEX').map((s) => s.type),
      )
      const holes = pool.filter((p) => openStarterPositions.has(p.pos))
      const candidates = holes.length > 0 ? holes : pool
      return weightedPick(candidates, (p) => 1 / (1 + p.blended), rng) // prefer something affordable
    }

    // Random noise.
    return pool[Math.floor(rng() * pool.length)]
  }
}
