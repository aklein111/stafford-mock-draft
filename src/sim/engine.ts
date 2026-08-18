import type { DraftState } from './draftState'
import { assignPlayer, canBidOnPosition, isRosterFull, legalMaxBid, type Team } from './roster'
import type { Player } from './types'
import { nextNominator, defaultNominationStrategy } from './nomination'
import type { MaxBidFn } from './bots'

export interface AuctionResult {
  winner: Team | null
  price: number
}

// Resolves one player's auction from every eligible team's private max bid,
// as a sealed-bid second-price auction: the highest bidder wins, but pays
// only $1 more than the next-highest competing bid (or the $1 minimum if
// they were the only bidder). Bids are always capped at the team's legal
// max bid (spec §1), so this can never let a team overspend.
//
// The moment-to-moment mechanics of a live auction — response delay,
// hesitation near a bidder's limit, bidding wars (spec §3.6) — are a
// presentation-layer concern for a later phase; what the engine needs to
// get right is who wins and at what price.
export function resolveAuction(state: DraftState, player: Player, maxBidFn: MaxBidFn): AuctionResult {
  // Roster eligibility (spec §1: "a team that has filled a position group
  // cannot bid on it") is enforced here, not left up to maxBidFn, so no bot
  // implementation can accidentally violate it.
  const bids: { team: Team; maxBid: number }[] = []
  for (const team of state.teams) {
    if (isRosterFull(team)) continue
    if (!canBidOnPosition(team, player.pos)) continue
    const raw = maxBidFn(team, player)
    const capped = Math.min(raw, legalMaxBid(team))
    if (capped >= 1) bids.push({ team, maxBid: capped })
  }

  if (bids.length === 0) return { winner: null, price: 0 }

  bids.sort((a, b) => b.maxBid - a.maxBid)
  const winner = bids[0].team
  const winnerMaxBid = bids[0].maxBid
  const secondBid = bids.length > 1 ? bids[1].maxBid : 0
  const price = Math.max(1, Math.min(winnerMaxBid, secondBid + 1))
  return { winner, price }
}

export function isDraftComplete(state: DraftState): boolean {
  return state.teams.every(isRosterFull)
}

function removeFromUndrafted(state: DraftState, player: Player) {
  state.undrafted = state.undrafted.filter((p) => !(p.name === player.name && p.team === player.team))
}

// Runs one nominate -> auction -> assign cycle. Returns false if the draft
// was already complete or nothing was left to nominate, meaning nothing
// happened.
export function runDraftStep(
  state: DraftState,
  maxBidFn: MaxBidFn,
  nominate: (state: DraftState) => Player | null = defaultNominationStrategy,
): boolean {
  if (isDraftComplete(state)) return false

  const nominator = nextNominator(state)
  if (!nominator) return false

  const player = nominate(state)
  if (!player) return false

  const result = resolveAuction(state, player, maxBidFn)
  state.pickNumber += 1
  removeFromUndrafted(state, player)

  if (result.winner) {
    assignPlayer(result.winner, player, result.price, state.pickNumber)
    state.drafted.push({ player, price: result.price, pickNumber: state.pickNumber })
    state.log.push(`Pick ${state.pickNumber}: ${player.name} (${player.pos}) to ${result.winner.name} for $${result.price}`)
  } else {
    state.log.push(`Pick ${state.pickNumber}: ${player.name} (${player.pos}) found no bidders and was discarded`)
  }

  return true
}

// Runs steps until the draft is complete or nothing more can happen.
// maxSteps is a safety net against an unexpected infinite loop, not a
// normal stopping condition — with 186 players and 168 roster spots, a
// correct draft finishes well under that.
export function runFullDraft(
  state: DraftState,
  maxBidFn: MaxBidFn,
  nominate: (state: DraftState) => Player | null = defaultNominationStrategy,
  maxSteps = 10000,
): DraftState {
  let steps = 0
  while (!isDraftComplete(state) && steps < maxSteps) {
    if (!runDraftStep(state, maxBidFn, nominate)) break
    steps += 1
  }
  return state
}
