// Drives an interactive draft: bot-only nominations and auctions resolve
// immediately and automatically; the human's own nomination turn and any
// auction they're eligible to bid in pause for input. See
// src/sim/humanAuction.ts for how a human's bid is combined with
// precomputed bot bids, and MOCK_DRAFT_SPEC.md §5 for what the resulting
// screen needs to show.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { DraftData, Player } from '../sim/types'
import { createInitialState, type DraftState } from '../sim/draftState'
import { createBotStates, createRealBotMaxBidFn, type BotState } from '../sim/bots'
import { createBotNominationStrategy, nextNominator } from '../sim/nomination'
import { applyAuctionResult, isDraftComplete, type Bid } from '../sim/engine'
import { computeBotBids, currentStanding, finalizeAuction } from '../sim/humanAuction'
import { canBidOnPosition, isRosterFull, legalMaxBid, type Team } from '../sim/roster'

export type DraftPhase = 'nominating' | 'auctioning' | 'complete'

export interface CurrentAuction {
  player: Player
  botBids: Bid[]
  humanBid: number
  humanEligible: boolean
  // The human's own bid submissions for this player, in order — bots'
  // bids stay private until someone wins, same as a real auction.
  bidLog: number[]
}

export interface DraftController {
  state: DraftState
  humanTeam: Team
  phase: DraftPhase
  currentAuction: CurrentAuction | null
  standing: ReturnType<typeof currentStanding>
  nominatePlayer: (player: Player) => void
  autoNominate: () => void
  setHumanBid: (amount: number) => void
  raiseBid: () => void
  passBid: () => void
  confirmAndAdvance: () => void
}

const HUMAN_TEAM_ID = 1

interface ControllerInternals {
  state: DraftState
  botStates: BotState[]
  botMaxBidFn: ReturnType<typeof createRealBotMaxBidFn>
  botNominate: ReturnType<typeof createBotNominationStrategy>
  phase: DraftPhase
  currentAuction: CurrentAuction | null
}

// nextNominator() mutates state.nominationPointer as a side effect of
// finding the next eligible team. Peeking at whose turn it is (to decide
// whether to pause for the human) without committing to it needs the same
// search logic minus that mutation.
function peekNextNominatorId(state: DraftState): number | null {
  const n = state.nominationOrder.length
  for (let i = 0; i < n; i++) {
    const idx = (state.nominationPointer + i) % n
    const teamId = state.nominationOrder[idx]
    const team = state.teams.find((t) => t.id === teamId)!
    if (!isRosterFull(team)) return teamId
  }
  return null
}

// Auto-resolves bot-vs-bot auctions one after another until either the
// human's own nomination turn comes up, the human is eligible to bid on
// whatever a bot just nominated, or the draft is complete.
function advanceUntilInputNeeded(c: ControllerInternals) {
  // A safety net against an unexpected infinite loop, not a normal
  // stopping condition — matches runFullDraft's maxSteps guard.
  for (let guard = 0; guard < 10000; guard++) {
    if (isDraftComplete(c.state)) {
      c.phase = 'complete'
      c.currentAuction = null
      return
    }

    const nominatorId = peekNextNominatorId(c.state)
    if (nominatorId === null) {
      c.phase = 'complete'
      c.currentAuction = null
      return
    }

    if (nominatorId === HUMAN_TEAM_ID) {
      c.phase = 'nominating'
      c.currentAuction = null
      return
    }

    const nominator = nextNominator(c.state)!
    const player = c.botNominate(c.state, nominator)
    if (!player) {
      c.phase = 'complete'
      c.currentAuction = null
      return
    }

    const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
    const botBids = computeBotBids(c.state, player, c.botMaxBidFn, HUMAN_TEAM_ID)
    const humanEligible = !isRosterFull(humanTeam) && canBidOnPosition(humanTeam, player.pos)

    if (humanEligible) {
      c.phase = 'auctioning'
      c.currentAuction = { player, botBids, humanBid: 0, humanEligible: true, bidLog: [] }
      return
    }

    const result = finalizeAuction(c.state, botBids, humanTeam, 0)
    applyAuctionResult(c.state, player, result)
    // loop: keep auto-resolving until the human has something to do
  }
}

