import { canBidOnPosition, legalMaxBid, type Team } from './roster'
import type { DraftState } from './draftState'
import type { DraftData, Player } from './types'
import type { RNG } from './rng'
import { traitsFromOwnerDraw, type BotTraits } from './botTraits'
import { computePlannedMaxBid, generateBudgetPlan } from './budgetPlan'
import { getHistoricalDerived } from './historicalResiduals'
import { BOT_OWNERS, drawOwnerTraits, type DrawnOwnerTraits } from './ownerProfiles'
import {
  buildBotValuations,
  computeInflation,
  earlySpendReserveScale,
  inflationFactor,
  isPoorPerSlot,
  needFactor,
  playerKey,
  rollLockIn,
  roomDemandFactor,
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
  // BOT_PERSONALITIES.md: the real manager this bot is standing in for —
  // "label the bots with the real names."
  name: string
  // This draft's raw trait draw (ownerProfiles.ts), kept alongside the
  // derived BotTraits below so the results screen can reveal exactly what
  // this bot was playing this particular draft (not shown during the
  // draft itself).
  drawnTraits: DrawnOwnerTraits
  traits: BotTraits
  valuations: Map<string, number>
  budgetPlan: number[]
}

// Builds one persistent bot per team id: BOT_PERSONALITIES.md's per-draft
// owner trait draw, the derived behavioural traits, a private valuation
// for every player, and a planned per-slot spending target, all drawn once
// at draft start and kept for the whole draft. noiseK/centering pass
// straight through to buildBotValuations — see there for what overriding
// them does. Bots cycle through the eleven real owners in file order; a
// headless all-bot draft (calibrate.ts, checkVariance.ts) has a 12th seat
// with no human, so it wraps around and reuses the first owner — harmless
// since those runs never display a name.
export function createBotStates(teamIds: number[], data: DraftData, rng: RNG, noiseK?: number, centering?: number): BotState[] {
  const starterCount = data.meta.starters.length
  const benchCount = data.meta.bench
  const residualPool = getHistoricalDerived(data).residualPool

  return teamIds.map((teamId, i) => {
    const owner = BOT_OWNERS[i % BOT_OWNERS.length]
    const drawnTraits = drawOwnerTraits(owner, rng)
    const traits = traitsFromOwnerDraw(drawnTraits, rng)
    return {
      teamId,
      name: owner.name,
      drawnTraits,
      traits,
      valuations: buildBotValuations(data.currentPlayers, traits, rng, residualPool, noiseK, centering),
      budgetPlan: generateBudgetPlan(drawnTraits, data.meta.budget, starterCount, benchCount),
    }
  })
}

// The full maxBid function (spec §3.3, adjusted per REVISIONS.md Fixes
// 2a-2b and step 5's room-demand fix): the bot's private anchor valuation,
// adjusted by where we are in the draft, this team's own roster need, how
// much real room-wide competition still exists for the position
// (roomDemandFactor — step 5: a bidding team's own need isn't what makes a
// late-draft player cheap, a lack of *other* competing bidders is), live
// inflation, and a per-player roll for "locked in" irrationality — scaled
// down by the bot's restraint (Fix 2b: a real manager sets a number and
// stops, rather than pushing to the edge of what it can technically
// afford) — then capped at what the bot's own budget plan has reserved for
// every other slot it still needs to fill (Fix 2a), itself tilted by this
// bot's drawn early-spending eagerness (BOT_PERSONALITIES.md). The engine
// separately enforces the hard legal-max-bid floor on top of all of this,
// so neither this function nor its caller needs to worry about a team
// going roster-incomplete.
// backupQbFactor passes straight through to needFactor.
export function createRealBotMaxBidFn(botStates: BotState[], backupQbFactor?: number): MaxBidFn {
  const byTeamId = new Map(botStates.map((b) => [b.teamId, b]))

  return (state, team, player) => {
    const bot = byTeamId.get(team.id)
    if (!bot) return 0

    const anchor = bot.valuations.get(playerKey(player)) ?? player.blended
    const timing = timingFactor(state, player.pos)
    const need = needFactor(team, player, bot.traits.disciplineDecay, backupQbFactor)
    const roomDemand = roomDemandFactor(state, player.pos)
    const inflation = inflationFactor(computeInflation(state))
    const lockIn = rollLockIn(state.rng)

    let maxBid = anchor * timing * need * roomDemand * inflation * lockIn * bot.traits.restraint
    if (isPoorPerSlot(team)) maxBid = Math.min(maxBid, 1)

    const reserveScale = earlySpendReserveScale(state, bot.drawnTraits.shareSpentByNom40)
    const plannedCap = computePlannedMaxBid(team, player, bot.budgetPlan, reserveScale)
    maxBid = Math.min(maxBid, plannedCap)

    return Math.max(0, Math.round(maxBid))
  }
}
