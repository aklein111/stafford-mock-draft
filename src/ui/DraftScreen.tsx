import './DraftScreen.css'
import { useDraftController } from './useDraftController'
import { TopBar } from './TopBar'
import { MyTeam } from './MyTeam'
import { OtherTeams } from './OtherTeams'
import { AuctionPanel } from './AuctionPanel'
import { PlayerPool } from './PlayerPool'
import type { DraftData } from '../sim/types'

export function DraftScreen({ data, seed }: { data: DraftData; seed: number }) {
  const controller = useDraftController(data, seed)
  const otherTeams = controller.state.teams.filter((t) => t.id !== controller.humanTeam.id)

  return (
    <div className="draft-screen">
      <TopBar state={controller.state} />
      <MyTeam team={controller.humanTeam} />
      <AuctionPanel controller={controller} />
      <OtherTeams teams={otherTeams} />
      <PlayerPool
        state={controller.state}
        canNominate={controller.phase === 'nominating'}
        onNominate={controller.nominatePlayer}
      />
    </div>
  )
}