export function useDraftController(data: DraftData, seed: number, humanName = 'You'): DraftController {
  const [, forceRender] = useState(0)
  const bump = useCallback(() => forceRender((n) => n + 1), [])

  const ref = useRef<ControllerInternals | null>(null)

  if (ref.current === null) {
    const state = createInitialState(data, seed)
    const humanTeam = state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
    humanTeam.name = humanName
    const botTeamIds = state.teams.filter((t) => t.id !== HUMAN_TEAM_ID).map((t) => t.id)
    const botStates = createBotStates(botTeamIds, data.players, state.rng)
    ref.current = {
      state,
      botStates,
      botMaxBidFn: createRealBotMaxBidFn(botStates),
      botNominate: createBotNominationStrategy(botStates),
      phase: 'nominating',
      currentAuction: null,
    }
    advanceUntilInputNeeded(ref.current)
  }

  const ctrl = ref.current

  const nominatePlayer = useCallback(
    (player: Player) => {
      const c = ref.current!
      if (c.phase !== 'nominating') return
      if (peekNextNominatorId(c.state) !== HUMAN_TEAM_ID) return

      nextNominator(c.state) // commits the rotation slot

      const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
      const botBids = computeBotBids(c.state, player, c.botMaxBidFn, HUMAN_TEAM_ID)
      const humanEligible = !isRosterFull(humanTeam) && canBidOnPosition(humanTeam, player.pos)
      c.phase = 'auctioning'
      c.currentAuction = { player, botBids, humanBid: 0, humanEligible, bidLog: [] }
      bump()
    },
    [bump],
  )

  const autoNominate = useCallback(() => {
    const c = ref.current!
    if (c.phase !== 'nominating') return
    const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
    const player = c.botNominate(c.state, humanTeam)
    if (player) nominatePlayer(player)
  }, [nominatePlayer])

  const setHumanBid = useCallback(
    (amount: number) => {
      const c = ref.current!
      if (!c.currentAuction) return
      const next = Math.max(0, Math.round(amount))
      const bidLog =
        next > c.currentAuction.humanBid ? [...c.currentAuction.bidLog, next] : c.currentAuction.bidLog
      c.currentAuction = { ...c.currentAuction, humanBid: next, bidLog }
      bump()
    },
    [bump],
  )

  const raiseBid = useCallback(() => {
    const c = ref.current!
    if (!c.currentAuction || !c.currentAuction.humanEligible) return
    const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
    const standing = currentStanding(c.currentAuction.botBids, humanTeam, c.currentAuction.humanBid)
    const nextBid = (standing?.price ?? 0) + 1
    setHumanBid(Math.min(nextBid, legalMaxBid(humanTeam)))
  }, [setHumanBid])

  const passBid = useCallback(() => setHumanBid(0), [setHumanBid])

  const confirmAndAdvance = useCallback(() => {
    const c = ref.current!
    if (c.phase !== 'auctioning' || !c.currentAuction) return
    const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
    const result = finalizeAuction(c.state, c.currentAuction.botBids, humanTeam, c.currentAuction.humanBid)
    applyAuctionResult(c.state, c.currentAuction.player, result)
    c.currentAuction = null
    advanceUntilInputNeeded(c)
    bump()
  }, [bump])

  const humanTeam = ctrl.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
  const standing = useMemo(() => {
    if (!ctrl.currentAuction) return null
    return currentStanding(ctrl.currentAuction.botBids, humanTeam, ctrl.currentAuction.humanBid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl.currentAuction, humanTeam])

  return {
    state: ctrl.state,
    humanTeam,
    phase: ctrl.phase,
    currentAuction: ctrl.currentAuction,
    standing,
    nominatePlayer,
    autoNominate,
    setHumanBid,
    raiseBid,
    passBid,
    confirmAndAdvance,
  }
}
