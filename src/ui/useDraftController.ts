// Drives an interactive draft: bot-only nominations and auctions resolve
// automatically (immediately at "instant" speed, or paced by a timer at
// 1x/4x); the human's own nomination turn and any auction they're
// eligible to bid in pause for input — unless the player is unwatched and
// bidding has already passed the human's own value for them (spec §5
// Pacing: watch list auto-skip). See src/sim/humanAuction.ts for how a
// human's bid is combined with precomputed bot bids, and
// MOCK_DRAFT_SPEC.md §5 for what the resulting screen needs to show.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftData, Player } from '../sim/types'
import { createInitialState, type DraftState } from '../sim/draftState'
import { createBotStates, createRealBotMaxBidFn, type BotState } from '../sim/bots'
import { createBotNominationStrategy, nextNominator } from '../sim/nomination'
import { applyAuctionResult, isDraftComplete, type Bid } from '../sim/engine'
import { computeBotBids, currentStanding, finalizeAuction } from '../sim/humanAuction'
import { playerKey } from '../sim/valuation'
import { canBidOnPositionSafely, isRosterFull, legalMaxBid, type Team } from '../sim/roster'

export type DraftPhase = 'nominating' | 'auctioning' | 'complete'
export type Speed = 'instant' | '1x' | '4x'

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
  speed: Speed
  watchList: Set<string>
  canUndo: boolean
  nominatePlayer: (player: Player) => void
  autoNominate: () => void
  setHumanBid: (amount: number) => void
  raiseBid: () => void
  passBid: () => void
  confirmAndAdvance: () => void
  toggleWatch: (player: Player) => void
  setSpeed: (speed: Speed) => void
  undoLastPick: () => void
  restart: (seed?: number) => void
}

const HUMAN_TEAM_ID = 1
const WATCHLIST_KEY = 'stafford-mock-draft:watchlist'
const SPEED_KEY = 'stafford-mock-draft:speed'
const SPEED_DELAY_MS: Record<Speed, number> = { instant: 0, '4x': 120, '1x': 500 }

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
  pendingAutoPlay: boolean
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

function loadSpeed(): Speed {
  const raw = localStorage.getItem(SPEED_KEY)
  return raw === '1x' || raw === '4x' || raw === 'instant' ? raw : 'instant'
}

