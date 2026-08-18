# Revisions — read this alongside MOCK_DRAFT_SPEC.md

Two changes. Where this file and the original spec disagree, **this file wins**.

---

## Change 1 — Remove my personal rankings entirely

The simulator should model **the room**, not my opinion of players. It is a market simulation, not a
draft board.

Delete from the app:

- The `myRank`, `myValue`, and `edge` fields (already removed from the data file — the new
  `stafford_draft_data.json` no longer has them).
- The "Edge" and "Verdict"/TARGET/AVOID columns anywhere in the UI.
- Any sorting or highlighting based on how I rank a player.

Players are now ordered by `marketRank`, which comes from Yahoo's consensus, not from me.

### What each player field now means

```
yahooAAV          Yahoo's current average auction value
leagueOverall     my league's overall price curve at this market rank
leaguePositional  my league's nine-year history at this positional rank
blended           30% yahooAAV + 30% leagueOverall + 40% leaguePositional
sd                historical price volatility at that positional rank
tier              price tier within the position
```

`blended` is the market's best guess at what a player costs. It is the **calibration anchor** — the
number simulated prices should average out to. It is not a number I want to see while bidding.

### Hiding it during the draft

Add a **Reveal prices** toggle, default **off**.

- Toggle off (default): during bidding I see only name, team, position, positional rank, and tier.
  No dollar projection of any kind.
- Toggle on: `blended` shows as a reference.
- After the draft ends, always show final price versus `blended` on the results screen, so I can see
  where the room over- and underpaid.

The point is to practice reading the room, not to read a number off a screen.

---

## Change 2 — Fix the prices (the real problem)

Prices are landing well above where they should. This is the winner's curse from §4.3 of the
original spec.

### First, understand what "too high" actually means

The total is fixed. Twelve teams spend $200 each, so **every draft spends exactly $2,400 across 168
players no matter what the bots do**. Prices cannot all be too high.

What is actually wrong is the **shape**: the top of the draft is eating too much, which starves the
middle and bottom. If the top 24 players are taking 60% of the pool instead of 48%, then dozens of
mid-round players are being forced down to $1, and the draft feels broken.

So stop thinking "prices are too high" and start measuring **top-heaviness**.

### The targets

`calibration.targets` in the data file now holds the real shape of a Stafford draft, averaged over
nine seasons. These are the acceptance criteria:

**Price of the Nth most expensive player**

| Nth | Real | 
|---|---|
| 1st | $70 |
| 3rd | $65 |
| 5th | $59 |
| 12th | $48 |
| 24th | $32 |
| 36th | $25 |
| 60th | $14 |
| 100th | $4 |

**Share of the $2,400 taken by the top N**

| Top N | Real share |
|---|---|
| 12 | 29% |
| 24 | 48% |
| 36 | 63% |
| 60 | 81% |

**How many players land in each price band, per draft**

| Band | Players |
|---|---|
| $60+ | 4 |
| $40–59 | 13 |
| $25–39 | 19 |
| $15–24 | 22 |
| $8–14 | 23 |
| $3–7 | 34 |
| $1–2 | 53 |

That last row matters: **a third of every real draft goes for $1–2.** If the simulator is producing
far fewer $1 players, the top is too expensive.

### Fix 2a — Budget reserve (do this one first; it is most of the problem)

The original spec let a bot bid up to `budget − spent − (openSlots − 1)`, which reserves only $1 per
remaining slot. That is a *legality* rule, not a *strategy* rule, and it lets a bot spend $180 on two
players. Real managers don't do that, and this is almost certainly the main cause of the top-heaviness.

Replace it with a planned reserve:

```
reserve = sum over remaining roster slots of the bot's planned spend for that slot
maxBid  = budget − spent − reserve
```

Give each bot a **budget plan** at draft start: a target spend for each of its 14 slots that sums to
$200. Vary the plans across bots — one stars-and-scrubs plan, a couple balanced, one that spreads
evenly. As slots fill, drop those entries from the reserve.

A bot that overpays for an early player must then *reduce* its plan for later slots, which is exactly
what makes a real auction self-correcting.

### Fix 2b — Bots bid to a target, not to their ceiling

Add a `restraint` trait per bot, roughly 0.85–0.95. A bot's walk-away price is
`valuation × restraint`, not `valuation`. Real managers set a number and stop; the sim currently has
them bidding until it is literally illegal to continue.

### Fix 2c — Shrink the disagreement

The winner's curse scales directly with how much bots disagree. If `NOISE_K` is large, the highest
of 11 draws is far above the average, and every contested player clears high. Start `NOISE_K` low —
try 0.35 — and only raise it if drafts feel too samey.

### Fix 2d — Auto-calibrate instead of guessing

Do not try to derive the right correction by hand. Build a loop:

1. Run 200 bot-only drafts.
2. Compute: price of the Nth most expensive player, top-N shares, and the price-band counts.
3. Compare to `calibration.targets`.
4. Adjust a single global `CENTERING` multiplier applied to every bot valuation — lower it if the top
   is too expensive, raise it if too cheap.
5. Repeat until the top-24 share is within 2 points of 48% and the $1–2 count is within about 5 of 53.

Ship this as a script I can run, printing a before/after table. Three or four iterations should
converge.

---

## Change 3 — Keep the randomness, but centre it

I want prices to vary — sometimes a player goes cheap, sometimes there's a bidding war. That is the
point of running mocks. What I don't want is variance that is **biased upward**.

Once calibrated, check that the variance is two-sided: across 200 drafts, a given player should land
**below** `blended` roughly as often as above. If a player is above his blended price in 80% of
simulations, the model is still biased and no amount of extra randomness will fix it.

Sources of genuine two-sided variance, all already in the spec — keep them:

- Private per-bot valuations, drawn once per draft (§3.2)
- Positional archetypes, so some rooms are RB-hungry and some aren't (§3.1)
- The 8% lock-in bidding war (§3.5)
- Timing effects, so late players genuinely go cheap (§4.1)
- Nomination order, which changes who still has money when a player comes up

The single biggest source of realistic *downside* variance is **roster need**: when a player comes up
and only three teams still need that position, he goes cheap. Make sure roster needs are actually
gating bids, since that is what produces the bargains that make a mock draft worth practising.

---

## Order of work

1. Strip the personal ranking fields and the Edge/Verdict UI. Add the Reveal prices toggle.
2. Implement the budget reserve (Fix 2a).
3. Add `restraint` and lower `NOISE_K` (2b, 2c).
4. Build the calibration script and run it until the targets are hit (2d).
5. Check that variance is two-sided (Change 3).

Do not move to step 4 before 2 and 3 are done, and don't tune anything by playing drafts by hand —
tune against the table.
