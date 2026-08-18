import type { DraftState } from '../sim/draftState'
import { computeInflation, inflationFactor } from '../sim/valuation'

export function TopBar({ state }: { state: DraftState }) {
  const totalSlots = state.data.meta.teams * state.data.meta.rosterSpots
  const progress = totalSlots > 0 ? Math.min(1, state.pickNumber / totalSlots) : 0
  const decile = Math.min(10, Math.floor(progress * 10))

  const totalSpent = state.teams.reduce((sum, t) => sum + t.spent, 0)
  const spentFraction = state.data.meta.totalPool > 0 ? totalSpent / state.data.meta.totalPool : 0
  const paceTarget = state.data.calibration.moneyClock[decile] ?? 1

  const inflation = computeInflation(state)
  const infFactor = inflationFactor(inflation)

  const paceDelta = spentFraction - paceTarget
  const paceClass = paceDelta > 0.05 ? 'warn' : paceDelta < -0.05 ? 'good' : ''

  return (
    <div className="panel top-bar">
      <div className="stat">
        <span className="stat-label">Pick</span>
        <span className="stat-value">
          {state.pickNumber} / {totalSlots}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Money spent (pace: {(paceTarget * 100).toFixed(0)}%)</span>
        <span className={`stat-value ${paceClass}`}>{(spentFraction * 100).toFixed(0)}%</span>
      </div>
      <div className="stat">
        <span className="stat-label">Live inflation</span>
        <span className={`stat-value ${infFactor > 1.05 ? 'warn' : infFactor < 0.95 ? 'good' : ''}`}>
          {infFactor.toFixed(2)}x
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Players drafted</span>
        <span className="stat-value">{state.drafted.length}</span>
      </div>
    </div>
  )
}
