// Drives an interactive draft, one nomination at a time: whoever's turn it
// is nominates a player, every eligible team's bid is on the table, and
// the human always sees the auction and must hit Continue to move on —
// whether they nominated it, a bot did, or nobody ends up bidding at all.
// This is an auction, not a snake draft: every team has a real look at
// every player and a real chance to bid on every single one, so nothing
// resolves or advances without the human's own action. See
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
import { playerKey } from '../sim/valuation'
import { canBidOnPositionSafely, isRosterFull, legalMaxBid, type Team } from '../sim/roster'
import { HUMAN_OWNER_NAME } from '../sim/ownerProfiles'

export type DraftPhase = 'nominating' | 'auctioning' | 'complete'

export interface CurrentAuction {
  player: Player
  botBids: Bid[]
  humanBid: number
  humanEligible: boolean
  // The human's own bid submissions for this player, in order — bots'
  // bids stay private until someone wins, same as a real auction.
  bidLog: number[]
  // Captured at nomination time, before the rotation pointer advances
  // further — needed to reverse this specific pick if the human undoes it.
  nominationPointerBefore: number
}

export interface DraftController {
  state: DraftState
  humanTeam: Team
  botStates: BotState[]
  phase: DraftPhase
  currentAuction: CurrentAuction | null
  standing: ReturnType<typeof currentStanding>
  seed: number
  // Purely a bookmark for the player pool table (star + "watch only"
  // filter) — no longer affects draft pacing. Every auction pauses
  // regardless of whether the player is watched.
  watchList: Set<string>
  canUndo: boolean
  nominatePlayer: (player: Player) => void
  autoNominate: () => void
  setHumanBid: (amount: number) => void
  raiseBid: () => void
  passBid: () => void
  confirmAndAdvance: () => void
  toggleWatch: (player: Player) => void
  undoLastPick: () => void
  restart: (seed?: number) => void
}

const HUMAN_TEAM_ID = 1
const WATCHLIST_KEY = 'stafford-mock-draft:watchlist'

interface PickSnapshot {
  pickNumberBefore: number
  nominationPointerBefore: number
  logLengthBefore: number
  draftedLengthBefore: number
  player: Player
}

interface ControllerInternals {
  state: DraftState
  botStates: BotState[]
  botMaxBidFn: ReturnType<typeof createRealBotMaxBidFn>
  botNominate: ReturnType<typeof createBotNominationStrategy>
  phase: DraftPhase
  currentAuction: CurrentAuction | null
  lastPick: PickSnapshot | null
  seed: number
}

