// BOT_PERSONALITIES.md, "the finding you need to build around": eight
// seasons of owner-labelled drafts show almost no manager trait is stable
// (highest ICC 0.32, QB share) — within-manager year-to-year variation
// exceeds between-manager variation on every trait tested. Building fixed
// caricature personalities (as botTraits.ts used to, with a "RB-heavy" /
// "punts TE" archetype shuffle reused every draft) would fit that noise
// and make every simulated draft wrong in the same fabricated way.
//
// Instead each bot gets a *small* persistent tilt (useThis — the raw
// eight-season mean shrunk toward the league mean in proportion to how
// reliable that trait actually is) and is redrawn every single simulated
// draft around that tilt, spread by the league-wide within-owner standard
// deviation. That redraw is the finding, not a limitation of it.

import data from '../data/stafford_owner_profiles.json'
import { randNormal, type RNG } from './rng'

export type OwnerTraitName =
  | 'qbShare'
  | 'rbShare'
  | 'wrShare'
  | 'teShare'
  | 'top3Concentration'
  | 'shareSpentByNom40'
  | 'dollarPlayers'
  | 'biggestBuy'
  | 'overpayRatio'

interface OwnerTraitValue {
  observed: number
  useThis: number
}

export interface OwnerProfile {
  name: string
  seasons: number
  traits: Record<OwnerTraitName, OwnerTraitValue>
}

interface TraitStats {
  leagueMean: number
  withinOwnerSD: number
  betweenOwnerSD: number
  icc: number
  observedMin: number
  observedMax: number
}

interface OwnerProfilesData {
  meta: { humanPlayer: string }
  traitStats: Record<OwnerTraitName, TraitStats>
  owners: OwnerProfile[]
}

const profiles = data as OwnerProfilesData

export const HUMAN_OWNER_NAME = profiles.meta.humanPlayer
export const TRAIT_STATS = profiles.traitStats

// The eleven bots — every owner in the file except the human (Ian and the
// unlabelled 2017 season are already excluded upstream, per the file's
// own meta.note).
export const BOT_OWNERS: OwnerProfile[] = profiles.owners.filter((o) => o.name !== HUMAN_OWNER_NAME)

export type DrawnOwnerTraits = Record<OwnerTraitName, number>

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

// Implementation section's per-draft trait draw, verbatim:
//   centre = owner.traits[trait].useThis
//   sd     = traitStats[trait].withinOwnerSD      // league-wide, not owner-specific —
//                                                     eight seasons per owner isn't enough
//                                                     to estimate an individual spread
//   drawn  = clamp(normal(centre, sd), observedMin, observedMax)
export function drawOwnerTraits(owner: OwnerProfile, rng: RNG): DrawnOwnerTraits {
  const drawn = {} as DrawnOwnerTraits
  for (const trait of Object.keys(owner.traits) as OwnerTraitName[]) {
    const stats = TRAIT_STATS[trait]
    const centre = owner.traits[trait].useThis
    drawn[trait] = clamp(randNormal(rng, centre, stats.withinOwnerSD), stats.observedMin, stats.observedMax)
  }
  return drawn
}
