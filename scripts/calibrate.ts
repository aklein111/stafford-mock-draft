// Calibration harness (spec §4.3): runs many headless bots-only drafts and
// prints a comparison table against the league's real historical numbers.
//
// The spec is explicit that this shouldn't be derived analytically — the
// "winner's curse" (the winner of an auction is whoever drew the highest
// private valuation, so the clearing price tends to run above the true
// average) is hard to correct for with a formula, so instead we run drafts,
// measure the gap, and adjust two knobs (NOISE_K and CENTERING) until it
// closes.
//
// Usage:
//   npm run calibrate                                  (uses constants.ts defaults)
//   npm run calibrate -- --noiseK=0.8 --centering=-4    (try different values)
//   npm run calibrate -- --drafts=50                    (faster, noisier run)

import { draftData } from '../src/sim/data'
import { createFullBotDraft } from '../src/sim/draft'
import {
  NOISE_K as DEFAULT_NOISE_K,
  CENTERING as DEFAULT_CENTERING,
  BACKUP_QB_NEED_FACTOR as DEFAULT_BACKUP_QB_NEED_FACTOR,
} from '../src/sim/constants'
import type { Position } from '../src/sim/types'

interface Args {
  drafts: number
  noiseK: number
  centering: number
  backupQbFactor: number
  seed: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    drafts: 200,
    noiseK: DEFAULT_NOISE_K,
    centering: DEFAULT_CENTERING,
    backupQbFactor: DEFAULT_BACKUP_QB_NEED_FACTOR,
    seed: 100000,
  }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (value === undefined) continue
    if (key === 'drafts') args.drafts = Number(value)
    else if (key === 'noiseK') args.noiseK = Number(value)
    else if (key === 'centering') args.centering = Number(value)
    else if (key === 'backupQbFactor') args.backupQbFactor = Number(value)
    else if (key === 'seed') args.seed = Number(value)
  }
  return args
}

const BUCKETS = [
  { label: '$60+', lo: 60, hi: Infinity },
  { label: '$40-59', lo: 40, hi: 59 },
  { label: '$25-39', lo: 25, hi: 39 },
  { label: '$10-24', lo: 10, hi: 24 },
  { label: '$1-9', lo: 1, hi: 9 },
]

