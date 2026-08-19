// A bot's persistent personality, drawn once at draft start and kept
// hidden from the UI until the draft ends (spec §3, §3.1).

import type { Position } from './types'
import type { RNG } from './rng'
import { randRange } from './rng'
import { RESTRAINT_MAX, RESTRAINT_MIN } from './constants'

export interface BotTraits {
  aggression: number // 0.90-1.10, flat multiplier on every valuation
  positionBias: Record<Position, number> // per-position multiplier
  starPreference: number // -0.10 to +0.10
  disciplineDecay: number // 0.5-1.5
  noiseScale: number // 0.7-1.3
  // REVISIONS.md Fix 2b — a bot's walk-away price is valuation x
  // restraint, not the full valuation: real managers set a number and
  // stop rather than bidding until it's merely illegal to continue.
  restraint: number // 0.85-0.95
}

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'DEF']

function neutralPositionBias(): Record<Position, number> {
  return { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 }
}

// The room archetypes called out in spec §3.1: "roughly two bots are
// RB-heavy, two WR-heavy, one takes a QB early, one punts TE, and the rest
// are near neutral."
export type Archetype = 'RB_HEAVY' | 'WR_HEAVY' | 'EARLY_QB' | 'PUNT_TE' | 'NEUTRAL'

function positionBiasFor(archetype: Archetype, rng: RNG): Record<Position, number> {
  const bias = neutralPositionBias()
  switch (archetype) {
    case 'RB_HEAVY':
      bias.RB = randRange(rng, 1.05, 1.15)
      bias.WR = randRange(rng, 0.9, 0.98)
      break
    case 'WR_HEAVY':
      bias.WR = randRange(rng, 1.05, 1.15)
      bias.RB = randRange(rng, 0.9, 0.98)
      break
    case 'EARLY_QB':
      bias.QB = randRange(rng, 1.1, 1.25)
      break
    case 'PUNT_TE':
      bias.TE = randRange(rng, 0.75, 0.9)
      break
    case 'NEUTRAL':
      for (const pos of POSITIONS) bias[pos] = randRange(rng, 0.97, 1.03)
      break
  }
  return bias
}

// Assigns one archetype per bot: the first six (in a shuffled order, so
// it's not always the same team ids) get the specific archetypes the spec
// names, and everyone else is neutral.
export function assignArchetypes(count: number, rng: RNG): Archetype[] {
  const named: Archetype[] = ['RB_HEAVY', 'RB_HEAVY', 'WR_HEAVY', 'WR_HEAVY', 'EARLY_QB', 'PUNT_TE']
  const archetypes: Archetype[] = named.slice(0, count)
  while (archetypes.length < count) archetypes.push('NEUTRAL')

  for (let i = archetypes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[archetypes[i], archetypes[j]] = [archetypes[j], archetypes[i]]
  }
  return archetypes
}

function traitsForArchetype(archetype: Archetype, rng: RNG): BotTraits {
  return {
    aggression: randRange(rng, 0.9, 1.1),
    positionBias: positionBiasFor(archetype, rng),
    starPreference: randRange(rng, -0.1, 0.1),
    disciplineDecay: randRange(rng, 0.5, 1.5),
    noiseScale: randRange(rng, 0.7, 1.3),
    restraint: randRange(rng, RESTRAINT_MIN, RESTRAINT_MAX),
  }
}

export function generateBotTraits(count: number, rng: RNG): BotTraits[] {
  const archetypes = assignArchetypes(count, rng)
  return archetypes.map((archetype) => traitsForArchetype(archetype, rng))
}

export interface BotPersonality {
  archetype: Archetype
  traits: BotTraits
}

// Same generation as generateBotTraits, but keeps the archetype label
// alongside each bot's traits — the spec's post-draft reveal (§5) wants
// to show what kind of drafter each bot actually was, not just raw
// numbers. Kept hidden from the UI until the draft ends, same as the
// traits themselves.
export function generateBotPersonalities(count: number, rng: RNG): BotPersonality[] {
  const archetypes = assignArchetypes(count, rng)
  return archetypes.map((archetype) => ({ archetype, traits: traitsForArchetype(archetype, rng) }))
}

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  RB_HEAVY: 'RB-heavy',
  WR_HEAVY: 'WR-heavy',
  EARLY_QB: 'Takes a QB early',
  PUNT_TE: 'Punts TE',
  NEUTRAL: 'Neutral',
}
