import type { DraftState } from './draftState'
import { assignPlayer, canBidOnPosition, isRosterFull, legalMaxBid, type Team } from './roster'
import type { Player } from './types'
import { nextNominator, defaultNominationStrategy, type NominationStrategy } from './nomination'
import type { MaxBidFn } from './bots'
import { DROP_EARLY_PROBABILITY, HESITATION_ZONE } from './constants'

export interface AuctionResult {
  winner: Team | null
  price: number
}

export interface Bid {
  team: Team
  maxBid: number
}

// Gathers every eligible team's max bid for this player. Roster eligibility
// (spec §1: "a team that has filled a position group cannot bid on it") is
// enforced here, not left up to maxBidFn, so no bot implementation can
// accidentally violate it. Bids are always capped at the team's legal max
// bid (spec §1), so this can never let a team overspend.
function gatherBids(state: DraftState, player: Player, maxBidFn: MaxBidFn): Bid[] {
  const bids: Bid[] = []
  for (const team of state.teams) {
    if (isRosterFull(team)) continue
    if (!canBidOnPosition(team, player.pos)) continue
    const raw = maxBidFn(state, team, player)
    const capped = Math.min(raw, legalMaxBid(team))
    if (capped >= 1) bids.push({ team, maxBid: capped })
  }
  return bids
}

// The highest bidder wins, but pays only $1 more than the next-highest
// competing bid (or the $1 minimum if they were the only bidder) — the
// standard result of an English auction where everyone raises as long as
// it's worth it to them. `bids` must already be sorted highest-first.
// Exported so humanAuction.ts can reuse the exact same resolution math for
// a live, human-inclusive auction instead of duplicating it.
export function settleBids(bids: Bid[]): AuctionResult {
  const winner = bids[0].team
  const winnerMaxBid = bids[0].maxBid
  const secondBid = bids.length > 1 ? bids[1].maxBid : 0
  const price = Math.max(1, Math.min(winnerMaxBid, secondBid + 1))
  return { winner, price }
}

// Sealed-bid resolution: no live-auction noise, just the bids as given.
// Used directly by tests and as the deterministic core that
// resolveLiveAuction builds on.
export function resolveAuction(state: DraftState, player: Player, maxBidFn: MaxBidFn): AuctionResult {
  const bids = gatherBids(state, player, maxBidFn)
  if (bids.length === 0) return { winner: null, price: 0 }
  bids.sort((a, b) => b.maxBid - a.maxBid)
  return settleBids(bids)
}

// Live-auction resolution: same math as resolveAuction, plus one piece of
// §3.6's bidding mechanics that actually changes a clearing price — a
// bidder near the top of their range sometimes folds $1 short of their
// true max rather than pushing all the way to it. (Response delay,
// hesitation "beats", and the occasional opening jump to scare off casual
// interest are about the pacing/feel of a *live* auction and don't change
// who wins or what they pay in a sealed max-bid model, so they're left for
// a future UI to render as pacing rather than simulated here.)
export function resolveLiveAuction(state: DraftState, player: Player, maxBidFn: MaxBidFn): AuctionResult {
  const bids = gatherBids(state, player, maxBidFn)
  if (bids.length === 0) return { winner: null, price: 0 }
  bids.sort((a, b) => b.maxBid - a.maxBid)

  if (bids.length > 1) {
    const gapToTop = bids[0].maxBid - bids[1].maxBid
    if (gapToTop <= HESITATION_ZONE && state.rng() < DROP_EARLY_PROBABILITY) {
      bids[1].maxBid = Math.max(0, bids[1].maxBid - 1)
      bids.sort((a, b) => b.maxBid - a.maxBid)
    }
  }

  return settleBids(bids)
}

export function isDraftComplete(state: DraftState): boolean {
  return state.teams.every(isRosterFull)
}

function removeFromUndrafted(state: DraftState, player: Player) {
  state.undrafted = state.undrafted.filter((p) => !(p.name === player.name && p.team === player.team))
}

// If someone won, advances pickNumber, removes the player from the pool,
// assigns them, and records the pick. Shared by runDraftStep and by the
// UI's interactive draft controller (useDraftController.ts), so a
// human-inclusive auction resolved via humanAuction.ts's finalizeAuction()
// gets applied identically to a bot-only one.
//
// A player nobody bid on stays in the pool rather than being discarded.
// Spec §1 says the draft only ends "when all 12 teams have 14 players" —
// permanently removing an unwanted player can shrink the pool below what's
// needed to actually reach that, which is exactly what happened in testing
// once a human seat could pass on an auction (see git history): a chain of
// discarded players stalled the draft with rosters still short. pickNumber
// only advances on an actual fill, since it's meant to track roster
// progress, not nomination attempts.
export function applyAuctionResult(state: DraftState, player: Player, result: AuctionResult | null): void {
  if (!result?.winner) {
    state.log.push(`${player.name} (${player.pos}) found no bidders this time and stays in the pool`)
    return
  }

  state.pickNumber += 1
  removeFromUndrafted(state, player)
  assignPlayer(result.winner, player, result.price, state.pickNumber)
  state.drafted.push({ player, price: result.price, pickNumber: state.pickNumber })
  state.log.push(`Pick ${state.pickNumber}: ${player.name} (${player.pos}) to ${result.winner.name} for $${result.price}`)
}

// Runs one nominate -> auction -> assign cycle. Returns false if the draft
// was already complete or nothing was left to nominate, meaning nothing
// happened.
export function runDraftStep(
  state: DraftState,
  maxBidFn: MaxBidFn,
  nominate: NominationStrategy = defaultNominationStrategy,
): boolean {
  if (isDraftComplete(state)) return false

  const nominator = nextNominator(state)
  if (!nominator) return false

  const player = nominate(state, nominator)
  if (!player) return false

  const result = resolveLiveAuction(state, player, maxBidFn)
  applyAuctionResult(state, player, result)
  return true
}

// Runs steps until the draft is complete or nothing more can happen.
// maxSteps is a safety net against an unexpected infinite loop, not a
// normal stopping condition — with 186 players and 168 roster spots, a
// correct draft finishes well under that.
export function runFullDraft(
  state: DraftState,
  maxBidFn: MaxBidFn,
  nominate: NominationStrategy = defaultNominationStrategy,
  maxSteps = 10000,
): DraftState {
  let steps = 0
  while (!isDraftComplete(state) && steps < maxSteps) {
    if (!runDraftStep(state, maxBidFn, nominate)) break
    steps += 1
  }
  return state
}
