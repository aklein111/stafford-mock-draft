import { legalMaxBid, openSlots, type Team } from '../sim/roster'

export function MyTeam({ team }: { team: Team }) {
  const open = openSlots(team).length
  const remaining = team.budget - team.spent
  const perSlot = remaining / Math.max(open, 1)

  return (
    <div className="panel left-panel">
      <h2>My Team</h2>
      <div className="stat" style={{ marginBottom: '0.75rem' }}>
        <span className="stat-label">Budget remaining</span>
        <span className="stat-value">${remaining}</span>
      </div>
      <div className="stat" style={{ marginBottom: '0.75rem' }}>
        <span className="stat-label">Max legal bid</span>
        <span className="stat-value">${legalMaxBid(team)}</span>
      </div>
      <div className="stat" style={{ marginBottom: '1rem' }}>
        <span className="stat-label">$ per remaining slot</span>
        <span className="stat-value">${perSlot.toFixed(1)}</span>
      </div>
      <h3>Roster ({team.slots.length - open}/{team.slots.length})</h3>
      {team.slots.map((slot, i) => (
        <div className="slot-row" key={i}>
          <span className="slot-type">{slot.type}</span>
          {slot.filled ? (
            <span>
              {slot.filled.player.name} <span style={{ color: '#9ca3af' }}>${slot.filled.price}</span>
            </span>
          ) : (
            <span className="slot-empty">open</span>
          )}
        </div>
      ))}
    </div>
  )
}
