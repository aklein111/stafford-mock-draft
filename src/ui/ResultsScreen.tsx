import type { DraftController } from './useDraftController'
import type { Position } from '../sim/types'

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'DEF']

export function ResultsScreen({ controller }: { controller: DraftController }) {
  const { state, humanTeam, botStates, seed, restart } = controller

  const myPicks = humanTeam.slots.filter((s) => s.filled).map((s) => s.filled!)

  const spendByPos = new Map<Position, { spent: number; blended: number }>()
  for (const pos of POSITIONS) spendByPos.set(pos, { spent: 0, blended: 0 })
  for (const pick of myPicks) {
    const row = spendByPos.get(pick.player.pos)!
    row.spent += pick.price
    row.blended += pick.player.blended
  }

  const byValue = [...myPicks].sort((a, b) => a.player.blended - a.price - (b.player.blended - b.price))
  const steals = byValue.slice(0, 5) // paid well under blended
  const reaches = [...byValue].reverse().slice(0, 5) // paid well over blended

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto', color: '#e5e7eb' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Draft Complete</h1>
      <p style={{ color: '#9ca3af', marginTop: 0 }}>
        Seed {seed} · You spent ${humanTeam.spent} of ${humanTeam.budget}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <button onClick={() => restart()}>Replay this exact draft (same seed)</button>
        <button className="secondary" onClick={() => restart(Date.now())}>
          Start a new random draft
        </button>
      </div>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Your spend by position vs. blended (market anchor)</h2>
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>You spent</th>
              <th>Blended (for these picks)</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {POSITIONS.map((pos) => {
              const row = spendByPos.get(pos)!
              const delta = row.spent - row.blended
              return (
                <tr key={pos}>
                  <td>{pos}</td>
                  <td>${row.spent}</td>
                  <td>${row.blended}</td>
                  <td style={{ color: delta > 0 ? '#f59e0b' : delta < 0 ? '#34d399' : undefined }}>
                    {delta > 0 ? '+' : ''}
                    {delta}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Biggest steals / biggest reaches</h2>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div style={{ flex: 1 }}>
            <h3>Steals (paid under blended)</h3>
            {steals.map((p) => (
              <div className="slot-row" key={p.pickNumber}>
                <span>
                  {p.player.name} ({p.player.pos})
                </span>
                <span style={{ color: '#34d399' }}>
                  ${p.price} vs ${p.player.blended}
                </span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <h3>Reaches (paid over blended)</h3>
            {reaches.map((p) => (
              <div className="slot-row" key={p.pickNumber}>
                <span>
                  {p.player.name} ({p.player.pos})
                </span>
                <span style={{ color: '#f59e0b' }}>
                  ${p.price} vs ${p.player.blended}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Final rosters</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
          {state.teams.map((team) => (
            <div key={team.id} style={{ background: '#161a22', borderRadius: '6px', padding: '0.75rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
                {team.id === humanTeam.id ? `${team.name} (you)` : team.name} — ${team.spent}
              </div>
              {team.slots.map((slot, i) => (
                <div className="slot-row" key={i}>
                  <span className="slot-type">{slot.type}</span>
                  <span>{slot.filled ? `${slot.filled.player.name} $${slot.filled.price}` : '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Who you were actually up against</h2>
        <p style={{ color: '#9ca3af', marginTop: 0, fontSize: '0.85rem' }}>
          Real Stafford managers, redrawn this draft around their own historical tendencies — see BOT_PERSONALITIES.md.
          These numbers weren't shown to you during the draft.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {botStates.map((bot) => {
            const team = state.teams.find((t) => t.id === bot.teamId)!
            const d = bot.drawnTraits
            return (
              <div key={bot.teamId} style={{ background: '#161a22', borderRadius: '6px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 600 }}>{team.name}</div>
                <div style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                  QB {(d.qbShare * 100).toFixed(0)}% · RB {(d.rbShare * 100).toFixed(0)}% · WR {(d.wrShare * 100).toFixed(0)}% · TE{' '}
                  {(d.teShare * 100).toFixed(0)}% of budget
                </div>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                  top-3 concentration {(d.top3Concentration * 100).toFixed(0)}% · biggest buy ${(d.biggestBuy * team.budget).toFixed(0)} ·{' '}
                  {(d.dollarPlayers).toFixed(1)} $1-2 slots · overpay {d.overpayRatio.toFixed(2)}x
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
