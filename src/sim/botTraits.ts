// A bot's per-draft personality: BOT_PERSONALITIES.md's per-draft owner
// trait draw (ownerProfiles.ts) turned into the behavioural knobs
// valuation.ts and budgetPlan.ts actually consume. There is no fixed
// archetype here on purpose — see ownerProfiles.ts for why.

import type { Position } from './types'
import type { RNG } from './rng'
import { randRange } from './rng'
import { POSITION_BIAS_DAMPING, RESTRAINT_MAX, RESTRAINT_MIN, STAR_PREFERENCE_SCALE } from './constants'
import { TRAIT_STATS, type DrawnOwnerTraits } from './ownerProfiles'

export interface BotTraits {
  // BOT_PERSONALITIES.md: "a small multiplier on its walk-away price" —
  // drawn directly, no further shaping.
  overpayRatio: number
  positionBias: Record<Position, number>
  starPreference: number // -0.10 to +0.10
  // Not a modelled owner trait — the source data doesn't measure these,
  // so they stay small per-draft noise, identical in distribution for
  // every bot rather than tied to any owner's identity (which is exactly
  // what BOT_PERSONALITIES.md's finding says not to fabricate).
  disciplineDecay: number // 0.5-1.5
  noiseScale: number // 0.7-1.3
  restraint: number // 0.85-0.95, REVISIONS.md Fix 2b
  // How hard this bot chases a thinning tier (tierPanic.ts). 0 = never
  // panics, 1 = full PANIC_MAX_BOOST when its tier empties out under a
  // full room. The user's report was that "*certain* teams begin to get
  // scared" — not all of them — so this is drawn per draft across the
  // whole range rather than being a constant everyone shares.
  panicProneness: number // 0-1
}

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE']

function positionBiasFromShares(drawn: DrawnOwnerTraits): Record<Position, number> {
  const bias: Record<Position, number> = { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 }
  for (const pos of POSITIONS) {
    const traitName = (pos.toLowerCase() + 'Share') as 'qbShare' | 'rbShare' | 'wrShare' | 'teShare'
    const ratio = drawn[traitName] / TRAIT_STATS[traitName].leagueMean
    bias[pos] = 1 + (ratio - 1) * POSITION_BIAS_DAMPING
  }
  // DEF/K aren't modelled owner traits — spend there is negligible and
  // undifferentiated in the source data, so bias stays neutral.
  return bias
}

function starPreferenceFromConcentration(drawn: DrawnOwnerTraits): number {
  const deviation = drawn.top3Concentration - TRAIT_STATS.top3Concentration.leagueMean
  return Math.max(-0.1, Math.min(0.1, deviation * STAR_PREFERENCE_SCALE))
}

export function traitsFromOwnerDraw(drawn: DrawnOwnerTraits, rng: RNG): BotTraits {
  return {
    overpayRatio: drawn.overpayRatio,
    positionBias: positionBiasFromShares(drawn),
    starPreference: starPreferenceFromConcentration(drawn),
    disciplineDecay: randRange(rng, 0.5, 1.5),
    noiseScale: randRange(rng, 0.7, 1.3),
    restraint: randRange(rng, RESTRAINT_MIN, RESTRAINT_MAX),
    panicProneness: randRange(rng, 0, 1),
  }
}