function pad(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const totalSlots = draftData.meta.teams * draftData.meta.rosterSpots

  console.log(
    `Running ${args.drafts} headless bots-only drafts (NOISE_K=${args.noiseK}, CENTERING=${args.centering}, BACKUP_QB_NEED_FACTOR=${args.backupQbFactor})...\n`,
  )

  const bucketSums = BUCKETS.map(() => ({ n: 0, sumBlended: 0, sumPrice: 0 }))
  let totalTeamSpend = 0
  let totalTeamCount = 0
  let fullRosterTeams = 0
  let dollarSpotCount = 0
  let totalSpots = 0
  const posCounts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 }
  const moneyClockObserved = new Array(11).fill(0)

  for (let i = 0; i < args.drafts; i++) {
    const seed = args.seed + i
    const state = createFullBotDraft(draftData, seed, undefined, {
      noiseK: args.noiseK,
      centering: args.centering,
      backupQbFactor: args.backupQbFactor,
    })

    for (const team of state.teams) {
      totalTeamSpend += team.spent
      totalTeamCount += 1
      if (team.slots.every((s) => s.filled)) fullRosterTeams += 1
    }

    const picksInOrder = [...state.drafted].sort((a, b) => a.pickNumber - b.pickNumber)
    const totalDraftSpend = picksInOrder.reduce((s, d) => s + d.price, 0)

    let runningSpend = 0
    let pickIdx = 0
    for (let c = 0; c <= 10; c++) {
      const targetPicks = Math.round((c / 10) * picksInOrder.length)
      while (pickIdx < targetPicks) {
        runningSpend += picksInOrder[pickIdx].price
        pickIdx += 1
      }
      moneyClockObserved[c] += totalDraftSpend > 0 ? runningSpend / totalDraftSpend : 0
    }

    for (const pick of picksInOrder) {
      totalSpots += 1
      if (pick.price <= 2) dollarSpotCount += 1
      posCounts[pick.player.pos] += 1

      const bucket = BUCKETS.find((b) => pick.player.blended >= b.lo && pick.player.blended <= b.hi)
      if (bucket) {
        const idx = BUCKETS.indexOf(bucket)
        bucketSums[idx].n += 1
        bucketSums[idx].sumBlended += pick.player.blended
        bucketSums[idx].sumPrice += pick.price
      }
    }
  }

  console.log('=== Clearing price vs expected, by bucket (spec §4.3, target: within 5%) ===')
  console.log(pad('bucket', 8) + pad('n', 7) + pad('meanExpected', 14) + pad('meanPrice', 12) + pad('ratio', 8) + '  within5%')
  let worstDelta = 0
  for (let i = 0; i < BUCKETS.length; i++) {
    const { n, sumBlended, sumPrice } = bucketSums[i]
    if (n === 0) {
      console.log(`${pad(BUCKETS[i].label, 8)}  no picks in this bucket`)
      continue
    }
    const meanExpected = sumBlended / n
    const meanPrice = sumPrice / n
    const ratio = meanPrice / meanExpected
    const delta = Math.abs(ratio - 1)
    worstDelta = Math.max(worstDelta, delta)
    console.log(
      pad(BUCKETS[i].label, 8) +
        pad(String(n), 7) +
        pad(meanExpected.toFixed(1), 14) +
        pad(meanPrice.toFixed(1), 12) +
        pad(ratio.toFixed(2), 8) +
        '  ' +
        (delta <= 0.05 ? 'yes' : 'NO'),
    )
  }

  console.log('\n=== Total spend per team (spec §8, target: $200) ===')
  console.log(`mean spend/team: $${(totalTeamSpend / totalTeamCount).toFixed(2)}`)
  console.log(`teams with all 14 slots filled: ${fullRosterTeams}/${totalTeamCount}`)

  console.log('\n=== Money clock (spec §4.1), cumulative spend fraction by decile of picks ===')
  console.log(pad('decile', 8) + pad('observed', 12) + pad('target', 10))
  for (let c = 0; c <= 10; c++) {
    const observed = moneyClockObserved[c] / args.drafts
    const target = draftData.calibration.moneyClock[c]
    console.log(pad(String(c), 8) + pad(observed.toFixed(3), 12) + pad(target !== undefined ? target.toFixed(3) : '-', 10))
  }

  console.log('\n=== $1-2 roster spots (spec §8, target: ~4.4/team, ~31.4% of all spots) ===')
  const dollarSpotFraction = totalSpots > 0 ? dollarSpotCount / totalSpots : 0
  console.log(`observed: ${(dollarSpotFraction * 100).toFixed(1)}%  (~${(dollarSpotFraction * 14).toFixed(1)}/team)`)

  console.log('\n=== Position counts per draft (spec §8, target: calibration.avgRosteredByPos) ===')
  for (const pos of Object.keys(posCounts) as Position[]) {
    const observedPerDraft = posCounts[pos] / args.drafts
    const target = draftData.calibration.avgRosteredByPos[pos]
    console.log(`${pos}: observed ${observedPerDraft.toFixed(1)}   target ${target}`)
  }

  console.log(
    `\nWorst bucket ratio deviation from 1.0: ${(worstDelta * 100).toFixed(1)}%  ` +
      (worstDelta <= 0.05 ? '(within 5% target)' : '(NOT within 5% target)'),
  )
  console.log(`totalSlots (for reference): ${totalSlots}`)

  if (worstDelta > 0.05) {
    console.log(`
--- Known gap (as of the current tuned constants) ---
The $25-39 and $10-24 buckets sit ~7-12% under expected price even at the
best NOISE_K/CENTERING combination found (an extensive sweep is in the commit
history). Diagnosis: those buckets are dominated by RB/WR/TE picks bought
in the middle third of the draft to fill FLEX/BENCH rather than a
dedicated starter slot, and two spec-mandated numbers both discount
exactly that combination at once - needFactor's flex/bench 0.80 (§3.4)
and the real historical timingFactor curve's mid-draft dip (§4.1). Each
is applied faithfully to the letter of the spec on its own; it's their
overlap on this specific segment that a *global* NOISE_K/CENTERING can't
reach without distorting the buckets that are already within target.
Closing this the rest of the way would mean loosening one of those
spec-given numbers (most plausibly the 0.80 flex/bench factor), which
felt like a call for the league owner, not something to silently change.
`)
  }
}

main()
