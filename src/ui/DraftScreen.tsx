import { useState } from 'react'
import './DraftScreen.css'
import { useDraftController } from './useDraftController'
import { TopBar } from './TopBar'
import { MyTeam } from './MyTeam'
import { OtherTeams } from './OtherTeams'
import { AuctionPanel } from './AuctionPanel'
import { PlayerPool } from './PlayerPool'
import { ResultsScreen } from './ResultsScreen'
import type { DraftData } from '../sim/types'

export function DraftScreen({ data, seed }: { data: DraftData; seed: number }) {
  const controller = useDraftController(data, seed)
  const otherTeams = controller.state.teams.filter((t) => t.id !== controller.humanTeam.id)
  // REVISIONS.md change 1: hidden by default — "the point is to practice
  // reading the room, not to read a number off a screen."
  const [revealPrices, setRevealPrices] = useState(false)

  if (controller.phase === 'complete') {
    return <ResultsScreen controller={controller} />
  }

  return (
    <div className="draft-screen">
      <TopBar controller={controller} revealPrices={revealPrices} onToggleRevealPrices={() => setRevealPrices((r) => !r)} />
      <MyTeam team={controller.humanTeam} />
      <AuctionPanel controller={controller} revealPrices={revealPrices} />
      <OtherTeams teams={otherTeams} />
      <PlayerPool
        state={controller.state}
        canNominate={controller.phase === 'nominating'}
        watchList={controller.watchList}
        revealPrices={revealPrices}
        onNominate={controller.nominatePlayer}
        onToggleWatch={controller.toggleWatch}
      />
    </div>
  )
}
