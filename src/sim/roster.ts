// A team's roster and the $200 budget rules (spec §1).

import type { FlexEligiblePosition, Player, Position } from './types'

export type SlotType = Position | 'FLEX' | 'BENCH'

export interface DraftedPick {
  player: Player
  price: number
  pickNumber: number
}

export interface RosterSlot {
  type: SlotType
  // Which positions can fill this slot.
  eligible: Position[]
  filled: DraftedPick | null
}

export interface Team {
  id: number
  name: string
  budget: number
  spent: number
  slots: RosterSlot[]
}

const FLEX_ELIGIBLE: FlexEligiblePosition[] = ['RB', 'WR', 'TE']

// Builds the fixed 14-slot roster shape from meta.starters / meta.bench.
// Bench slots only accept flex-eligible positions: the spec is explicit that
// a team with a filled position group can't bid on it "except where the
// player is flex-eligible and a flex or bench slot remains" — so there is no
// backup QB or DEF slot.
export function createRosterSlots(starters: string[], bench: number): RosterSlot[] {
  const slots: RosterSlot[] = starters.map((s) =>
    s === 'FLEX'
      ? { type: 'FLEX' as const, eligible: FLEX_ELIGIBLE, filled: null }
      : { type: s as Position, eligible: [s as Position], filled: null },
  )
  for (let i = 0; i < bench; i++) {
    slots.push({ type: 'BENCH', eligible: FLEX_ELIGIBLE, filled: null })
  }
  return slots
}

export function createTeam(id: number, name: string, budget: number, starters: string[], bench: number): Team {
  return { id, name, budget, spent: 0, slots: createRosterSlots(starters, bench) }
}

export function openSlots(team: Team): RosterSlot[] {
  return team.slots.filter((s) => s.filled === null)
}

export function isRosterFull(team: Team): boolean {
  return openSlots(team).length === 0
}

// Max legal bid (spec §1): budget - spent - (openSlots - 1). A team must
// always leave at least $1 for every other slot it still has to fill.
export function legalMaxBid(team: Team): number {
  const open = openSlots(team).length
  return team.budget - team.spent - Math.max(open - 1, 0)
}

export function canBidOnPosition(team: Team, pos: Position): boolean {
  return openSlots(team).some((s) => s.eligible.includes(pos))
}

// Which open slot a drafted player should fill: the exact-position slot
// first, then FLEX, then BENCH — so flex/bench stay open for later
// flexibility rather than being used up on a player who had a dedicated
// slot available.
export function pickSlotFor(team: Team, pos: Position): RosterSlot | null {
  const open = openSlots(team)
  return (
    open.find((s) => s.type === pos) ??
    open.find((s) => s.type === 'FLEX' && s.eligible.includes(pos)) ??
    open.find((s) => s.type === 'BENCH' && s.eligible.includes(pos)) ??
    null
  )
}

// Assigns a drafted player to a team's roster and deducts the price.
// Returns false (and changes nothing) if the team has no eligible open slot.
export function assignPlayer(team: Team, player: Player, price: number, pickNumber: number): boolean {
  const slot = pickSlotFor(team, player.pos)
  if (!slot) return false
  slot.filled = { player, price, pickNumber }
  team.spent += price
  return true
}
