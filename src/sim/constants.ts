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
// CENTERING is still the old pre-REVISIONS value (=1), tuned against a
// different data schema and before the budget reserve (Fix 2a) and
// restraint (Fix 2b) existed — it has no remaining justification under
// the current mechanics and is very likely wrong now. Deliberately left
// untouched here: REVISIONS.md's order of work puts re-tuning it in step
// 4, via the auto-calibration script against calibration.targets, not by
// hand-adjusting it now.
export const NOISE_K = 0.35
export const CENTERING = 1

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
// fraction of still-eligible teams drops, bottoming out at this factor
// when eligibility is down to a single team.
export const ROOM_DEMAND_MIN_FACTOR = 0.6

// Not from the spec's §3.4 list — this is for the bench-QB slot added
// after phase 4 shipped (see roster.ts). Tuned via `npm run calibrate`
// against calibration.avgRosteredByPos.QB (target 17.4/draft): bots were
// grabbing a backup QB as often as a bench RB/WR/TE (both at
// FLEX_OR_BENCH_NEED_FACTOR), overshooting to ~20/draft, since RB/WR/TE
// supply is nearly exhausted by the time bench slots fill and a cheap
// backup QB becomes the path of least resistance. A backup QB is weaker
// value than a bench flex player in real drafts (mostly bye-week
// insurance, not usable production), so it gets its own, lower factor.
// 0.3 landed QB at 17.7/draft (target 17.4) across 200 drafts.
export const BACKUP_QB_NEED_FACTOR = 0.3
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

// §4.2 — live inflation damping ("bots should react to it but not
// perfectly").
export const INFLATION_DAMPING = 0.6
