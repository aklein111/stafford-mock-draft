// Tunable simulation constants, centralized for visibility. NOISE_K and
// CENTERING are explicitly the two knobs the calibration harness (spec
// §4.3, phase 4) tunes against 200 headless bots-only drafts. The rest are
// direct transcriptions of the probabilities/ranges given in spec §3 and
// aren't expected to need tuning, but live here so they're all in one place.

// §3.2 — how much bots privately disagree about a player's value, and a
// global centering offset on the anchor price.
//
// REVISIONS.md Fix 2c: the winner's curse (the clearing price tends
// toward the *second*-highest of many independent draws, not the mean)
// scales directly with how much bots disagree — a large NOISE_K makes the
// highest of 11 draws land far above the average, and every contested
// player clears high, which is a big part of what was making the top of
// the draft too expensive. REVISIONS.md says to start low and only raise
// it if drafts feel too samey: 0.35.
//
// CENTERING re-tuned by npm run calibrate after BOT_PERSONALITIES.md's
// owner-driven budget plan replaced the old fixed archetype menu. The
// script didn't converge and wouldn't auto-write — worth recording why,
// since it isn't a bug in this value. The real top3Concentration data
// (league mean 0.6164 — managers really do spend ~62% of budget on their
// top 3 picks) is a steeper curve for *every* bot than the old system's
// population (1 steep stars-and-scrubs bot, 9 much-flatter balanced, 1
// even-spread). Verified directly: forcing every bot's drawn
// top3Concentration to the old flat ~0.51 pulls top-24 share of pool from
// ~52% back to ~50%, right where calibrate.ts's target sits — confirming
// this is the real, data-backed source of the gap, not noise or a coding
// error. NOISE_K sweeps 0.35 down to 0.16 barely move it either (~52.5%
// throughout), so the winner's-curse mechanism Fix 2c targets isn't the
// driver. Since CENTERING more negative than -0.75 breaks roster
// completion outright (fill collapses below 20% — bots stop valuing cheap
// players enough to bid at all) with no further gain even before that
// point, calibrate.ts's own best safe candidate is the one to use: the
// residual ~3.8pt top-24-share gap at that candidate is this same real,
// understood effect — a genuinely more broadly-competitive elite market
// than the old synthetic population — not something this knob can close
// without breaking roster completion. Flagging as a known,
// deliberately-not-chased gap rather than a bug, same as the backup-QB
// quantity overshoot above.
//
// Re-tuned 1.25 -> 1.75 after ensureNominatorOpensAtOne (engine.ts) made
// every eligible nomination guarantee a sale: fill rate is now ~100%
// across nearly the whole CENTERING range instead of topping out at
// 99.6%, moving calibrate.ts's best-safe candidate up slightly. Same gap,
// same cause, just re-measured against the new floor.
export const NOISE_K = 0.35
export const CENTERING = 1.75

// REVISIONS.md Fix 2b — real managers set a number and stop; a bot's
// actual walk-away price is its computed valuation times this, not the
// full valuation, so it stops bidding before it's merely *illegal* to
// continue rather than at the edge of what it can technically afford.
export const RESTRAINT_MIN = 0.85
export const RESTRAINT_MAX = 0.95

// §3.2 — widen noise for players with no real Yahoo AAV to anchor on.
export const UNMATCHED_YAHOO_NOISE_MULT = 1.5

// §3.4 — roster-need adjustments.
export const FLEX_OR_BENCH_NEED_FACTOR = 0.8

// REVISIONS.md Change 3, step 5 — room-wide scarcity, not just a bidding
// team's own need. FLEX_OR_BENCH_NEED_FACTOR only reflects whether *this*
// team has a dedicated slot open; it doesn't discount at all when few
// *other* teams are still in the market for the position, which is what
// actually produces a late-draft bargain in a real auction (fewer real
// competitors -> lower clearing price, regardless of any one bidder's own
// desire). The step 5 variance check found this missing: RB/WR/TE showed
// almost no price/blended response to how many teams still had an
// eligible slot (correlation ~0), because those positions share
// FLEX+BENCH so broadly that "eligible" rarely excludes anyone until very
// late. roomDemandFactor (valuation.ts) scales every bid down as the
// room's average demand weight drops, bottoming out at this factor when
// no team has any real interest left.
//
// Retuned up from 0.6 after a later investigation into teams underspending
// overall: 62.5% of all RB/WR bid evaluations are for a non-dedicated
// (FLEX/BENCH) slot — teams need only 2 dedicated RB and 2 dedicated WR
// each, but have up to 7 more FLEX/BENCH slots that take either position —
// and every one of those was taking *both* FLEX_OR_BENCH_NEED_FACTOR's
// discount and this one, compounding to ~0.64x on average (measured
// directly) well before restraint/inflation/etc. even applied. 0.6 was
// tuned by itself, without accounting for that overlap. 0.85 keeps genuine
// late-draft scarcity bargains intact (measured: a position down to one
// interested team still crashes to 40-60% of blended) while no longer
// doubling up with needFactor's own discount on every ordinary FLEX/BENCH
// pick, which was the largest single driver of the overall underspend
// (~87% -> ~90% of the $2400 pool spent, at 200-draft samples).
export const ROOM_DEMAND_MIN_FACTOR = 0.85

