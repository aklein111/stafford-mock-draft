// Turns a bot's fixed personality (botTraits.ts) into (a) a private
// valuation of every player, drawn once at draft start (§3.2), and (b) the
// situational adjustments applied at bid time (§3.3-§3.5).

import type { DraftState } from './draftState'
import type { Player, Position } from './types'
import { openSlots, pickSlotFor, type Team } from './roster'
import type { RNG } from './rng'
import type { BotTraits } from './botTraits'
import { getHistoricalDerived } from './historicalResiduals'
import {
  BACKUP_QB_NEED_FACTOR,
  CENTERING,
  EARLY_SPEND_RESERVE_SCALE,
  FLEX_OR_BENCH_NEED_FACTOR,
  INFLATION_DAMPING,
  LATE_DRAFT_MAX_BOOST,
  LATE_DRAFT_SLOTS_THRESHOLD,
  LOCK_IN_MAX_BOOST,
  LOCK_IN_MIN_BOOST,
  LOCK_IN_PROBABILITY,
  MAX_RESERVE_SCALE,
  MIN_RESERVE_SCALE,
  NOISE_K,
  NOMINATION_40_CHECKPOINT,
  POOR_PER_SLOT_THRESHOLD,
  RICH_PER_SLOT_BOOST,
  RICH_PER_SLOT_THRESHOLD,
  ROOM_DEMAND_MIN_FACTOR,
  UNMATCHED_YAHOO_NOISE_MULT,
} from './constants'
import { TRAIT_STATS } from './ownerProfiles'

