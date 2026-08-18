import { openSlots, type Team } from '../sim/roster'

function neededPositions(team: Team): string {
  const open = openSlots(team)
  if (open.length === 0) return 'roster full'
  const counts = new Map<string, number>()
  for (const slot of open) {
    counts.set(slot.type, (counts.get(slot.type) ?? 0) + 1)
  }
  return [...counts.entries()].map(([type, n]) => (n > 1 ? `${type} x${n}` : type)).join(', ')
}

export function OtherTeams({ teams }: { teams: Team[] }) {
  return (
    <div className="panel right-panel">
      <h2>Other Teams</h2>
      {teams.map((team) => {
        const open = openSlots(team).length
        return (
          <div className="team-card" key={team.id}>
            <div className="team-card-header">
              <span>{team.name}</span>
              <span>${team.budget - team.spent}</span>
            </div>
            <div className="team-card-needs">
              {open} slot{open === 1 ? '' : 's'} left · needs: {neededPositions(team)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