// REVISIONS.md Change 3, step 5 — a real bidding war needs a real chance
// of happening. Step 4 made generateBudgetPlan fully deterministic (no
// rng — the old per-slot shuffle was the position-pinning bug it fixed),
// which had a side effect: an archetype's ceiling for its best pick is now
// an *identical fixed number every single draft*. Since that ceiling is
// almost always what determines an elite player's price (see bots.ts),
// the top of the pool ended up hugging that fixed number every time with
// almost no variance — measured directly: the pool's best few players
// landed below blended in 88%+ of simulations even after the ceiling's
// average level was raised (checkVariance.ts), well past REVISIONS'
// 80% one-sidedness bar. jitterTopSlot (budgetPlan.ts) re-randomizes each
// bot's single biggest plan entry within this range every draft, so which
// bots have real room to compete for the best players on the board varies
// draft to draft, the way it would for real managers walking in with
// different plans each time.
export const PLAN_TOP_JITTER_MIN = 0.5
export const PLAN_TOP_JITTER_MAX = 2.0

// Not from the spec's §3.4 list — this is for the bench-QB slot added
// after phase 4 shipped (see roster.ts). A backup QB is weaker value than
// a bench flex player in real drafts (mostly bye-week insurance, not
// usable production), so it gets its own, lower factor than
// FLEX_OR_BENCH_NEED_FACTOR.
//
// Retuned 0.3 -> 0.5 in the same underspending pass as ROOM_DEMAND_MIN_
// FACTOR above: backup-QB picks were pricing at just 0.35x blended
// (measured directly), noticeably worse than every other position. Swept
// 0.3-0.6 and picked 0.5 as the point where price improves substantially
// (0.35 -> 0.57x) without moving quantity much (18.9 -> 19.6/draft) — the
// 17.4/draft target this was originally tuned against is already
// overshot by every value in that range, including the original 0.3, now
// that the other underspending fixes (ROOM_DEMAND_MIN_FACTOR, the
// BALANCED decay nudge) have shifted backup QB's appeal relative to a
// bench RB/WR/TE. That quantity overshoot looks like a separate,
// still-open problem, not something this factor controls much on its own.
export const BACKUP_QB_NEED_FACTOR = 0.5

// User report: defenses were going for way too much (checkVariance.ts had
// already flagged this independently — e.g. the Rams' DEF, blended 6,
// clearing at a mean price of $9.1 across 200 drafts). A real manager
// doesn't pay premium prices for a DEF no matter how the room's noise/
// inflation/lock-in multipliers stack up on a given nomination — it's a
// $1-2 streaming slot. A hard cap on every bot's max bid is simpler and
// more reliable than trying to retune the multiplicative chain (timing,
// roomDemand, inflation, lockIn) down to a $2 ceiling for one position
// without also flattening it for everyone else.
export const DEF_MAX_BID = 2

// User report: individual bots (Loewy specifically) were hoarding tight
// ends — TE is flex/bench-eligible, so nothing previously stopped a bot
// from stacking three, four, even five of them across its bench once its
// one dedicated TE slot filled. A real manager doesn't do that; TE is a
// thin position and a second one is bye-week/matchup insurance at most.
// Applies to bots only, same as every other bidding-behaviour knob here —
// a human player can still draft as many as they want.
export const BOT_MAX_TE = 2
export const LATE_DRAFT_SLOTS_THRESHOLD = 4
export const LATE_DRAFT_MAX_BOOST = 0.25 // "up to 1.25"
export const RICH_PER_SLOT_THRESHOLD = 8
export const RICH_PER_SLOT_BOOST = 0.05
export const POOR_PER_SLOT_THRESHOLD = 2

// §3.5 — occasional irrationality: a bot getting "locked in" on a player.
export const LOCK_IN_PROBABILITY = 0.08
export const LOCK_IN_MIN_BOOST = 0.1
export const LOCK_IN_MAX_BOOST = 0.25

