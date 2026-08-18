import { useState } from 'react'
import type { DraftController } from './useDraftController'

export function AuctionPanel({ controller }: { controller: DraftController }) {
  const { phase, currentAuction, standing, humanTeam, autoNominate, raiseBid, passBid, setHumanBid, confirmAndAdvance } =
    controller
  const [maxBidInput, setMaxBidInput] = useState('')

  if (phase === 'nominating') {
    return (
      <div className="panel center-panel">
        <h2>Your turn to nominate</h2>
        <p className="nominate-hint">Pick a player from the pool below to put up for bid, or let the system choose for you.</p>
        <button onClick={autoNominate}>Auto-nominate for me</button>
      </div>
    )
  }

  // Defensive fallback — shouldn't normally happen while phase is
  // 'auctioning', since the controller always pairs the two.
  if (!currentAuction) {
    return (
      <div className="panel center-panel">
        <button onClick={confirmAndAdvance}>Continue</button>
      </div>
    )
  }

  const { player, humanBid, humanEligible, bidLog } = currentAuction
  const humanIsLeading = standing?.winner?.id === humanTeam.id
  const nextBid = (standing?.price ?? 0) + 1

  return (
    <div className="panel center-panel">
      <div className="auction-player-name">{player.name}</div>
      <div className="auction-player-meta">
        {player.team} · {player.pos} · Tier {player.tier}
      </div>
      <div className="auction-stats">
        <div className="stat">
          <span className="stat-label">My rank</span>
          <span className="stat-value">#{player.myRank}</span>
        </div>
        <div className="stat">
          <span className="stat-label">My value</span>
          <span className="stat-value">${player.myValue}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Expected</span>
          <span className="stat-value">${player.expected}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Edge</span>
          <span className={`stat-value ${player.edge > 0 ? 'good' : player.edge < 0 ? 'warn' : ''}`}>
            {player.edge > 0 ? '+' : ''}
            {player.edge}
          </span>
        </div>
      </div>

      <div className="standing">
        <div className="stat-label">Current high bid</div>
        <div className="stat-value">
          {standing ? (
            <>
              ${standing.price} — {humanIsLeading ? 'you' : standing.winner?.name}
            </>
          ) : (
            'No bids yet'
          )}
        </div>
      </div>

      {!humanEligible && (
        <p className="nominate-hint">You have no open roster slot for this position, so you can't bid — but you can watch.</p>
      )}

      {humanEligible && (
        <>
          <div className="bid-controls">
            <button onClick={raiseBid} disabled={humanIsLeading}>
              Bid ${nextBid}
            </button>
            <input
              type="number"
              placeholder="Max bid"
              value={maxBidInput}
              onChange={(e) => setMaxBidInput(e.target.value)}
              style={{ width: '5.5rem' }}
            />
            <button
              className="secondary"
              onClick={() => {
                const amount = Number(maxBidInput)
                if (Number.isFinite(amount) && amount > 0) setHumanBid(amount)
              }}
            >
              Auto-bid to max
            </button>
            {humanBid > 0 && (
              <button className="secondary" onClick={passBid}>
                Withdraw
              </button>
            )}
          </div>
          {bidLog.length > 0 && (
            <div className="bid-log">Your bids on this player: {bidLog.map((b) => `$${b}`).join(' → ')}</div>
          )}
        </>
      )}

      <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
        <button onClick={confirmAndAdvance}>
          {humanIsLeading ? 'Win at this price & continue' : standing ? 'Continue' : 'Continue (stays in pool)'}
        </button>
      </div>
    </div>
  )
}
