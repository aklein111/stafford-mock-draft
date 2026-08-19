// REVISIONS.md Fix 2a — a per-bot spending plan, drawn once at draft
// start, that replaces the bare $1-per-remaining-slot legality rule as
// the *strategic* ceiling a bot actually bids to.
//
// The old rule (still enforced by roster.ts's legalMaxBid, for every
// bidder including a human) is a floor that only guarantees a draft can
// mathematically finish — it lets a bot blow $180 on two players and
// reserve $1 each for the other twelve. Real managers plan a rough
// budget across their whole roster before the draft even starts, and a
// bad early purchase eats into that plan rather than being absorbed by
// bottomless room elsewhere. That planning is what actually produces
// realistic top-of-the-pool restraint.
//
// BOT_PERSONALITIES.md: the plan is generated directly from that bot's
// per-draft owner-trait draw rather than picked from a fixed
// stars-and-scrubs/balanced/even-spread menu — top3Concentration sets how
// front-loaded the curve is, biggestBuy sets the single top slot's dollar
// target, and dollarPlayers sets how many of the smallest slots plan to
// go for near nothing. All three are real per-owner numbers, redrawn
// every draft, so the plan's shape is honest variance rather than a
// caricature picked from a menu.

import { pickSlotFor, openSlots, type Team } from './roster'
import type { DrawnOwnerTraits } from './ownerProfiles'
import type { Player } from './types'

const MIN_PLAN_PER_SLOT = 1 // matches the $1 real-money minimum bid

// A geometric decay curve, biggest entry first, scaled to sum exactly to
// `total` with every entry at least MIN_PLAN_PER_SLOT. Always returned
// sorted descending — the rounding-remainder adjustment below nudges
// whichever entry is currently the biggest, which keeps it sorted in
// practice, but the explicit sort makes that an invariant rather than an
// accident, since computePlannedMaxBid depends on it.
function decayCurve(count: number, decay: number, total: number): number[] {
  const weights: number[] = []
  let w = 1
  for (let i = 0; i < count; i++) {
    weights.push(w)
    w *= decay
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0)
  const rounded = weights.map((weight) => Math.max(MIN_PLAN_PER_SLOT, Math.round((weight / sumWeights) * total)))
  const diff = total - rounded.reduce((a, b) => a + b, 0)
  if (diff !== 0) {
    const maxIdx = rounded.indexOf(Math.max(...rounded))
    rounded[maxIdx] += diff
  }
  return rounded.sort((a, b) => b - a)
}

// What fraction of `total` a decayCurve(count, decay, total) puts on its
// top 3 entries — the un-rounded version, so decayForTop3Share can
// binary-search it. Strictly decreasing in decay: decay -> 0 puts
// everything on entry 1 (top3Share -> 1); decay -> 1 is flat (top3Share ->
// 3/count).
function top3ShareForDecay(count: number, decay: number): number {
  let sum = 0
  let top3 = 0
  let w = 1
  for (let i = 0; i < count; i++) {
    sum += w
    if (i < 3) top3 += w
    w *= decay
  }
  return sum > 0 ? top3 / sum : 0
}

