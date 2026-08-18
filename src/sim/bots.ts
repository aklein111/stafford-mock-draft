import { canBidOnPosition, legalMaxBid, type Team } from './roster'
import type { DraftState } from './draftState'
import type { Player } from './types'
import type { RNG } from './rng'
import { generateBotPersonalities, type Archetype, type BotTraits } from './botTraits'
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

// A bot's answer to "what's the most you'd pay for this player, right
// now?" The engine calls this once per eligible team per nominated player;
// it doesn't care whether the answer comes from real valuation logic or a
// test double.
export type MaxBidFn = (state: DraftState, team: Team, player: Player) => number

// Phase 2 test double: bids exactly $1 for any position it still needs, and
// nothing for a position it can no longer roster. Used only to exercise the
// engine's nomination rotation, bid resolution, and roster/budget rules
// before real bot valuations existed (spec §7, step 2: "Test with trivial
// bots that always bid $1"). Still useful now as a minimal baseline in
// tests.
export const trivialDollarBot: MaxBidFn = (_state, team, player) => {
  if (!canBidOnPosition(team, player.pos)) return 0
  return Math.min(1, legalMaxBid(team))
}

export interface BotState {
  teamId: number
  archetype: Archetype
  traits: BotTraits
  valuations: Map<string, number>
}

// Builds one persistent bot per team id (spec §3.1-§3.2): a personality
// plus a private valuation for every player, both drawn once at draft
// start and kept for the whole draft. noiseK/centering pass straight
// through to buildBotValuations — see there for what overriding them does.
// The archetype label is kept alongside for the post-draft personality
// reveal (spec §5) — never surfaced in the UI before the draft ends.
export function createBotStates(
  teamIds: number[],
  players: Player[],
  rng: RNG,
  noiseK?: number,
  centering?: number,
): BotState[] {
  const personalities = generateBotPersonalities(teamIds.length, rng)
  return teamIds.map((teamId, i) => ({
    teamId,
    archetype: personalities[i].archetype,
    traits: personalities[i].traits,
    valuations: buildBotValuations(players, personalities[i].traits, rng, noiseK, centering),
  }))
}

// The full maxBid function (spec §3.3): the bot's private anchor
// valuation, adjusted by where we are in the draft, this team's roster
// need, live inflation, and a per-player roll for "locked in"
// irrationality. The engine separately caps the result at the team's
// legal max bid, so this doesn't need to worry about overspending.
// backupQbFactor passes straight through to needFactor.
export function createRealBotMaxBidFn(botStates: BotState[], backupQbFactor?: number): MaxBidFn {
  const byTeamId = new Map(botStates.map((b) => [b.teamId, b]))

  return (state, team, player) => {
    const bot = byTeamId.get(team.id)
    if (!bot) return 0

    const anchor = bot.valuations.get(playerKey(player)) ?? player.blended
    const timing = timingFactor(state, player.pos)
    const need = needFactor(team, player, bot.traits.disciplineDecay, backupQbFactor)
    const inflation = inflationFactor(computeInflation(state))
    const lockIn = rollLockIn(state.rng)

    let maxBid = anchor * timing * need * inflation * lockIn
    if (isPoorPerSlot(team)) maxBid = Math.min(maxBid, 1)

    return Math.max(0, Math.round(maxBid))
  }
}
