// Variance check (REVISIONS.md Change 3, step 5): now that the draft is
// calibrated (step 4), confirm the remaining randomness is two-sided
// rather than a still-biased model wearing a coat of noise.
//
// Two things to check, both stated explicitly in Change 3:
//
// 1. Across many drafts, a given player should land below `blended`
//    roughly as often as above. If a player clears above blended in 80%+
//    of simulations, that's bias, not variance.
// 2. Roster need should be genuinely gating bids — when only a few teams
//    still need a position, a player at that position should go cheap
//    relative to `blended`. That's what produces the late-draft bargains
//    that make a mock draft worth practising.
//
// Usage:
//   npm run check-variance
//   npm run check-variance -- --drafts=200

import { draftData } from '../src/sim/data'
import { createFullBotDraft } from '../src/sim/draft'
import type { Team } from '../src/sim/roster'
import { playerKey } from '../src/sim/valuation'
import type { DraftState } from '../src/sim/draftState'
import type { Player } from '../src/sim/types'

interface Args {
  drafts: number
  seed: number
  minAppearances: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { drafts: 200, seed: 300000, minAppearances: 20 }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (value === undefined) continue
    if (key === 'drafts') args.drafts = Number(value)
    else if (key === 'seed') args.seed = Number(value)
    else if (key === 'minAppearances') args.minAppearances = Number(value)
  }
  return args
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

// ---- Part 1: is the variance two-sided? ----

interface PlayerStats {
  name: string
  pos: string
  blended: number
  appearances: number
  above: number
  below: number
  at: number
  sumPrice: number
}

function checkTwoSidedVariance(states: DraftState[], minAppearances: number) {
  const byPlayer = new Map<string, PlayerStats>()
  let totalAbove = 0
  let totalBelow = 0
  let totalAt = 0
  let totalPicks = 0

  for (const state of states) {
    for (const pick of state.drafted) {
      const key = playerKey(pick.player)
      let stats = byPlayer.get(key)
      if (!stats) {
        stats = { name: pick.player.name, pos: pick.player.pos, blended: pick.player.blended, appearances: 0, above: 0, below: 0, at: 0, sumPrice: 0 }
        byPlayer.set(key, stats)
      }
      stats.appearances += 1
      stats.sumPrice += pick.price
      totalPicks += 1
      if (pick.price > pick.player.blended) {
        stats.above += 1
        totalAbove += 1
      } else if (pick.price < pick.player.blended) {
        stats.below += 1
        totalBelow += 1
      } else {
        stats.at += 1
        totalAt += 1
      }
    }
  }

  console.log('\n=== Part 1: is the variance two-sided? (REVISIONS.md Change 3) ===')
  console.log(
    `\nAcross all ${totalPicks} picks: ${((totalAbove / totalPicks) * 100).toFixed(1)}% above blended, ` +
      `${((totalBelow / totalPicks) * 100).toFixed(1)}% below, ${((totalAt / totalPicks) * 100).toFixed(1)}% exactly at.`,
  )

  const eligible = [...byPlayer.values()].filter((p) => p.appearances >= minAppearances)
  console.log(`\n${eligible.length} players drafted at least ${minAppearances}/${states.length} times (sample large enough to judge).`)

  const biasedAbove = eligible.filter((p) => p.above / p.appearances >= 0.8)
  const biasedBelow = eligible.filter((p) => p.below / p.appearances >= 0.8)
  console.log(`Players landing above blended in 80%+ of their appearances: ${biasedAbove.length}`)
  console.log(`Players landing below blended in 80%+ of their appearances: ${biasedBelow.length}`)

  const worst = [...eligible].sort((a, b) => Math.abs(a.above / a.appearances - 0.5) - Math.abs(b.above / b.appearances - 0.5))
  const mostSkewed = worst.slice(-15).reverse()

  console.log('\nMost skewed players (by |aboveFraction - 0.5|):')
  console.log(pad('player', 22) + pad('pos', 5) + pad('blended', 9) + pad('n', 6) + pad('above%', 8) + pad('below%', 8) + pad('meanPrice', 10))
  for (const p of mostSkewed) {
    console.log(
      pad(p.name, 22) +
        pad(p.pos, 5) +
        pad(p.blended.toFixed(1), 9) +
        pad(String(p.appearances), 6) +
        pad(((p.above / p.appearances) * 100).toFixed(0) + '%', 8) +
        pad(((p.below / p.appearances) * 100).toFixed(0) + '%', 8) +
        pad((p.sumPrice / p.appearances).toFixed(1), 10),
    )
  }

  return { biasedAboveCount: biasedAbove.length, biasedBelowCount: biasedBelow.length, eligibleCount: eligible.length }
}