// §3.6 — live bidding mechanics. Only DROP_EARLY_PROBABILITY changes a
// clearing price in this engine; the rest are metadata for a future live
// UI to use for pacing (see engine.ts for why).
export const HESITATION_ZONE = 3 // dollars from the top bid
export const DROP_EARLY_PROBABILITY = 0.12 // "a small chance"
export const OPEN_JUMP_PROBABILITY = 0.15
export const OPEN_JUMP_FRACTION = 0.6
export const HESITATION_PAUSE_PROBABILITY = 0.4
export const RESPONSE_DELAY_MIN_MS = 300
export const RESPONSE_DELAY_MAX_MS = 1500

// §3.7 — nomination strategy mix.
export const NOMINATION_STRATEGY_WEIGHTS = {
  budgetDrain: 0.45,
  valueGrab: 0.3,
  needFill: 0.15,
  random: 0.1,
}

// Added after a user report that late-nominated players were going for far
// under projection: nomination.ts's budget-drain and value-grab strategies
// already weighted candidates by value (linearly, exponent 1), but that
// wasn't a strong enough skew. Measured directly against leagueHistory.
// rawPicks: historically, the top 12 salaries in a season (roughly the
// league's studs, one per team) are nominated in the first 10% of the
// draft 54.6% of the time, 33.3% in the second 10%, and essentially never
// (0.9% or less) past the 40% mark. At the linear weighting, a 60-draft
// sim only put 28.2%/21.9% in those first two deciles, with a long tail
// out to 80% of the way through the draft. This matters beyond realism:
// timingFactor (valuation.ts) discounts a player's price by how late they
// were nominated, calibrated on the assumption that a late nomination
// means a lesser player, same as in the real history it's drawn from — a
// stud nominated late by chance in the sim got hit with that discount on
// top of genuine late-draft scarcity, a double markdown history doesn't
// support. Raising the exponent so weight = blended**this concentrates
// nomination probability toward the board's best remaining players
// without changing *which* strategy fires. Swept 1-4 against the same
// rawPicks-derived decile distribution above (least-squares fit); 2.85
// was the closest match (top-12 landing 55.0%/33.8%/9.7%/1.4%/0.1% across
// the first five deciles).
export const NOMINATION_VALUE_EXPONENT = 2.85

// §4.2 — live inflation damping ("bots should react to it but not
// perfectly").
export const INFLATION_DAMPING = 0.6

// BOT_PERSONALITIES.md — turning a bot's per-draft owner-trait draw
// (ownerProfiles.ts) into behaviour. qbShare/rbShare/wrShare/teShare and
// top3Concentration drive the budget plan directly (budgetPlan.ts) *and*
// the mapping table says they should also nudge positionBias/
// starPreference (per-player valuation, not just total dollars). Applying
// the full deviation to both would double-count the same signal the way
// roomDemandFactor and needFactor once did (see that constant's own
// history above) — these dampen the valuation-side echo so the budget
// plan's harder dollar cap does most of the work.
export const POSITION_BIAS_DAMPING = 0.5
export const STAR_PREFERENCE_SCALE = 0.6

// shareSpentByNom40 ("how eagerly it spends early; feeds the budget
// reserve") only has something to feed before the draft reaches the
// checkpoint it's measured against — nomination 40 in the source data's
// own 168-pick season, the same scale this league's 12 teams x 14 spots
// happens to share exactly. Before that point, a bot who historically
// front-loads spending gets a smaller reserve held back (more usable now);
// a patient one gets a bigger reserve (less usable now) — computePlannedMaxBid
// applies this as a straight multiplier on the reserve it already computes.
//
// Measured directly (100-draft sample): raising this scale buys almost
// nothing on price shape (top-24 share of pool moves ~52.2% -> 51.3%
// across the full 0-2 range) but costs real roster completion (99.9% ->
// 98.1% fill) — tightening every bot's early reserve simultaneously means
// more of them can strand a later slot. 1.0 keeps the behavioural tilt
// this trait is actually meant to model (99.6% fill, still a real
// early/late spending difference between an eager and a patient bot)
// without chasing price-shape gains this lever was never going to
// deliver — see CENTERING's own comment for where that gap actually
// comes from.
export const NOMINATION_40_CHECKPOINT = 40
export const EARLY_SPEND_RESERVE_SCALE = 1.0
export const MIN_RESERVE_SCALE = 0.7
export const MAX_RESERVE_SCALE = 1.3
