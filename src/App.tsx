import { draftData } from './sim/data'

// Placeholder screen. The real interface (§5 of the spec) is built in a
// later phase; this just confirms the data loads and the project runs.
export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Stafford Mock Draft</h1>
      <p>
        Data loaded: {draftData.players.length} players, {draftData.meta.teams} teams, $
        {draftData.meta.budget} budget each.
      </p>
      <p>The draft engine and UI are still under construction.</p>
    </div>
  )
}