export function playerKey(player: Player): string {
  return `${player.name}|${player.team}`
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// §3.2 — each bot's private, persistent valuation of every player.
// noiseK/centering default to the module constants but can be overridden —
// the phase 4 calibration harness (scripts/calibrate.ts) sweeps both
// without needing to edit source files.
//
// RAW_DATA_ADDENDUM.md Method A: the noise term is no longer a normal draw
// (`normal(0, sd)`) — it's a residual sampled from what real Stafford
// drafts actually paid at that positional rank (residualPool), pooled
// against blended in the caller and passed in here so this stays
// decoupled from the data file for testing. A raw residual of 1.4 means
// "one of the nine seasons paid 40% over the smoothed target at this
// rank" — traits.noiseScale and noiseK still control how much a given bot
// actually believes that swing (same knobs as before), just scaling the
// residual's *deviation from 1* rather than an additive dollar amount.
export function buildBotValuations(
  players: Player[],
  traits: BotTraits,
  rng: RNG,
  residualPool: (pos: Position, rank: number) => number[],
  noiseK: number = NOISE_K,
  centering: number = CENTERING,
): Map<string, number> {
  const values = new Map<string, number>()
  for (const player of players) {
    const base = player.blended + centering
    const posMult = traits.positionBias[player.pos]
    const starMult = 1 + traits.starPreference * (player.blended / 70)

    const pool = residualPool(player.pos, player.posRank)
    const rawResidual = pool.length > 0 ? pool[Math.floor(rng() * pool.length)] : 1
    const widthScale = traits.noiseScale * noiseK * (player.matchedYahoo ? 1 : UNMATCHED_YAHOO_NOISE_MULT)
    const residual = 1 + (rawResidual - 1) * widthScale

    const value = base * posMult * starMult * residual * traits.overpayRatio
    values.set(playerKey(player), Math.max(0, value))
  }
  return values
}

// §4.1 — how far off "par" clearing prices run at this point in the draft.
// RAW_DATA_ADDENDUM.md: the old `calibration.timingMultiplier` /
// `positionTiming` fields are gone from the data file — derived instead
// from leagueHistory.rawPicks' nominationPick (format note 3: "it's what
// makes timing effects modellable directly"), per position where there's
// enough history and falling back to the all-position curve where a
// position/decile combination is too thin (see historicalResiduals.ts).
export function timingFactor(state: DraftState, pos: Position): number {
  const totalSlots = state.data.meta.teams * state.data.meta.rosterSpots
  const progress = totalSlots > 0 ? Math.min(1, state.pickNumber / totalSlots) : 0
  const decile = Math.min(9, Math.floor(progress * 10))
  return getHistoricalDerived(state.data).timingMultiplier(pos, decile)
}

// §4.2 — live inflation: how much money is left on the table relative to
// what the remaining players are nominally worth.
export function computeInflation(state: DraftState): number {
  const remainingBudget = state.teams.reduce((sum, t) => sum + (t.budget - t.spent), 0)
  const remainingBlended = state.undrafted.reduce((sum, p) => sum + p.blended, 0)
  if (remainingBlended <= 0) return 1
  return remainingBudget / remainingBlended
}

// Damped so bots react to inflation without perfectly correcting for it.
export function inflationFactor(inflation: number): number {
  return 1 + INFLATION_DAMPING * (inflation - 1)
}

function dollarsPerSlot(team: Team): number {
  return (team.budget - team.spent) / Math.max(openSlots(team).length, 1)
}

// §3.4 — roster need. Whether a team is even eligible to bid at all is
// enforced centrally by the engine before any of this runs (see
// engine.ts); this only decides how *eager* an eligible team is.
// backupQbFactor defaults to the module constant but can be overridden —
// the calibration harness sweeps it against calibration.avgRosteredByPos.QB
// without needing to edit source files (same pattern as noiseK/centering).
export function needFactor(
  team: Team,
  player: Player,
  disciplineDecay: number,
  backupQbFactor: number = BACKUP_QB_NEED_FACTOR,
): number {
  const slot = pickSlotFor(team, player.pos)
  let factor: number
  if (slot && slot.type === player.pos) {
    factor = 1.0
  } else if (slot && slot.type === 'BENCH' && player.pos === 'QB') {
    // A backup QB is a much weaker want than a bench RB/WR/TE (bye-week
    // flex/handcuff value vs. mostly dead weight), so it gets its own,
    // lower discount rather than sharing FLEX_OR_BENCH_NEED_FACTOR.
    factor = backupQbFactor
  } else {
    factor = FLEX_OR_BENCH_NEED_FACTOR
  }

  const remaining = openSlots(team).length
  const hasUnfilledStarter = team.slots.some((s) => s.filled === null && s.type !== 'BENCH')
  if (remaining < LATE_DRAFT_SLOTS_THRESHOLD && hasUnfilledStarter) {
    const boost = LATE_DRAFT_MAX_BOOST * Math.min(1, disciplineDecay / 1.5)
    factor = Math.max(factor, 1 + boost)
  }

  if (dollarsPerSlot(team) > RICH_PER_SLOT_THRESHOLD) factor *= 1 + RICH_PER_SLOT_BOOST

  return factor
}

// How much a single team's presence in the room actually contributes to
// competitive pressure on `pos`, right now — used by roomDemandFactor. A
// flat eligible/not-eligible split (canBidOnPosition) doesn't work for
// RB/WR/TE: they share FLEX and BENCH so broadly that almost every team
// stays technically "eligible" until very late in the draft, so that
// signal barely moves across most of the draft (measured: RB/WR/TE showed
// near-zero correlation between eligible-team-count and price/blended).
// Weighting by *which* slot a team would actually use — a dedicated
// starter slot means real, specific demand; FLEX is weaker, general
// demand; BENCH is weaker still — gives a signal that actually declines
// through the draft as dedicated slots fill, the way real scarcity does.
function teamDemandWeight(team: Team, pos: Position): number {
  const slot = pickSlotFor(team, pos)
  if (!slot) return 0
  if (slot.type === pos) return 1
  if (slot.type === 'FLEX') return 0.5
  return 0.25 // BENCH
}

// REVISIONS.md Change 3, step 5 — room-wide scarcity. needFactor only
// captures how much *this* team wants the position; it says nothing about
// how many other teams are still realistically in the market for it,
// which is what actually produces a late-draft bargain in a real auction.
// Scales every bid down as the room's average demand weight drops,
// regardless of the bidding team's own need — even a team with a
// dedicated open slot should pay less when there's little real
// competition for it.
export function roomDemandFactor(state: DraftState, pos: Position): number {
  const total = state.teams.length
  if (total === 0) return 1
  const avgWeight = state.teams.reduce((sum, t) => sum + teamDemandWeight(t, pos), 0) / total
  return lerp(ROOM_DEMAND_MIN_FACTOR, 1, avgWeight)
}

export function isPoorPerSlot(team: Team): boolean {
  return dollarsPerSlot(team) < POOR_PER_SLOT_THRESHOLD
}

// BOT_PERSONALITIES.md's shareSpentByNom40: "how eagerly it spends early;
// feeds the budget reserve." The trait is measured against nomination 40
// in the source data's own 168-pick season (leagueHistory.rawPicks) — a
// checkpoint that only means something *before* it's passed, so this is a
// no-op past it, not a permanent tilt. Before the checkpoint, a bot whose
// drawn value sits above the league mean (spends more of its budget early
// than average, historically) gets its computePlannedMaxBid reserve
// scaled down — less held back, more usable on the pick in front of it
// right now; a patient bot gets the reserve scaled up. Clamped to a
// narrow band around 1 — this is a tilt on Fix 2a's reserve, not a
// replacement for it.
export function earlySpendReserveScale(state: DraftState, shareSpentByNom40: number): number {
  const totalSlots = state.data.meta.teams * state.data.meta.rosterSpots
  if (totalSlots <= 0) return 1
  const checkpointProgress = Math.min(1, NOMINATION_40_CHECKPOINT / totalSlots)
  if (state.pickNumber / totalSlots > checkpointProgress) return 1

  const deviation = shareSpentByNom40 - TRAIT_STATS.shareSpentByNom40.leagueMean
  const scale = 1 - EARLY_SPEND_RESERVE_SCALE * deviation
  return Math.min(MAX_RESERVE_SCALE, Math.max(MIN_RESERVE_SCALE, scale))
}

// §3.5 — occasional irrationality: ~8% chance per player a bot gets
// "locked in" and pays 10-25% over its usual number.
export function rollLockIn(rng: RNG): number {
  if (rng() < LOCK_IN_PROBABILITY) {
    return 1 + LOCK_IN_MIN_BOOST + rng() * (LOCK_IN_MAX_BOOST - LOCK_IN_MIN_BOOST)
  }
  return 1
}
