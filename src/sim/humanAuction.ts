// Lets a human participate in an auction alongside the bots, without
// re-running bot valuation logic (and its per-player randomness, §3.5's
// lock-in roll) every time the human adjusts their bid. Bot max bids are
// computed once, when the player is nominated; everything the human does
// afterward is a cheap, pure re-combination of those fixed numbers with
// the human's current bid.
//
// This is what backs the Center panel's Bid button and Max bid field
// (spec §5): the "Max bid field" is exactly a proxy bid — set a ceiling
// and currentStanding() shows who's winning and at what price, exactly as
// engine.ts's sealed-bid resolution would for any other team. The "Bid
// button" is the same mechanism, just nudged up by $1 at a time instead
// of pre-committing to a ceiling.

import type { DraftState } from './draftState'
import { canBidOnPositionSafely, isRosterFull, legalMaxBid, type Team } from './roster'
import type { Player } from './types'
import type { MaxBidFn } from './bots'
import { DROP_EARLY_PROBABILITY, HESITATION_ZONE } from './constants'
import { settleBids, type AuctionResult, type Bid } from './engine'

// Every eligible bot team's max bid for this player, computed once at
// nomination time. Excludes the human's own team.
//
// Uses canBidOnPositionSafely (not the plain per-team canBidOnPosition) so
// a bot can't take a thin-supply position for FLEX/BENCH value and strand
// another team's dedicated slot for it — see roster.ts for the deadlock
// this prevents.
export function computeBotBids(state: DraftState, player: Player, botMaxBidFn: MaxBidFn, humanTeamId: number): Bid[] {
  const bids: Bid[] = []
  for (const team of state.teams) {
    if (team.id === humanTeamId) continue
    if (isRosterFull(team)) continue
    if (!canBidOnPositionSafely(state.teams, state.undrafted, team, player.pos)) continue
    const raw = botMaxBidFn(state, team, player)
    const capped = Math.min(raw, legalMaxBid(team))
    if (capped >= 1) bids.push({ team, maxBid: capped })
  }
  return bids
}

// The live standing right now: given the precomputed bot bids plus the
// human's current bid (0 or less = not participating), who's winning and
// at what price? Pure and cheap — safe to call on every keystroke or
// click. Returns null if nobody (bot or human) is bidding at all.
export function currentStanding(botBids: Bid[], humanTeam: Team, humanBid: number): AuctionResult | null {
  const bids = [...botBids]
  if (humanBid >= 1) {
    const capped = Math.min(humanBid, legalMaxBid(humanTeam))
    if (capped >= 1) bids.push({ team: humanTeam, maxBid: capped })
  }
  if (bids.length === 0) return null
  bids.sort((a, b) => b.maxBid - a.maxBid)
  return settleBids(bids)
}

// The final result once the auction closes and the player is assigned.
// If the human never bid, this reapplies the same "folds $1 short near
// the top" realism as engine.ts's resolveLiveAuction, so a bot-vs-bot
// auction behaves identically whether or not a human happened to be in
// the room. If the human did bid, that flavor is skipped — it was
// modeling a bot's own hesitation near its limit, not relevant once a
// human is actively driving the bidding.
export function finalizeAuction(state: DraftState, botBids: Bid[], humanTeam: Team, humanBid: number): AuctionResult | null {
  if (humanBid >= 1) {
    return currentStanding(botBids, humanTeam, humanBid)
  }

  const bids = [...botBids].sort((a, b) => b.maxBid - a.maxBid)
  if (bids.length === 0) return null
  if (bids.length > 1) {
    const gapToTop = bids[0].maxBid - bids[1].maxBid
    if (gapToTop <= HESITATION_ZONE && state.rng() < DROP_EARLY_PROBABILITY) {
      bids[1] = { ...bids[1], maxBid: Math.max(0, bids[1].maxBid - 1) }
      bids.sort((a, b) => b.maxBid - a.maxBid)
    }
  }
  return settleBids(bids)
}