// Inverts top3ShareForDecay: what decay produces a curve whose top 3
// entries hold this owner's drawn top3Concentration share of the total
// budget. observedMin for top3Concentration (0.415) is comfortably above
// the flattest possible share (3/14 ~ 0.214), so the target is always
// reachable inside (0, 1) — no need to handle an out-of-range target.
function decayForTop3Share(count: number, targetShare: number): number {
  let lo = 0.001
  let hi = 0.999
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (top3ShareForDecay(count, mid) > targetShare) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// Overrides a sorted-descending plan's biggest entry with an explicit
// target, then rescales every other entry so the plan still sums to the
// same total (same rounding/remainder approach as decayCurve), re-sorted
// descending afterward so computePlannedMaxBid's sorted-biggest-first
// invariant holds regardless of how the override landed relative to the
// original curve.
function setTopSlot(plan: number[], target: number): number[] {
  if (plan.length === 0) return plan
  const total = plan.reduce((a, b) => a + b, 0)
  const maxTop = total - MIN_PLAN_PER_SLOT * (plan.length - 1)
  const top = Math.min(maxTop, Math.max(MIN_PLAN_PER_SLOT, Math.round(target)))

  const rest = plan.slice(1)
  const restTarget = total - top
  const restSum = rest.reduce((a, b) => a + b, 0)
  const rescaledRest = restSum > 0 ? rest.map((v) => Math.max(MIN_PLAN_PER_SLOT, Math.round((v / restSum) * restTarget))) : rest

  const combined = [top, ...rescaledRest]
  const diff = total - combined.reduce((a, b) => a + b, 0)
  if (diff !== 0) {
    const maxIdx = combined.indexOf(Math.max(...combined))
    combined[maxIdx] += diff
  }
  return combined.sort((a, b) => b - a)
}

// Forces the smallest `count` entries of a sorted-descending plan down to
// MIN_PLAN_PER_SLOT (BOT_PERSONALITIES.md's dollarPlayers: "how many
// slots it plans to fill at $1-2"), and redistributes what that frees up
// proportionally across the remaining entries so the total is unchanged.
function floorCheapestSlots(plan: number[], count: number): number[] {
  const n = plan.length
  const floorCount = Math.max(0, Math.min(n - 1, Math.round(count)))
  if (floorCount === 0) return plan

  const total = plan.reduce((a, b) => a + b, 0)
  const keepCount = n - floorCount
  const cheapest = plan.slice(keepCount)
  const reclaimed = cheapest.reduce((a, b) => a + b, 0) - floorCount * MIN_PLAN_PER_SLOT
  const floored = new Array(floorCount).fill(MIN_PLAN_PER_SLOT)

  const kept = plan.slice(0, keepCount)
  const keptSum = kept.reduce((a, b) => a + b, 0)
  const rescaledKept =
    keptSum > 0 ? kept.map((v) => Math.max(MIN_PLAN_PER_SLOT, Math.round(v + (v / keptSum) * reclaimed))) : kept

  const combined = [...rescaledKept, ...floored]
  const diff = total - combined.reduce((a, b) => a + b, 0)
  if (diff !== 0) {
    const maxIdx = combined.indexOf(Math.max(...combined))
    combined[maxIdx] += diff
  }
  return combined.sort((a, b) => b - a)
}

// Builds a plan of dollar targets, one per roster spot, sorted biggest
// first — deliberately *not* tied to a specific slot or position (see
// computePlannedMaxBid for how it's applied to whichever slot the bot
// actually wants to spend big on, regardless of position).
export function generateBudgetPlan(drawn: DrawnOwnerTraits, totalBudget: number, starterCount: number, benchCount: number): number[] {
  const slots = starterCount + benchCount
  const decay = decayForTop3Share(slots, drawn.top3Concentration)
  const base = decayCurve(slots, decay, totalBudget)
  const withBiggestBuy = setTopSlot(base, drawn.biggestBuy * totalBudget)
  return floorCheapestSlots(withBiggestBuy, drawn.dollarPlayers)
}

// The reserve-based cap (Fix 2a): how much of a team's remaining budget is
// earmarked for every *other* still-open slot, per the plan — leaving this
// as the most a bot will bid on the player in front of it right now.
//
// budgetPlan is sorted biggest-first and isn't tied to any slot's
// identity: with N slots still open, the N smallest plan values are what's
// "left" — every fill (any slot, any position) is treated as having spent
// the single biggest not-yet-consumed value, so which N are left depends
// only on how many slots have filled, not which positions they were. Sized
// off budgetPlan.length itself (not team.slots.length) so a plan is always
// self-consistent even if it doesn't cover every one of the team's slots.
// The current bid can reach for the single biggest of what remains; the
// rest stays reserved for every other open slot. A team that overspends
// its plan on one slot automatically has less room for the rest without
// needing to explicitly shrink the plan itself.
//
// reserveScale (default 1, no adjustment) lets a caller lean on the
// reserve directly — BOT_PERSONALITIES.md's shareSpentByNom40 uses this to
// make an early-spending bot's reserve smaller (more usable right now)
// before the draft reaches its measured checkpoint (see bots.ts).
export function computePlannedMaxBid(team: Team, player: Player, budgetPlan: number[], reserveScale: number = 1): number {
  const slot = pickSlotFor(team, player.pos)
  if (!slot) return 0

  const openCount = openSlots(team).length
  const available = budgetPlan.slice(Math.max(0, budgetPlan.length - openCount))
  const reserve = available.slice(1).reduce((a, b) => a + b, 0) * reserveScale
  return team.budget - team.spent - reserve
}