function createInternals(data: DraftData, seed: number, humanName: string): ControllerInternals {
  const state = createInitialState(data, seed)
  const humanTeam = state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
  humanTeam.name = humanName
  const botTeamIds = state.teams.filter((t) => t.id !== HUMAN_TEAM_ID).map((t) => t.id)
  const botStates = createBotStates(botTeamIds, data, state.rng)
  return {
    state,
    botStates,
    botMaxBidFn: createRealBotMaxBidFn(botStates),
    botNominate: createBotNominationStrategy(botStates),
    phase: 'nominating',
    currentAuction: null,
    lastPick: null,
    pendingAutoPlay: false,
    seed,
  }
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

// Watch-list auto-skip (spec §5 Pacing): a starred player always pauses;
// an unstarred one only pauses while the bots' own bidding hasn't yet
// passed what the player is worth. REVISIONS.md change 1 removed the
// human's personal valuation (`myValue`) this was originally keyed on —
// there's no "my max" left to compare against — so this now uses
// `blended`, the market's own anchor price, as the next-best stand-in:
// skip once the room has bid past what the market itself thinks the
// player is worth. REVISIONS.md doesn't address the watch list directly;
// this is a judgment call to keep the feature working, not a spec'd
// number.
function shouldPauseForHuman(player: Player, botBids: Bid[], humanTeam: Team, watchList: Set<string>): boolean {
  if (watchList.has(playerKey(player))) return true
  const baseline = currentStanding(botBids, humanTeam, 0)
  if (!baseline) return true
  return baseline.price <= player.blended
}

type StepStatus = 'advanced' | 'input-needed'

// Processes exactly one bot nomination + auction, or determines the human
// needs to act (their nomination turn, an auction worth pausing for, or
// the draft is over). Never loops — callers decide how many times to
// call this and how fast.
function advanceOneBotStep(c: ControllerInternals, watchList: Set<string>): StepStatus {
  if (isDraftComplete(c.state)) {
    c.phase = 'complete'
    c.currentAuction = null
    return 'input-needed'
  }

  const nominatorId = peekNextNominatorId(c.state)
  if (nominatorId === null) {
    c.phase = 'complete'
    c.currentAuction = null
    return 'input-needed'
  }

  if (nominatorId === HUMAN_TEAM_ID) {
    c.phase = 'nominating'
    c.currentAuction = null
    return 'input-needed'
  }

  const nominationPointerBefore = c.state.nominationPointer
  const nominator = nextNominator(c.state)!
  const player = c.botNominate(c.state, nominator)
  if (!player) {
    c.phase = 'complete'
    c.currentAuction = null
    return 'input-needed'
  }

  const humanTeam = c.state.teams.find((t) => t.id === HUMAN_TEAM_ID)!
  const botBids = computeBotBids(c.state, player, c.botMaxBidFn, HUMAN_TEAM_ID)
  const humanEligible = !isRosterFull(humanTeam) && canBidOnPositionSafely(c.state.teams, c.state.undrafted, humanTeam, player.pos)

  if (humanEligible && shouldPauseForHuman(player, botBids, humanTeam, watchList)) {
    c.phase = 'auctioning'
    c.currentAuction = { player, botBids, humanBid: 0, humanEligible: true, bidLog: [], nominationPointerBefore }
    return 'input-needed'
  }

  const snapshot: PickSnapshot = {
    pickNumberBefore: c.state.pickNumber,
    nominationPointerBefore,
    logLengthBefore: c.state.log.length,
    draftedLengthBefore: c.state.drafted.length,
    player,
  }
  const result = finalizeAuction(c.state, botBids, humanTeam, 0)
  applyAuctionResult(c.state, player, result)
  // Only a real fill is undoable — a "no bidders" outcome doesn't touch
  // the roster or remove the player from the pool, so there's nothing to
  // reverse (and reversing it would wrongly re-add a player who was never
  // actually removed).
  if (result?.winner) c.lastPick = snapshot
  return 'advanced'
}

// Loops advanceOneBotStep to completion, synchronously. Used for "instant"
// speed and anywhere else a jump straight to the next input-needed point
// is wanted (initial load, undo, restart) regardless of the speed setting.
function advanceUntilInputNeeded(c: ControllerInternals, watchList: Set<string>) {
  // A safety net against an unexpected infinite loop, not a normal
  // stopping condition — matches runFullDraft's maxSteps guard.
  for (let guard = 0; guard < 10000; guard++) {
    if (advanceOneBotStep(c, watchList) === 'input-needed') return
  }
}

// Resumes auto-play after an action, respecting the speed setting: instant
// jumps straight to the next input-needed point; 1x/4x take one step now
// and flag that more remain, for the auto-play effect to continue on a
// timer (so the human can actually watch bot picks happen).
function resumeAutoAdvance(c: ControllerInternals, watchList: Set<string>, speed: Speed) {
  if (speed === 'instant') {
    advanceUntilInputNeeded(c, watchList)
    c.pendingAutoPlay = false
  } else {
    c.pendingAutoPlay = advanceOneBotStep(c, watchList) === 'advanced'
  }
}

export function useDraftController(data: DraftData, seed: number, humanName = 'You'): DraftController {
  const [version, forceRender] = useState(0)
  const bump = useCallback(() => forceRender((n) => n + 1), [])

  const [watchList, setWatchList] = useState<Set<string>>(loadWatchList)
  const [speed, setSpeedState] = useState<Speed>(loadSpeed)

  const ref = useRef<ControllerInternals | null>(null)
  if (ref.current === null) {
    ref.current = createInternals(data, seed, humanName)
    advanceUntilInputNeeded(ref.current, watchList)
  }
  const ctrl = ref.current

  // Auto-play: while a bot-only chain of picks is still pending (1x/4x
  // speed), keep stepping on a timer. Runs after every render so each
  // completed step schedules the next one; cleans up its own timer if the
  // component re-renders for any other reason first.
  useEffect(() => {
    const c = ref.current!
    if (!c.pendingAutoPlay) return
    const timer = setTimeout(() => {
      c.pendingAutoPlay = advanceOneBotStep(c, watchList) === 'advanced'
      bump()
    }, SPEED_DELAY_MS[speed])
    return () => clearTimeout(timer)
  })

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

    resumeAutoAdvance(c, watchList, speed)
    bump()
  }, [bump, watchList, speed])

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

  const setSpeed = useCallback((next: Speed) => {
    setSpeedState(next)
    try {
      localStorage.setItem(SPEED_KEY, next)
    } catch {
      // ignore — speed just won't persist across reloads
    }
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
    c.pendingAutoPlay = false

    advanceUntilInputNeeded(c, watchList)
    bump()
  }, [bump, watchList])

  const restart = useCallback(
    (newSeed?: number) => {
      const s = newSeed ?? ref.current!.seed
      ref.current = createInternals(data, s, humanName)
      advanceUntilInputNeeded(ref.current, watchList)
      bump()
    },
    [bump, data, humanName, watchList],
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
    speed,
    watchList,
    canUndo: ctrl.lastPick !== null,
    nominatePlayer,
    autoNominate,
    setHumanBid,
    raiseBid,
    passBid,
    confirmAndAdvance,
    toggleWatch,
    setSpeed,
    undoLastPick,
    restart,
  }
}
