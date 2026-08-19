// Calibration harness (REVISIONS.md Fix 2d): runs many headless bots-only
// drafts and prints a comparison table against the real Stafford draft
// shape recorded in validationTargets — the price of the Nth-most-
// expensive player, what share of all the money the top N players soak up,
// and how many players land in each price band.
//
// REVISIONS.md's framing: this isn't a "clearing prices average out to the
// right level" problem, it's a "shape" problem — is the draft top-heavy in
// the way a real one is? So the single knob this script tunes is CENTERING
// (NOISE_K is fixed at 0.35 as of step 3): it grid-searches CENTERING for a
// value that puts the top-24 share within 2 points of the 48% target and
// the $1-2 band within about 5 players of the 53.1 target, prints a
// before/after table, and — only if it converges — writes the result back
// into constants.ts.
//
// Roster completion is a hard safety rail on the search, not a target of
// its own: CENTERING is additive (base = blended + centering, see
// valuation.ts), so pushing it negative shrinks cheap players' valuations
// toward $0 much faster than expensive ones, and once enough bots value a
// player at literally $0 nobody bids on it at all — the slot goes unfilled
// instead of clearing cheap. That does inflate the top-N share (less money
// competing for the bottom of the pool), but it does it by breaking the
// draft, not by reproducing the real one's shape. Any CENTERING candidate
// that drops team roster completion below SAFE_FILL_RATE is excluded from
// consideration before the two validationTargets bars are even checked.
//
// Usage:
//   npm run calibrate                          (grid-search CENTERING)
//   npm run calibrate -- --drafts=200           (drafts per grid point)
//   npm run calibrate -- --no-search            (just report the current CENTERING, no tuning)

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { draftData } from '../src/sim/data'
import { createFullBotDraft } from '../src/sim/draft'
import { NOISE_K, CENTERING as DEFAULT_CENTERING } from '../src/sim/constants'
import type { DraftState } from '../src/sim/draftState'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONSTANTS_PATH = path.join(__dirname, '../src/sim/constants.ts')

const SAFE_FILL_RATE = 0.97

interface Args {
  drafts: number
  seed: number
  search: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { drafts: 200, seed: 200000, search: true }
  for (const raw of argv) {
    if (raw === '--no-search') {
      args.search = false
      continue
    }
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (value === undefined) continue
    if (key === 'drafts') args.drafts = Number(value)
    else if (key === 'seed') args.seed = Number(value)
  }
  return args
}

const TOP_N_RANKS = [1, 3, 5, 12, 24, 36, 60, 100]
const SHARE_NS = [12, 24, 36, 60]

interface Metrics {
  nth: Record<number, number>
  share: Record<number, number>
  bandCounts: number[]
  meanSpend: number
  fillRate: number
}

function runDrafts(centering: number, count: number, seed: number): DraftState[] {
  const states: DraftState[] = []
  for (let i = 0; i < count; i++) {
    states.push(createFullBotDraft(draftData, seed + i, undefined, { centering }))
  }
  return states
}

