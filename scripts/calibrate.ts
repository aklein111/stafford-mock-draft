// Calibration harness (REVISIONS.md Fix 2d): runs many headless bots-only
// drafts and prints a comparison table against the real Stafford draft
// shape recorded in calibration.targets — the price of the Nth-most-
// expensive player, what share of all the money the top N players soak up,
// and how many players land in each price band.
//
// REVISIONS.md's framing: this isn't a "clearing prices average out to the
// right level" problem, it's a "shape" problem — is the draft top-heavy in
// the way a real one is? So the single knob this script tunes is CENTERING
// (NOISE_K is fixed at 0.35 as of step 3). It auto-searches for a CENTERING
// value that makes the top-24 share land within 2 points of the 48% target
// and the $1-2 band land within about 5 players of the 53.1 target, prints
// a before/after table, and — if it converges — writes the result back into
// constants.ts.
//
// Usage:
//   npm run calibrate                          (auto-search from the current CENTERING)
//   npm run calibrate -- --drafts=200           (drafts per measurement)
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
}

function runDrafts(centering: number, count: number, seed: number): DraftState[] {
  const states: DraftState[] = []
  for (let i = 0; i < count; i++) {
    states.push(createFullBotDraft(draftData, seed + i, undefined, { centering }))
  }
  return states
}

function computeMetrics(states: DraftState[]): Metrics {
  const bands = draftData.calibration.targets.priceBands
  const nthSums: Record<number, number> = {}
  const shareSums: Record<number, number> = {}
  const bandSums = bands.map(() => 0)
  let totalSpend = 0

  for (const state of states) {
    const prices = state.drafted.map((d) => d.price).sort((a, b) => b - a)
    const total = prices.reduce((a, b) => a + b, 0)
    totalSpend += total

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
  }
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function printTable(centering: number, drafts: number, m: Metrics) {
  const targets = draftData.calibration.targets

  console.log(`\n--- CENTERING=${centering}  (${drafts} drafts, NOISE_K=${NOISE_K}) ---`)

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

// Convergence per REVISIONS.md Fix 2d: top-24 share within 2 points of 48%,
// and the $1-2 band within about 5 of 53.
function isConverged(m: Metrics): boolean {
  const targets = draftData.calibration.targets
  const top24Delta = Math.abs(m.share[24] - targets.topNShareOfPool['24']) * 100
  const dollarBand = targets.priceBands.find((b) => b.low === 1 && b.high === 2)!
  const dollarBandIdx = targets.priceBands.indexOf(dollarBand)
  const dollarDelta = Math.abs(m.bandCounts[dollarBandIdx] - dollarBand.playersPerDraft)
  return top24Delta <= 2 && dollarDelta <= 5
}

// Auto-search for CENTERING (REVISIONS.md Fix 2d): "Adjust a single global
// CENTERING multiplier applied to every bot valuation — lower it if the top
// is too expensive, raise it if too cheap. Repeat until [converged]."
// CENTERING is additive here (base = blended + centering, see valuation.ts),
// and its effect on top-heaviness isn't obvious from the formula alone — an
// additive bump is a *smaller* relative change for expensive players than
// cheap ones, so which direction actually raises the top-24 share has to be
// measured, not assumed. Secant search treats it as root-finding on
// f(centering) = top24Share(centering) - target and takes each step from
// the two most recent measurements, so it corrects its own direction
// instead of hardcoding one.
function search(startCentering: number, drafts: number, seed: number, maxIterations: number) {
  const evalAt = (centering: number) => {
    const states = runDrafts(centering, drafts, seed)
    return { centering, metrics: computeMetrics(states) }
  }

  const target = draftData.calibration.targets.topNShareOfPool['24']
  const f = (m: Metrics) => m.share[24] - target

  let prev = evalAt(startCentering)
  console.log(`\n[search] iteration 0: CENTERING=${prev.centering} -> top24Share=${(prev.metrics.share[24] * 100).toFixed(1)}%`)
  if (isConverged(prev.metrics)) return { history: [prev], converged: true }

  // Probe a second point to get a slope estimate for the secant method.
  const probeStep = 15
  let curr = evalAt(startCentering + probeStep)
  console.log(`[search] iteration 1: CENTERING=${curr.centering} -> top24Share=${(curr.metrics.share[24] * 100).toFixed(1)}%`)

  const history = [prev, curr]

  for (let i = 2; i < maxIterations; i++) {
    if (isConverged(curr.metrics)) return { history, converged: true }

    const fPrev = f(prev.metrics)
    const fCurr = f(curr.metrics)
    let next: number
    if (Math.abs(fCurr - fPrev) < 1e-6) {
      // Flat response — nudge in the direction that reduces the gap.
      next = curr.centering + (fCurr < 0 ? probeStep : -probeStep)
    } else {
      next = curr.centering - fCurr * (curr.centering - prev.centering) / (fCurr - fPrev)
    }
    // Keep the search in a sane range — the anchor values here run roughly
    // $1-$70, so a swing much past +/-100 isn't a real candidate.
    next = Math.max(-100, Math.min(150, Math.round(next)))

    prev = curr
    curr = evalAt(next)
    console.log(`[search] iteration ${i}: CENTERING=${curr.centering} -> top24Share=${(curr.metrics.share[24] * 100).toFixed(1)}%`)
    history.push(curr)
  }

  return { history, converged: isConverged(curr.metrics) }
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

  console.log(`Running calibration against calibration.targets (${args.drafts} drafts/measurement, NOISE_K=${NOISE_K})`)

  const baselineStates = runDrafts(DEFAULT_CENTERING, args.drafts, args.seed)
  const baselineMetrics = computeMetrics(baselineStates)
  printTable(DEFAULT_CENTERING, args.drafts, baselineMetrics)
  console.log(`\nBaseline converged: ${isConverged(baselineMetrics) ? 'yes' : 'no'}`)

  if (!args.search) return

  if (isConverged(baselineMetrics)) {
    console.log('\nAlready within target — no search needed.')
    return
  }

  const { history, converged } = search(DEFAULT_CENTERING, args.drafts, args.seed + 500000, 8)
  const gap = (m: Metrics) => Math.abs(m.share[24] - draftData.calibration.targets.topNShareOfPool['24'])
  const best = history.reduce((a, b) => (gap(a.metrics) < gap(b.metrics) ? a : b))

  console.log(`\n=== Final validation run (200 drafts) at CENTERING=${best.centering} ===`)
  const finalStates = runDrafts(best.centering, 200, args.seed + 900000)
  const finalMetrics = computeMetrics(finalStates)
  printTable(best.centering, 200, finalMetrics)

  const finalConverged = isConverged(finalMetrics)
  console.log(`\nSearch converged: ${converged ? 'yes' : 'no (used closest CENTERING found)'}`)
  console.log(`Final validation converged: ${finalConverged ? 'yes' : 'no'}`)

  if (finalConverged) {
    updateConstantsFile(best.centering)
  } else {
    console.log(
      `\nNot updating constants.ts — best CENTERING found (${best.centering}) did not clear both convergence ` +
        `bars on the 200-draft validation run. Re-run with --drafts=400 or widen the search bounds by hand.`,
    )
  }
}

main()
