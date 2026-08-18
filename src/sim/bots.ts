import { canBidOnPosition, legalMaxBid, type Team } from './roster'
import type { Player } from './types'

// A bot's answer to "what's the most you'd pay for this player?" for one
// player, right now. Phase 3 replaces this with the full valuation +
// situational-adjustment model from spec §3; the engine itself doesn't
// care which one it's given.
export type MaxBidFn = (team: Team, player: Player) => number

// Phase 2 test double: bids exactly $1 for any position it still needs, and
// nothing for a position it can no longer roster. Used only to exercise the
// engine's nomination rotation, bid resolution, and roster/budget rules
// before real bot valuations exist (spec §7, step 2: "Test with trivial
// bots that always bid $1").
export const trivialDollarBot: MaxBidFn = (team, player) => {
  if (!canBidOnPosition(team, player.pos)) return 0
  return Math.min(1, legalMaxBid(team))
}
