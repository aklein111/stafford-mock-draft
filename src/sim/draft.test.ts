import { describe, expect, it } from 'vitest'
import { draftData } from './data'
import { createFullBotDraft } from './draft'
import { legalMaxBid } from './roster'

describe('full draft with real bots (spec §3, end to end)', () => {
  it('respects the budget rule for every team, every time', () => {
    for (const seed of [1, 2, 3]) {
      const state = createFullBotDraft(draftData, seed)
      for (const team of state.teams) {
        expect(team.spent).toBeLessThanOrEqual(team.budget)
        expect(legalMaxBid(team)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('never assigns the same player to two teams', () => {
    const state = createFullBotDraft(draftData, 11)
    const names = state.drafted.map((d) => `${d.player.name}-${d.player.team}`)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is deterministic: the same seed produces an identical draft', () => {
    const a = createFullBotDraft(draftData, 123)
    const b = createFullBotDraft(draftData, 123)
    expect(a.log).toEqual(b.log)
    expect(a.teams.map((t) => t.spent)).toEqual(b.teams.map((t) => t.spent))
  })

  it('two different seeds produce different drafts', () => {
    const a = createFullBotDraft(draftData, 1)
    const b = createFullBotDraft(draftData, 2)
    expect(a.log).not.toEqual(b.log)
  })

  it('clearing prices roughly track `blended`: the top bucket costs far more than the bottom bucket', () => {
    const state = createFullBotDraft(draftData, 55)
    const expensive = state.drafted.filter((d) => d.player.blended >= 40)
    const cheap = state.drafted.filter((d) => d.player.blended <= 9)
    expect(expensive.length).toBeGreaterThan(0)
    expect(cheap.length).toBeGreaterThan(0)
    const avg = (picks: typeof expensive) => picks.reduce((s, d) => s + d.price, 0) / picks.length
    expect(avg(expensive)).toBeGreaterThan(avg(cheap))
  })
})
