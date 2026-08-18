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

// Higher decay = steeper drop-off from the plan's biggest slot to its
// smallest (stars-and-scrubs); close to 1 = nearly flat (spreads evenly).
// BALANCED is the default for most of the room, per REVISIONS.md: "one
// stars-and-scrubs plan, a couple balanced, one that spreads evenly."
// These are starting points for the step 4 calibration harness to tune,
// not final numbers.
const DECAY_BY_ARCHETYPE: Record<BudgetPlanArchetype, number> = {
  STARS_AND_SCRUBS: 0.55,
  BALANCED: 0.78,
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

function shuffle<T>(arr: T[], rng: RNG): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// A geometric decay curve, biggest entry first, scaled to sum exactly to
// `total` with every entry at least MIN_PLAN_PER_SLOT.
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
  return rounded
}

// Builds a plan indexed the same way team.slots is: starter slots first
// (createRosterSlots always builds starters, then bench, in that order),
// then bench. The biggest dollar targets go to starter slots and the
// smallest to bench — money is planned for the lineup, not the bench —
// but *which* starter slot gets the biggest share is shuffled per bot, so
// two stars-and-scrubs bots in the same room don't always plan to blow
// their budget on the exact same position.
export function generateBudgetPlan(
  archetype: BudgetPlanArchetype,
  totalBudget: number,
  starterCount: number,
  benchCount: number,
  rng: RNG,
): number[] {
  const decay = DECAY_BY_ARCHETYPE[archetype]
  const curve = decayCurve(starterCount + benchCount, decay, totalBudget)
  const starterShares = shuffle(curve.slice(0, starterCount), rng)
  const benchShares = shuffle(curve.slice(starterCount), rng)
  return [...starterShares, ...benchShares]
}

// The reserve-based cap (Fix 2a): how much of a team's remaining budget
// is earmarked for every *other* still-open slot, per the plan — leaving
// this as the most a bot will bid on the player in front of it right now.
// Slots fill in during the draft and drop out of the sum on their own
// (openSlots() only counts what's still unfilled), so a bot that
// overspends its plan on one slot automatically has less room for the
// rest without needing to explicitly shrink the plan itself.
export function computePlannedMaxBid(team: Team, player: Player, budgetPlan: number[]): number {
  const slot = pickSlotFor(team, player.pos)
  if (!slot) return 0

  let reserve = 0
  for (const open of openSlots(team)) {
    if (open === slot) continue
    const idx = team.slots.indexOf(open)
    reserve += budgetPlan[idx] ?? MIN_PLAN_PER_SLOT
  }
  return team.budget - team.spent - reserve
}