function loadWatchList(): Set<string> {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function createInternals(data: DraftData, seed: number, humanName: string): ControllerInternals {
  const state = createInitialState(data, seed)
  const humanTeam = state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
  humanTeam.name = humanName
  const botTeamIds = state.teams.filter((t) => t.id !== HUMAN_TEAM_ID).map((t) => t.id)
  const botStates = createBotStates(botTeamIds, data, state.rng)
  // BOT_PERSONALITIES.md: "label the bots with the real names" — team.name
  // is what every live panel (OtherTeams, ResultsScreen) actually renders.
  for (const bot of botStates) {
    state.teams.find((t) => t.id === bot.teamId)!.name = bot.name
  }
  return {
    state,
    botStates,
    botMaxBidFn: createRealBotMaxBidFn(botStates),
    botNominate: createBotNominationStrategy(botStates),
    phase: 'nominating',
    currentAuction: null,
    lastPick: null,
    seed,
  }
}

// nextNominator() mutates state.nominationPointer as a side effect of
// finding the next eligible team. Peeking at whose turn it is (to decide
// whether it's the human's own nomination) without committing to it needs
// the same search logic minus that mutation.
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

// Sets up whatever needs the human's attention next: the draft being over,
// the human's own nomination turn, or the auction for whatever a bot just
// nominated. Every nomination ends up here and stays here until the human
// calls confirmAndAdvance — there is no automatic resolution, and nothing
// ever skips ahead on its own. That's the actual mechanic of an auction
// draft: every team gets a real look at every player.
function setupNextStep(c: ControllerInternals): void {
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

  const nominationPointerBefore = c.state.nominationPointer
  const nominator = nextNominator(c.state)!
  const player = c.botNominate(c.state, nominator)
  if (!player) {
    c.phase = 'complete'
    c.currentAuction = null
    return
  }

  const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
  const botBids = computeBotBids(c.state, player, c.botMaxBidFn, HUMAN_TEAM_ID)
  const humanEligible = !isRosterFull(humanTeam) && canBidOnPositionSafely(c.state.teams, c.state.undrafted, humanTeam, player.pos)

  c.phase = 'auctioning'
  c.currentAuction = { player, botBids, humanBid: 0, humanEligible, bidLog: [], nominationPointerBefore }
}

export function useDraftController(data: DraftData, seed: number, humanName = HUMAN_OWNER_NAME): DraftController {
  const [version, forceRender] = useState(0)
  const bump = useCallback(() => forceRender((n) => n + 1), [])

  const [watchList, setWatchList] = useState<Set<string>>(loadWatchList)

  const ref = useRef<ControllerInternals | null>(null)
  if (ref.current === null) {
    ref.current = createInternals(data, seed, humanName)
    setupNextStep(ref.current)
  }
  const ctrl = ref.current

  const nominatePlayer = useCallback(
    (player: Player) => {
      const c = ref.current!
      if (c.phase !== 'nominating') return
      if (peekNextNominatorId(c.state) !== HUMAN_TEAM_ID) return

      const nominationPointerBefore = c.state.nominationPointer
      nextNominator(c.state) // commits the rotation slot

      const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
      const botBids = computeBotBids(c.state, player, c.botMaxBidFn, HUMAN_TEAM_ID)
      const humanEligible = !isRosterFull(humanTeam) && canBidOnPositionSafely(c.state.teams, c.state.undrafted, humanTeam, player.pos)
      c.phase = 'auctioning'
      c.currentAuction = { player, botBids, humanBid: 0, humanEligible, bidLog: [], nominationPointerBefore }
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
      const bidLog = next > c.currentAuction.humanBid ? [...c.currentAuction.bidLog, next] : c.currentAuction.bidLog
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

    const snapshot: PickSnapshot = {
      pickNumberBefore: c.state.pickNumber,
      nominationPointerBefore: c.currentAuction.nominationPointerBefore,
      logLengthBefore: c.state.log.length,
      draftedLengthBefore: c.state.drafted.length,
      player: c.currentAuction.player,
    }
    const result = finalizeAuction(c.state, c.currentAuction.botBids, humanTeam, c.currentAuction.humanBid)
    applyAuctionResult(c.state, c.currentAuction.player, result)
    if (result?.winner) c.lastPick = snapshot
    c.currentAuction = null

    setupNextStep(c)
    bump()
  }, [bump])

  const toggleWatch = useCallback((player: Player) => {
    setWatchList((prev) => {
      const key = playerKey(player)
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...next]))
      } catch {
        // localStorage unavailable (e.g. private browsing) — watch list just won't persist.
      }
      return next
    })
  }, [])

  const undoLastPick = useCallback(() => {
    const c = ref.current!
    const snap = c.lastPick
    if (!snap) return

    const appliedPickNumber = snap.pickNumberBefore + 1
    for (const team of c.state.teams) {
      const slot = team.slots.find((s) => s.filled?.pickNumber === appliedPickNumber)
      if (slot?.filled) {
        team.spent -= slot.filled.price
        slot.filled = null
        break
      }
    }
    c.state.undrafted.push(snap.player)
    c.state.pickNumber = snap.pickNumberBefore
    c.state.nominationPointer = snap.nominationPointerBefore
    c.state.log.length = snap.logLengthBefore
    c.state.drafted.length = snap.draftedLengthBefore
    c.lastPick = null
    c.currentAuction = null

    setupNextStep(c)
    bump()
  }, [bump])

  const restart = useCallback(
    (newSeed?: number) => {
      const s = newSeed ?? ref.current!.seed
      ref.current = createInternals(data, s, humanName)
      setupNextStep(ref.current)
      bump()
    },
    [bump, data, humanName],
  )

  const humanTeam = ctrl.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
  const standing = useMemo(() => {
    if (!ctrl.currentAuction) return null
    return currentStanding(ctrl.currentAuction.botBids, humanTeam, ctrl.currentAuction.humanBid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl.currentAuction, humanTeam, version])

  return {
    state: ctrl.state,
    humanTeam,
    botStates: ctrl.botStates,
    phase: ctrl.phase,
    currentAuction: ctrl.currentAuction,
    standing,
    seed: ctrl.seed,
    watchList,
    canUndo: ctrl.lastPick !== null,
    nominatePlayer,
    autoNominate,
    setHumanBid,
    raiseBid,
    passBid,
    confirmAndAdvance,
    toggleWatch,
    undoLastPick,
    restart,
  }
}
