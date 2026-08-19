// RAW_DATA_ADDENDUM.md, Method A — empirical residuals in place of a
// fitted normal distribution for a bot's per-player noise, plus the
// timing-effect curve that used to live in the old data file's
// `calibration.timingMultiplier`/`positionTiming` and no longer exists as
// a precomputed field now that the raw picks are the source of truth
// (format note 3: "nominationPick is nomination order... Use it for
// timing effects").
//
// Both are derived from the same single pass over leagueHistory.rawPicks,
// after dropping what the addendum's format notes say to drop: keeper
// picks (priced below market at prior salary + $10) and the seven
// `--empty--` placeholder rows.

import type { DraftData, Position, RawPick } from './types'

export interface HistoricalDerived {
  // The nine (or fewer, for a thin position/rank) historical price/target
  // ratios for this exact positional rank, pooled with its +/-3 nearest
  // ranks at the same position for a large enough sample to draw from.
  residualPool(pos: Position, rank: number): number[]
  // Decile (0-9) multiplier on "expected price" by how far through the
  // draft a player at this position was historically nominated, derived
  // per-position where there's enough data and falling back to the
  // all-position average where there isn't.
  timingMultiplier(pos: Position, decile: number): number
}

const DECILES = 10
const POOL_RADIUS = 3
// A per-position decile bucket average is shrunk toward the all-position
// curve for that decile, weighted as if SHRINKAGE_WEIGHT "phantom"
// overall-average observations were mixed in. QB/TE/DEF only have
// ~10-15 raw picks per decile bucket (vs 50+ for RB/WR) -- exactly the
// "too few observations to be stable on its own" the addendum warns about
// for positional-value smoothing, just showing up here in the timing
// derivation instead. A thin bucket (e.g. n=9) ends up close to the
// overall curve; a well-sampled one (n=50+) barely moves.
const SHRINKAGE_WEIGHT = 15

function isUsablePick(p: RawPick): p is RawPick & { pos: Position } {
  return !p.keeper && p.pos !== null && p.player !== '--empty--'
}

function average(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 1
}

function shrinkTowards(xs: number[], prior: number, weight: number): number {
  return (xs.reduce((a, b) => a + b, 0) + prior * weight) / (xs.length + weight)
}

export function deriveHistoricalData(data: DraftData): HistoricalDerived {
  const targetByPosRank = new Map<string, number>()
  for (const pv of data.positionalValues) {
    targetByPosRank.set(`${pv.pos}:${pv.rank}`, pv.target)
  }

  // Group usable (non-keeper, non-empty) picks by (year, pos) so each
  // season's own positional rank — what "RB5" means for that year — can
  // be computed directly by sorting on salary, independent of anything
  // pre-summarized.
  const byYearPos = new Map<string, RawPick[]>()
  for (const p of data.leagueHistory.rawPicks) {
    if (!isUsablePick(p)) continue
    const key = `${p.year}:${p.pos}`
    const arr = byYearPos.get(key)
    if (arr) arr.push(p)
    else byYearPos.set(key, [p])
  }

  const residualsByPosRank = new Map<string, number[]>()
  const overallDecileRatios: number[][] = Array.from({ length: DECILES }, () => [])
  const posDecileRatios = new Map<Position, number[][]>()

  const picksPerSeason = data.leagueHistory.seasons[0]?.picks ?? data.priceCurve.length

  for (const [key, picks] of byYearPos) {
    const pos = key.split(':')[1] as Position
    const sorted = [...picks].sort((a, b) => b.salary - a.salary)

    sorted.forEach((pick, i) => {
      const rank = i + 1
      const target = targetByPosRank.get(`${pos}:${rank}`)
      if (target === undefined || target <= 0) return

      const residual = pick.salary / target
      const rKey = `${pos}:${rank}`
      const existing = residualsByPosRank.get(rKey)
      if (existing) existing.push(residual)
      else residualsByPosRank.set(rKey, [residual])

      const progress = picksPerSeason > 1 ? Math.max(0, Math.min(1, (pick.nominationPick - 1) / (picksPerSeason - 1))) : 0
      const decile = Math.min(DECILES - 1, Math.floor(progress * DECILES))
      overallDecileRatios[decile].push(residual)

      let posBuckets = posDecileRatios.get(pos)
      if (!posBuckets) {
        posBuckets = Array.from({ length: DECILES }, () => [])
        posDecileRatios.set(pos, posBuckets)
      }
      posBuckets[decile].push(residual)
    })
  }

  const overallTiming = overallDecileRatios.map(average)
  const posTiming = new Map<Position, number[]>()
  for (const [pos, buckets] of posDecileRatios) {
    posTiming.set(
      pos,
      buckets.map((ratios, i) => shrinkTowards(ratios, overallTiming[i], SHRINKAGE_WEIGHT)),
    )
  }

  function residualPool(pos: Position, rank: number): number[] {
    const pooled: number[] = []
    for (let r = Math.max(1, rank - POOL_RADIUS); r <= rank + POOL_RADIUS; r++) {
      const arr = residualsByPosRank.get(`${pos}:${r}`)
      if (arr) pooled.push(...arr)
    }
    return pooled
  }

  function timingMultiplier(pos: Position, decile: number): number {
    return posTiming.get(pos)?.[decile] ?? overallTiming[decile] ?? 1
  }

  return { residualPool, timingMultiplier }
}

const derivedCache = new WeakMap<DraftData, HistoricalDerived>()

// Memoized per DraftData object — deriveHistoricalData does a full pass
// over every historical pick, and timingFactor calls this on every single
// bid evaluation, so recomputing from scratch each time would mean
// re-scanning 1500+ picks per bid.
export function getHistoricalDerived(data: DraftData): HistoricalDerived {
  let cached = derivedCache.get(data)
  if (!cached) {
    cached = deriveHistoricalData(data)
    derivedCache.set(data, cached)
  }
  return cached
}
