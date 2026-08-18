// REVISIONS.md Fix 2a — a per-bot spending plan, drawn once at draft
// start (same "hidden until the reveal" treatment as botTraits.ts's
// personalities), that replaces the bare $1-per-remaining-slot legality
// rule as the *strategic* ceiling a bot actually bids to.
//
// The old rule (still enforced by roster.ts's legalMaxBid, for every
// bidder including a human) is a floor that only guarantees a draft can
// mathematically finish — it lets a bot blow $180 on two players and
// reserve $1 each for the other twelve. Real managers plan a rough
// budget across their whole roster before the draft even starts, and a
// bad early purchase eats into that plan rather than being absorbed by
// bottomless room elsewhere. That planning is what actually produces
// realistic top-of-the-pool restraint.

import type { RNG } from './rng'
import { openSlots, pickSlotFor, type Team } from './roster'
import type { Player } from './types'

export type BudgetPlanArchetype = 'STARS_AND_SCRUBS' | 'BALANCED' | 'EVEN_SPREAD'

export const BUDGET_PLAN_LABELS: Record<BudgetPlanArchetype, string> = {
  STARS_AND_SCRUBS: 'Stars and scrubs',
  BALANCED: 'Balanced budget',
  EVEN_SPREAD: 'Spreads it evenly',
}

// Lower decay = steeper drop-off from the plan's biggest slot to its
// smallest (stars-and-scrubs); close to 1 = nearly flat (spreads evenly).
// BALANCED is the default for most of the room, per REVISIONS.md: "one
// stars-and-scrubs plan, a couple balanced, one that spreads evenly."
//
// BALANCED's value was re-tuned in step 5: the original 0.78 gave its top
// slot only ~$45 of $200. Since the winning price on an elite player is
// roughly the *second*-highest capped bid in the room, and only one bot
// (STARS_AND_SCRUBS) had real room above ~$45, elite players were clearing
// reliably below their true value — measured directly, e.g. the pool's
// single best player landing below `blended` in 97%+ of simulations
// (checkVariance.ts). Steepening BALANCED gives the other ten bots a
// real top slot too (~$69 at 0.65), so there's genuine competitive depth
// near the top instead of just one bot with room to spend. Re-tuned
// against both calibrate.ts (so this doesn't re-break the step 4 shape
// targets) and checkVariance.ts (so elite players stop being one-sided).
const DECAY_BY_ARCHETYPE: Record<BudgetPlanArchetype, number> = {
  STARS_AND_SCRUBS: 0.55,
  BALANCED: 0.75,
  EVEN_SPREAD: 0.97,
}

const MIN_PLAN_PER_SLOT = 1 // matches the $1 real-money minimum bid

// Assigns one budget-plan archetype per bot: one stars-and-scrubs, one
// even-spread, and everyone else balanced — shuffled so it isn't always
// the same team ids, same pattern as botTraits.ts's assignArchetypes.
export function assignBudgetPlanArchetypes(count: number, rng: RNG): BudgetPlanArchetype[] {
  const named: BudgetPlanArchetype[] = ['STARS_AND_SCRUBS', 'EVEN_SPREAD']
  const archetypes: BudgetPlanArchetype[] = named.slice(0, count)
  while (archetypes.length < count) archetypes.push('BALANCED')

  for (let i = archetypes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[archetypes[i], archetypes[j]] = [archetypes[j], archetypes[i]]
  }
  return archetypes
}

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

// Builds a plan of dollar targets, one per roster spot, sorted biggest
// first — deliberately *not* tied to a specific slot or position. An
// earlier version assigned the curve to team.slots by index (with the
// starter portion shuffled so it wasn't always the same position), which
// meant a stars-and-scrubs bot's single big "splurge" number was pinned to
// whichever position it happened to land on at draft start — almost never
// the position of whichever player later turned out to be the one worth
// splurging on. See computePlannedMaxBid for how the plan is now applied
// to whichever slot the bot actually wants to spend big on.
export function generateBudgetPlan(
  archetype: BudgetPlanArchetype,
  totalBudget: number,
  starterCount: number,
  benchCount: number,
): number[] {
  return decayCurve(starterCount + benchCount, DECAY_BY_ARCHETYPE[archetype], totalBudget)
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
// That's what lets a stars-and-scrubs bot's splurge money follow whichever
// player it actually decides is worth it, instead of a position it
// pre-committed to before the draft even started. The current bid can
// reach for the single biggest of what remains; the rest stays reserved
// for every other open slot. A team that overspends its plan on one slot
// automatically has less room for the rest without needing to explicitly
// shrink the plan itself.
export function computePlannedMaxBid(team: Team, player: Player, budgetPlan: number[]): number {
  const slot = pickSlotFor(team, player.pos)
  if (!slot) return 0

  const openCount = openSlots(team).length
  const available = budgetPlan.slice(Math.max(0, budgetPlan.length - openCount))
  const reserve = available.slice(1).reduce((a, b) => a + b, 0)
  return team.budget - team.spent - reserve
}