function computeMetrics(states: DraftState[]): Metrics {
  const bands = draftData.validationTargets.priceBands
  const nthSums: Record<number, number> = {}
  const shareSums: Record<number, number> = {}
  const bandSums = bands.map(() => 0)
  let totalSpend = 0
  let teamCount = 0
  let filledTeams = 0

  for (const state of states) {
    const prices = state.drafted.map((d) => d.price).sort((a, b) => b - a)
    const total = prices.reduce((a, b) => a + b, 0)
    totalSpend += total

    for (const team of state.teams) {
      teamCount += 1
      if (team.slots.every((s) => s.filled)) filledTeams += 1
    }

    for (const n of TOP_N_RANKS) {
      nthSums[n] = (nthSums[n] ?? 0) + (prices[n - 1] ?? 0)
    }
    for (const n of SHARE_NS) {
      const topSum = prices.slice(0, n).reduce((a, b) => a + b, 0)
      shareSums[n] = (shareSums[n] ?? 0) + (total > 0 ? topSum / total : 0)
    }
    for (const price of prices) {
      const idx = bands.findIndex((b) => price >= b.low && (b.high === null || price <= b.high))
      if (idx >= 0) bandSums[idx] += 1
    }
  }

  const n = states.length
  const nth: Record<number, number> = {}
  for (const k of TOP_N_RANKS) nth[k] = nthSums[k] / n
  const share: Record<number, number> = {}
  for (const k of SHARE_NS) share[k] = shareSums[k] / n

  return {
    nth,
    share,
    bandCounts: bandSums.map((s) => s / n),
    meanSpend: totalSpend / n,
    fillRate: filledTeams / teamCount,
  }
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function printTable(centering: number, drafts: number, m: Metrics) {
  const targets = draftData.validationTargets

  console.log(`\n--- CENTERING=${centering}  (${drafts} drafts, NOISE_K=${NOISE_K}) ---`)
  console.log(`roster completion: ${(m.fillRate * 100).toFixed(1)}% of teams filled all slots`)

  console.log('\nNth most expensive player:')
  console.log(pad('N', 6) + pad('simulated', 12) + pad('target', 10) + pad('delta', 10))
  for (const k of TOP_N_RANKS) {
    const sim = m.nth[k]
    const target = targets.nthMostExpensive[String(k)]
    console.log(pad(String(k), 6) + pad(sim.toFixed(1), 12) + pad(target.toFixed(1), 10) + pad((sim - target).toFixed(1), 10))
  }

  console.log('\nTop-N share of pool:')
  console.log(pad('N', 6) + pad('simulated', 12) + pad('target', 10) + pad('delta(pts)', 12))
  for (const k of SHARE_NS) {
    const sim = m.share[k]
    const target = targets.topNShareOfPool[String(k)]
    console.log(
      pad(String(k), 6) +
        pad((sim * 100).toFixed(1) + '%', 12) +
        pad((target * 100).toFixed(1) + '%', 10) +
        pad(((sim - target) * 100).toFixed(1), 12),
    )
  }

  console.log('\nPrice bands (players per draft):')
  console.log(pad('band', 10) + pad('simulated', 12) + pad('target', 10) + pad('delta', 10))
  targets.priceBands.forEach((band, i) => {
    const label = band.high === null ? `$${band.low}+` : `$${band.low}-${band.high}`
    const sim = m.bandCounts[i]
    console.log(pad(label, 10) + pad(sim.toFixed(1), 12) + pad(band.playersPerDraft.toFixed(1), 10) + pad((sim - band.playersPerDraft).toFixed(1), 10))
  })

  console.log(`\nmean total spend/draft: $${m.meanSpend.toFixed(0)} (of $${draftData.meta.teams * draftData.meta.budget})`)
}

function top24Gap(m: Metrics): number {
  return Math.abs(m.share[24] - draftData.validationTargets.topNShareOfPool['24']) * 100
}

function dollarBandIndex(): number {
  return draftData.validationTargets.priceBands.findIndex((b) => b.low === 1 && b.high === 2)
}

function dollarGap(m: Metrics): number {
  const idx = dollarBandIndex()
  return Math.abs(m.bandCounts[idx] - draftData.validationTargets.priceBands[idx].playersPerDraft)
}

function isSafe(m: Metrics): boolean {
  return m.fillRate >= SAFE_FILL_RATE
}

// Convergence per REVISIONS.md Fix 2d: top-24 share within 2 points of 48%,
// and the $1-2 band within about 5 of 53 — plus the roster-completion
// safety rail described up top.
function isConverged(m: Metrics): boolean {
  return isSafe(m) && top24Gap(m) <= 2 && dollarGap(m) <= 5
}

interface Candidate {
  centering: number
  metrics: Metrics
}

// Grid search rather than a gradient method: the earlier exploration for
// this step found the fill-rate cliff sits right next to CENTERING=0 (99%
// filled at -0.5, 30% filled at -1, <1% by -5), so a method that chases the
// top-24 share alone (which keeps improving as roster completion collapses)
// will walk straight off that cliff. A bounded grid plus the explicit
// isSafe() filter is the straightforward way to never evaluate "best" over
// a candidate that broke the draft to get there.
function gridSearch(drafts: number, seed: number): Candidate[] {
  const candidates: Candidate[] = []
  for (let step = -12; step <= 12; step += 1) {
    const centering = Math.round(step * 0.25 * 100) / 100
    const states = runDrafts(centering, drafts, seed)
    const metrics = computeMetrics(states)
    candidates.push({ centering, metrics })
    console.log(
      `  CENTERING=${pad(centering.toFixed(2), 6)}  fill=${pad((metrics.fillRate * 100).toFixed(1) + '%', 7)}` +
        `  top24Share=${pad((metrics.share[24] * 100).toFixed(1) + '%', 7)} (gap ${top24Gap(metrics).toFixed(1)}pt)` +
        `  $1-2=${pad(metrics.bandCounts[dollarBandIndex()].toFixed(1), 6)} (gap ${dollarGap(metrics).toFixed(1)})` +
        `  ${isSafe(metrics) ? '' : 'UNSAFE (roster completion broken)'}`,
    )
  }
  return candidates
}

function pickBest(candidates: Candidate[]): Candidate {
  const safe = candidates.filter((c) => isSafe(c.metrics))
  const pool = safe.length > 0 ? safe : candidates
  // Normalize each gap by its convergence bar so the two targets are
  // weighted roughly evenly, then take the best combined score.
  const score = (m: Metrics) => top24Gap(m) / 2 + dollarGap(m) / 5
  return pool.reduce((a, b) => (score(a.metrics) <= score(b.metrics) ? a : b))
}

function updateConstantsFile(newCentering: number) {
  const src = readFileSync(CONSTANTS_PATH, 'utf8')
  const updated = src.replace(/export const CENTERING = -?\d+(\.\d+)?/, `export const CENTERING = ${newCentering}`)
  if (updated === src) {
    console.log('\n(could not find `export const CENTERING = ...` to update in constants.ts — left it untouched)')
    return
  }
  writeFileSync(CONSTANTS_PATH, updated)
  console.log(`\nUpdated src/sim/constants.ts: CENTERING = ${newCentering}`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(`Running calibration against validationTargets (${args.drafts} drafts/measurement, NOISE_K=${NOISE_K})`)

  const baselineStates = runDrafts(DEFAULT_CENTERING, args.drafts, args.seed)
  const baselineMetrics = computeMetrics(baselineStates)
  printTable(DEFAULT_CENTERING, args.drafts, baselineMetrics)
  console.log(`\nBaseline converged: ${isConverged(baselineMetrics) ? 'yes' : 'no'}`)

  if (!args.search) return

  if (isConverged(baselineMetrics)) {
    console.log('\nAlready within target — no search needed.')
    return
  }

  console.log(`\n=== Grid search over CENTERING (${args.drafts} drafts/point) ===`)
  const candidates = gridSearch(args.drafts, args.seed + 500000)
  const best = pickBest(candidates)

  console.log(`\n=== Final validation run (200 drafts) at best candidate CENTERING=${best.centering} ===`)
  const finalStates = runDrafts(best.centering, 200, args.seed + 900000)
  const finalMetrics = computeMetrics(finalStates)
  printTable(best.centering, 200, finalMetrics)

  const finalConverged = isConverged(finalMetrics)
  console.log(`\nFinal validation converged (both targets + roster-completion rail): ${finalConverged ? 'yes' : 'no'}`)

  if (finalConverged) {
    updateConstantsFile(best.centering)
  } else {
    console.log(
      `\nNot updating constants.ts automatically. Best safe CENTERING found: ${best.centering} ` +
        `(top-24 share gap ${top24Gap(finalMetrics).toFixed(1)}pt, $1-2 band gap ${dollarGap(finalMetrics).toFixed(1)}, ` +
        `roster completion ${(finalMetrics.fillRate * 100).toFixed(1)}%).\n` +
        `If the top-24 share gap is the blocker: within the CENTERING range that keeps roster completion above ` +
        `${(SAFE_FILL_RATE * 100).toFixed(0)}%, the top-24 share does not appear to reach the 48% target at all — see the grid above. ` +
        `Pushing CENTERING further negative does raise it, but only by making bots value cheap players at $0, ` +
        `so nobody bids and those roster slots go unfilled instead of clearing cheap. That's a different knob's ` +
        `problem (or a deliberate spec tradeoff), not something this script should paper over by picking an unsafe value.`,
    )
  }
}

main()
