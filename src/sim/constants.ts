// Tunable simulation constants, centralized for visibility. NOISE_K and
// CENTERING are explicitly the two knobs the calibration harness (spec
// §4.3, phase 4) tunes against 200 headless bots-only drafts. The rest are
// direct transcriptions of the probabilities/ranges given in spec §3 and
// aren't expected to need tuning, but live here so they're all in one place.

// §3.2 — how much bots privately disagree about a player's value, and a
// global centering offset on the anchor price. Tuned via `npm run
// calibrate` (scripts/calibrate.ts) against 200 headless bots-only drafts,
// per spec §4.3. NOISE_K turned out to have very little effect on the
// result (see the harness comment for why) and is left at its neutral
// default; CENTERING=1 was the best of an extensive sweep — it brings the
// $60+, $40-59, and $1-9 expected-price buckets within the spec's 5%
// target. The $10-24 and $25-39 buckets remain ~7-12% under even at the
// best setting found; that gap is structural (needFactor's flex/bench
// 0.80 discount and the real historical timingFactor curve both apply
// most heavily to exactly this price range, for a player drafted in the
// middle third of the draft) and isn't reachable by these two knobs alone
// without loosening a spec-given constant. Documented in detail in
// scripts/calibrate.ts.
export const NOISE_K = 1.0
export const CENTERING = 1

// §3.2 — widen noise for players with no real Yahoo AAV to anchor on.
export const UNMATCHED_YAHOO_NOISE_MULT = 1.5

// §3.4 — roster-need adjustments.
export const FLEX_OR_BENCH_NEED_FACTOR = 0.8
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