// ---- Part 2: does roster need actually gate bids? ----

// Reconstructs, for a finished draft, how many teams still had an
// eligible open slot for `pos` immediately before `pickNumber` — using
// only the final roster state (every filled slot records the pickNumber
// that filled it), no engine hooks needed. A slot counts as "open at
// pickNumber" if it was never filled, or filled by a *later* pick.
function demandCountAt(teams: Team[], pos: Player['pos'], pickNumber: number): number {
  let count = 0
  for (const team of teams) {
    const hasOpenEligibleSlot = team.slots.some(
      (slot) => (slot.filled === null || slot.filled.pickNumber >= pickNumber) && slot.eligible.includes(pos),
    )
    if (hasOpenEligibleSlot) count += 1
  }
  return count
}

function checkRosterNeedGating(states: DraftState[]) {
  const byDemand = new Map<number, { n: number; sumRatio: number; sumPrice: number; sumBlended: number }>()

  for (const state of states) {
    for (const pick of state.drafted) {
      if (pick.player.blended <= 0) continue
      const demand = demandCountAt(state.teams, pick.player.pos, pick.pickNumber)
      const ratio = pick.price / pick.player.blended
      let bucket = byDemand.get(demand)
      if (!bucket) {
        bucket = { n: 0, sumRatio: 0, sumPrice: 0, sumBlended: 0 }
        byDemand.set(demand, bucket)
      }
      bucket.n += 1
      bucket.sumRatio += ratio
      bucket.sumPrice += pick.price
      bucket.sumBlended += pick.player.blended
    }
  }

  console.log('\n=== Part 2: does roster need gate bids? (REVISIONS.md Change 3) ===')
  console.log('\nprice/blended ratio, grouped by how many teams still had an eligible open slot at pick time:')
  console.log(pad('teams needing', 15) + pad('n picks', 10) + pad('mean price', 12) + pad('mean blended', 13) + pad('price/blended', 14))

  const demands = [...byDemand.keys()].sort((a, b) => a - b)
  for (const d of demands) {
    const b = byDemand.get(d)!
    console.log(
      pad(String(d), 15) + pad(String(b.n), 10) + pad((b.sumPrice / b.n).toFixed(1), 12) + pad((b.sumBlended / b.n).toFixed(1), 13) + pad((b.sumRatio / b.n).toFixed(2), 14),
    )
  }

  // Pearson correlation between demand count and price/blended ratio,
  // across individual picks (not the bucketed means) — a real negative
  // correlation confirms need is gating bids, not just a coincidence in
  // the bucket means above.
  const points: { x: number; y: number }[] = []
  for (const state of states) {
    for (const pick of state.drafted) {
      if (pick.player.blended <= 0) continue
      points.push({ x: demandCountAt(state.teams, pick.player.pos, pick.pickNumber), y: pick.price / pick.player.blended })
    }
  }
  const n = points.length
  const meanX = points.reduce((a, p) => a + p.x, 0) / n
  const meanY = points.reduce((a, p) => a + p.y, 0) / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (const p of points) {
    cov += (p.x - meanX) * (p.y - meanY)
    varX += (p.x - meanX) ** 2
    varY += (p.y - meanY) ** 2
  }
  const correlation = cov / Math.sqrt(varX * varY)
  console.log(`\nPearson correlation (teams needing the position vs price/blended ratio): ${correlation.toFixed(3)}`)
  console.log(
    correlation > 0.1
      ? '  -> positive: more competition for a position does coincide with higher relative prices (need is gating bids as intended).'
      : '  -> weak or negative: roster need does not appear to be gating bids the way Change 3 expects.',
  )

  return { correlation }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  console.log(`Running ${args.drafts} bot-only drafts to check variance shape (REVISIONS.md Change 3)...`)

  const states: DraftState[] = []
  for (let i = 0; i < args.drafts; i++) {
    states.push(createFullBotDraft(draftData, args.seed + i))
  }

  const variance = checkTwoSidedVariance(states, args.minAppearances)
  const gating = checkRosterNeedGating(states)

  console.log('\n=== Summary ===')
  console.log(
    `Two-sided variance: ${variance.biasedAboveCount === 0 && variance.biasedBelowCount === 0 ? 'yes, no player is one-sided at the 80% threshold' : `${variance.biasedAboveCount} player(s) biased above, ${variance.biasedBelowCount} biased below, out of ${variance.eligibleCount} with enough samples`}`,
  )
  console.log(`Roster-need gating: ${gating.correlation > 0.1 ? 'confirmed' : 'NOT confirmed — investigate'}`)
}

main()
