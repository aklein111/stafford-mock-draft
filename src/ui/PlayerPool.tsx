import { useMemo, useState } from 'react'
import type { DraftState } from '../sim/draftState'
import type { Player, Position } from '../sim/types'
import { playerKey } from '../sim/valuation'

type SortKey = 'marketRank' | 'posRank' | 'tier' | 'blended'

const POSITIONS: (Position | 'ALL')[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF']

export function PlayerPool({
  state,
  canNominate,
  watchList,
  revealPrices,
  onNominate,
  onToggleWatch,
}: {
  state: DraftState
  canNominate: boolean
  watchList: Set<string>
  revealPrices: boolean
  onNominate: (player: Player) => void
  onToggleWatch: (player: Player) => void
}) {
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL')
  const [watchOnly, setWatchOnly] = useState(false)
  // Ordered by marketRank (Yahoo's consensus) by default, per REVISIONS.md
  // change 1 — not by anything derived from a personal opinion.
  const [sortKey, setSortKey] = useState<SortKey>('marketRank')
  const [sortDesc, setSortDesc] = useState(false)

  const draftedByKey = useMemo(() => {
    const m = new Map<string, { price: number; teamName: string }>()
    for (const d of state.drafted) {
      m.set(playerKey(d.player), { price: d.price, teamName: findTeamName(state, d) })
    }
    return m
  }, [state])

  const rows = useMemo(() => {
    let players = state.data.players
    if (posFilter !== 'ALL') players = players.filter((p) => p.pos === posFilter)
    if (watchOnly) players = players.filter((p) => watchList.has(playerKey(p)))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      players = players.filter((p) => p.name.toLowerCase().includes(q))
    }
    const sorted = [...players].sort((a, b) => (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]))
    return sorted
  }, [state.data.players, posFilter, watchOnly, watchList, search, sortKey, sortDesc])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(false)
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
        <button
          className={`pos-filter-btn ${watchOnly ? 'active' : ''}`}
          onClick={() => setWatchOnly((w) => !w)}
          title="Show only starred players"
        >
          ★ Watched
        </button>
        <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{rows.length} players</span>
      </div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Team</th>
            <th>Pos</th>
            <th onClick={() => toggleSort('marketRank')}>Market Rank</th>
            <th onClick={() => toggleSort('posRank')}>Pos Rank</th>
            <th onClick={() => toggleSort('tier')}>Tier</th>
            {revealPrices && <th onClick={() => toggleSort('blended')}>Blended</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const key = playerKey(p)
            const drafted = draftedByKey.get(key)
            const watched = watchList.has(key)
            return (
              <tr key={key} className={drafted ? 'drafted' : ''}>
                <td>
                  <span
                    onClick={() => onToggleWatch(p)}
                    style={{ cursor: 'pointer', color: watched ? '#f59e0b' : '#4b5563' }}
                    title={watched ? 'Remove from watch list' : 'Add to watch list'}
                  >
                    ★
                  </span>
                </td>
                <td>{p.name}</td>
                <td>{p.team}</td>
                <td>{p.pos}</td>
                <td>{p.marketRank}</td>
                <td>{p.posRank}</td>
                <td>{p.tier}</td>
                {revealPrices && <td>${p.blended}</td>}
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
