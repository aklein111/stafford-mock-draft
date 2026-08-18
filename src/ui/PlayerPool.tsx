import { useMemo, useState } from 'react'
import type { DraftState } from '../sim/draftState'
import type { Player, Position } from '../sim/types'

type SortKey = 'myRank' | 'myValue' | 'expected' | 'edge' | 'tier'

const POSITIONS: (Position | 'ALL')[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF']

export function PlayerPool({
  state,
  canNominate,
  onNominate,
}: {
  state: DraftState
  canNominate: boolean
  onNominate: (player: Player) => void
}) {
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('edge')
  const [sortDesc, setSortDesc] = useState(true)

  const draftedByKey = useMemo(() => {
    const m = new Map<string, { price: number; teamName: string }>()
    for (const d of state.drafted) {
      m.set(`${d.player.name}|${d.player.team}`, { price: d.price, teamName: findTeamName(state, d) })
    }
    return m
  }, [state])

  const rows = useMemo(() => {
    let players = state.data.players
    if (posFilter !== 'ALL') players = players.filter((p) => p.pos === posFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      players = players.filter((p) => p.name.toLowerCase().includes(q))
    }
    const sorted = [...players].sort((a, b) => (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]))
    return sorted
  }, [state.data.players, posFilter, search, sortKey, sortDesc])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  return (
    <div className="panel bottom-panel">
      <div className="filters">
        <input type="text" placeholder="Search players…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            className={`pos-filter-btn ${posFilter === pos ? 'active' : ''}`}
            onClick={() => setPosFilter(pos)}
          >
            {pos}
          </button>
        ))}
        <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{rows.length} players</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Team</th>
            <th>Pos</th>
            <th onClick={() => toggleSort('myRank')}>My Rank</th>
            <th onClick={() => toggleSort('myValue')}>My Value</th>
            <th onClick={() => toggleSort('expected')}>Expected</th>
            <th onClick={() => toggleSort('edge')}>Edge</th>
            <th onClick={() => toggleSort('tier')}>Tier</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const drafted = draftedByKey.get(`${p.name}|${p.team}`)
            return (
              <tr key={`${p.name}|${p.team}`} className={drafted ? 'drafted' : ''}>
                <td>{p.name}</td>
                <td>{p.team}</td>
                <td>{p.pos}</td>
                <td>{p.myRank}</td>
                <td>${p.myValue}</td>
                <td>${p.expected}</td>
                <td>{p.edge > 0 ? '+' : ''}{p.edge}</td>
                <td>{p.tier}</td>
                <td>
                  {drafted ? (
                    `$${drafted.price} — ${drafted.teamName}`
                  ) : canNominate ? (
                    <button className="secondary" onClick={() => onNominate(p)}>
                      Nominate
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function findTeamName(state: DraftState, drafted: { player: Player; price: number; pickNumber: number }): string {
  for (const team of state.teams) {
    for (const slot of team.slots) {
      if (slot.filled?.pickNumber === drafted.pickNumber) return team.name
    }
  }
  return '?'
}
