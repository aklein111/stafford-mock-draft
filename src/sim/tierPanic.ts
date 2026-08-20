// User report: "sometimes as a draft goes on, certain teams begin to get
// scared they are going to miss out on the last player of a certain tier
// (not strict tiers like you have but their own tiers) and end up
// overpaying. This happens later on in the draft. As it is currently
// setup, it seems like the behavior is pretty static in that as the draft
// goes on, players become less expensive."
//
// That gap was real and structural. Nothing in the bid chain looked at
// *supply* at all: timingFactor is a fixed per-decile historical average,
// needFactor keys off the bidding team's own open-slot count, and
// roomDemandFactor counts how many teams still *want* a position and
// scales prices strictly down as that falls. None of them can express
// "there are only two players left I'd actually start, and five teams
// still need one" — which is the thing that actually produces a
// late-draft bidding war.
//
// leagueHistory.rawPicks backs the shape of it. Grouping every real
// non-keeper pick's price/target residual by decile of nomination order,
// prices sag through the middle of the draft (deciles 3-7 mean 0.81-0.89)
// and then come back up at the end — decile 8 has the highest mean of any
// late bucket (1.01), the fattest right tail (p90 1.33, p95 2.00, max
// 4.50), and by far the highest overpay rate (13.4% of picks above 1.25x,
// 6.3% above 1.5x, vs ~4-6% and ~0-2% early). Late-draft prices in this
// league are not a smooth decay; they're cheap on average with occasional
// violent spikes, which is exactly the signature of a scarcity panic.
//
// Two pieces here:
//   1. Private tiers, per bot. The user was explicit that these are "not
//      strict tiers like you have but their own tiers", so these are cut
//      from each bot's *own* private valuations (which already differ bot
//      to bot via buildBotValuations' residual sampling), not from the
//      data file's shared `tier` field. Two bots genuinely disagree about
//      where the cliff is, so they panic at different moments.
//   2. A bid-time panic multiplier keyed on how much of a bot's current
//      tier is left relative to how many teams could still take one.

import { canBidOnPosition, pickSlotFor, type Team } from './roster'
import type { DraftState } from './draftState'
import type { Player, Position } from './types'
import { playerKey } from './valuation'
import {
  PANIC_BENCH_SCALE,
  PANIC_MAX_BOOST,
  PANIC_MIN_VALUE,
  PANIC_START_PROGRESS,
  TIER_BREAK_GAP,
} from './constants'

// playerKey -> this bot's tier index for that player, within its position.
export type PrivateTiers = Map<string, number>

// Cuts each position into tiers along one bot's own valuations: walk the
// position's players from most to least valued and start a new tier
// whenever the current player has fallen more than TIER_BREAK_GAP below
// the value at the *top* of the current tier. Measuring against the tier's
// top (rather than the previous player) is what makes a tier mean
// "roughly interchangeable to me" — otherwise a long, gentle slide never
// breaks at all and the whole position collapses into one tier.
export function buildPrivateTiers(players: Player[], valuations: Map<string, number>): PrivateTiers {
  const valueOf = (p: Player) => valuations.get(playerKey(p)) ?? p.blended

  const byPos = new Map<Position, Player[]>()
  for (const player of players) {
    const arr = byPos.get(player.pos)
    if (arr) arr.push(player)
    else byPos.set(player.pos, [player])
  }

  const tiers: PrivateTiers = new Map()
  for (const arr of byPos.values()) {
    const sorted = [...arr].sort((a, b) => valueOf(b) - valueOf(a))
    let tier = 0
    let tierTop = sorted.length > 0 ? valueOf(sorted[0]) : 0
    for (const player of sorted) {
      const value = valueOf(player)
      if (tierTop - value > Math.max(tierTop, 1) * TIER_BREAK_GAP) {
        tier += 1
        tierTop = value
      }
      tiers.set(playerKey(player), tier)
    }
  }
  return tiers
}

// How much this bot bids *up* out of fear this is the last player at a
// quality level it still needs. Returns 1 (no effect) unless every part of
// the real-world situation is present at once:
//
//   - the bot has an open slot this player would actually fill,
//   - the player is worth panicking over at all (replacement-level $1-2
//     filler doesn't produce bidding wars, whatever the supply looks like),
//   - the draft is late enough for running out to be a real threat — early
//     on, a thin top tier is normal and everyone knows more talent is
//     coming, so PANIC_START_PROGRESS gates this off entirely,
//   - and the bot's own tier is genuinely short relative to the number of
//     teams that could still take one.
//
// The supply/demand term is the part nothing else in the model expresses:
// `seats` is every team still eligible for the position including this
// one, `remaining` is how many players are left in this bot's tier for it
// (the nominated player included — gatherBids runs before the pool is
// updated). Pressure is 0 while there's enough to go around and rises
// toward 1 as the tier empties out under a full room. This is deliberately
// *not* the same signal as roomDemandFactor: that one measures demand and
// only ever discounts, this one measures supply against that demand and
// only ever adds. A position can be simultaneously low-demand (few teams
// left needing it, so cheap) and low-supply (nothing left worth having,
// so contested), and the two effects are supposed to be able to disagree.
export function tierPanicFactor(
  state: DraftState,
  team: Team,
  player: Player,
  tiers: PrivateTiers,
  valuations: Map<string, number>,
  proneness: number,
): number {
  const slot = pickSlotFor(team, player.pos)
  if (!slot) return 1

  if ((valuations.get(playerKey(player)) ?? player.blended) < PANIC_MIN_VALUE) return 1

  const totalSlots = state.data.meta.teams * state.data.meta.rosterSpots
  const progress = totalSlots > 0 ? Math.min(1, state.pickNumber / totalSlots) : 0
  if (progress <= PANIC_START_PROGRESS) return 1
  const timeGate = (progress - PANIC_START_PROGRESS) / (1 - PANIC_START_PROGRESS)

  const tier = tiers.get(playerKey(player))
  if (tier === undefined) return 1

  let remaining = 0
  for (const p of state.undrafted) {
    if (p.pos === player.pos && tiers.get(playerKey(p)) === tier) remaining += 1
  }
  if (remaining <= 0) return 1

  let seats = 1 // this team
  for (const other of state.teams) {
    if (other.id !== team.id && canBidOnPosition(other, player.pos)) seats += 1
  }

  const pressure = Math.max(0, Math.min(1, (seats - remaining) / seats))
  if (pressure <= 0) return 1

  // A manager sweats their last startable RB2 far more than a bench flier.
  const slotScale = slot.type === player.pos ? 1 : PANIC_BENCH_SCALE

  return 1 + PANIC_MAX_BOOST * pressure * timeGate * slotScale * proneness
}
