// Turns a bot's fixed personality (botTraits.ts) into (a) a private
// valuation of every player, drawn once at draft start (§3.2), and (b) the
// situational adjustments applied at bid time (§3.3-§3.5).

import type { DraftState } from './draftState'
import type { Player, Position } from './types'
import { openSlots, pickSlotFor, type Team } from './roster'
import type { RNG } from './rng'
import { randNormal } from './rng'
import type { BotTraits } from './botTraits'
import {
  BACKUP_QB_NEED_FACTOR,
  CENTERING,
  FLEX_OR_BENCH_NEED_FACTOR,
  INFLATION_DAMPING,
  LATE_DRAFT_MAX_BOOST,
  LATE_DRAFT_SLOTS_THRESHOLD,
  LOCK_IN_MAX_BOOST,
  LOCK_IN_MIN_BOOST,
  LOCK_IN_PROBABILITY,
  NOISE_K,
  POOR_PER_SLOT_THRESHOLD,
  RICH_PER_SLOT_BOOST,
  RICH_PER_SLOT_THRESHOLD,
  UNMATCHED_YAHOO_NOISE_MULT,
} from './constants'

export function playerKey(player: Player): string {
  return `${player.name}|${player.team}`
}

// §3.2 — each bot's private, persistent valuation of every player.
// noiseK/centering default to the module constants but can be overridden —
// the phase 4 calibration harness (scripts/calibrate.ts) sweeps both
// without needing to edit source files.
//
export function buildBotValuations(
  players: Player[],
  traits: BotTraits,
  rng: RNG,
  noiseK: number = NOISE_K,
  centering: number = CENTERING,
): Map<string, number> {
  const values = new Map<string, number>()
  for (const player of players) {
    const base = player.expected + centering
    const posMult = traits.positionBias[player.pos]
    const starMult = 1 + traits.starPreference * (player.expected / 70)
    const noiseWidth =
      player.sd * traits.noiseScale * noiseK * (player.matchedYahoo ? 1 : UNMATCHED_YAHOO_NOISE_MULT)
    const noise = randNormal(rng, 0, noiseWidth)
    const value = (base * posMult * starMult + noise) * traits.aggression
    values.set(playerKey(player), Math.max(0, value))
  }
  return values
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// §4.1 — how far off "par" clearing prices run at this point in the draft.
// `positionTiming` gives "the same effect" as the overall decile curve but
// split by position — i.e. it's a more specific replacement for a position
// that has one, not an extra discount layered on top of the overall curve
// (blending the two average two readings of the same underlying effect and
// ends up over-discounting). DEF has no position-specific curve in the
// data, so it falls back to the overall decile curve.
export function timingFactor(state: DraftState, pos: Position): number {
  const totalSlots = state.data.meta.teams * state.data.meta.rosterSpots
  const progress = totalSlots > 0 ? Math.min(1, state.pickNumber / totalSlots) : 0

  const pt = state.data.calibration.positionTiming[pos]
  if (pt) {
    return progress <= 0.5 ? lerp(pt.early, pt.mid, progress / 0.5) : lerp(pt.mid, pt.late, (progress - 0.5) / 0.5)
  }

  const decile = Math.min(9, Math.floor(progress * 10))
  return state.data.calibration.timingMultiplier[decile] ?? 1
}

// §4.2 — live inflation: how much money is left on the table relative to
// what the remaining players are nominally worth.
export function computeInflation(state: DraftState): number {
  const remainingBudget = state.teams.reduce((sum, t) => sum + (t.budget - t.spent), 0)
  const remainingExpected = state.undrafted.reduce((sum, p) => sum + p.expected, 0)
  if (remainingExpected <= 0) return 1
  return remainingBudget / remainingExpected
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

export function isPoorPerSlot(team: Team): boolean {
  return dollarsPerSlot(team) < POOR_PER_SLOT_THRESHOLD
}

// §3.5 — occasional irrationality: ~8% chance per player a bot gets
// "locked in" and pays 10-25% over its usual number.
export function rollLockIn(rng: RNG): number {
  if (rng() < LOCK_IN_PROBABILITY) {
    return 1 + LOCK_IN_MIN_BOOST + rng() * (LOCK_IN_MAX_BOOST - LOCK_IN_MIN_BOOST)
  }
  return 1
}
