# Stafford Mock Auction Draft — Build Spec

A browser-based mock auction simulator: one human (me) against 11 bot managers, calibrated to my
actual league's nine-year auction history plus current Yahoo average auction values.

Everything runs client-side. No backend, no database, no accounts.

---

## 1. League settings

| Setting | Value |
|---|---|
| Teams | 12 |
| Budget | $200 per team |
| Roster spots | 14 |
| Starters | QB, RB, RB, WR, WR, TE, FLEX, FLEX, DEF |
| Flex eligible | RB / WR / TE |
| Bench | 5 |
| Minimum bid | $1 |
| Bid increment | $1 |
| Nomination order | Rotates: team 1, 2, 3 … 12, then repeats |
| Max bid rule | `budget − spent − (openSlots − 1)` — must leave $1 per unfilled slot |
| Draft ends | When all 12 teams have 14 players |

A team that has filled a position group cannot bid on it (no 3rd QB, no 2nd DEF), except where the
player is flex-eligible and a flex or bench slot remains.

**Verify against Yahoo before finalizing:** the bid clock length and whether the clock resets on each
new bid. My recollection is roughly a 10-second timer that resets, but confirm in Yahoo's rules
rather than trusting this.

---

## 2. Data file

`stafford_draft_data.json` ships with the app. Load it once at startup.

```
meta                league settings (mirrors the table above)
calibration         behavioral parameters — see §4
priceCurve[168]     what the Nth most expensive roster spot costs in my league ($71.5 … $1)
positionalValues[]  { key:"RB5", pos, rank, tier, target, low, high, sd }
players[186]        { name, team, pos, myRank, myValue, yahooAAV, consensusRank,
                      consensusPosRank, leaguePosTarget, expected, edge, tier, sd, matchedYahoo }
```

Field meanings:

- **`expected`** — blended estimate of what the player will actually cost. 30% Yahoo AAV + 30% my
  league's overall price curve + 40% my league's positional history, rescaled so the top 168 sum to
  the full $2,400 pool. This is the anchor for bot valuations.
- **`myValue`** — what the player is worth to *me*, from my own ranking order. Bots must not see this.
- **`sd`** — historical standard deviation of price at that positional rank. Use it to scale how much
  bots disagree: prices that were volatile historically should be volatile in the sim.
- **`matchedYahoo`** — false for 21 deep players with no Yahoo value; their `yahooAAV` defaulted to
  $1 and their `expected` is therefore soft. Widen bot uncertainty for these.

Players beyond the 186 in the file should be draftable as $1 filler so rosters can always be
completed — generate generic "FA RB 1", "FA WR 2" etc. as needed.

---

## 3. Bot managers

Eleven bots. Each gets a persistent personality generated at draft start (seeded, so a draft can be
replayed) and **kept hidden from the UI** until the draft ends.

### 3.1 Per-bot traits

```
aggression        0.90 – 1.10   flat multiplier on every valuation
positionBias      per-position multiplier, e.g. {RB:1.08, WR:0.95, QB:1.00, TE:0.90, DEF:1.0}
starPreference   -0.10 – +0.10  positive = pays up at the top, negative = spreads money around
disciplineDecay   0.5 – 1.5     how fast they loosen when their roster is thin late
noiseScale        0.7 – 1.3     how idiosyncratic their player-by-player reads are
```

Draw `positionBias` so roughly two bots are RB-heavy, two WR-heavy, one takes a QB early, one
punts TE, and the rest are near neutral. This reproduces the archetypes in a real room.

### 3.2 Private valuations

At draft start, each bot draws a private valuation for every player, once, and keeps it:

```
base      = player.expected
posMult   = bot.positionBias[player.pos]
starMult  = 1 + bot.starPreference * (player.expected / 70)
noise     = normal(0, player.sd * bot.noiseScale * NOISE_K)
value_ij  = (base * posMult * starMult + noise) * bot.aggression
```

Widen `noise` by ~50% for players where `matchedYahoo` is false.

### 3.3 Situational adjustment at bid time

The valuation is the anchor; what a bot will actually pay flexes with the state of the draft:

```
maxBid = value_ij
       * timingFactor(draftProgress, player.pos)     // §4.1
       * needFactor(bot roster state)                // §3.4
       * inflationFactor(live)                       // §4.2
       * lockInFactor()                              // §3.5
maxBid = min(maxBid, legalMaxBid(bot))
```

### 3.4 Roster need

- Position already full and not flex-eligible → does not bid at all.
- Starting slot for that position still open → `needFactor` 1.00.
- Only flex or bench would be filled → 0.80.
- Late draft (fewer than 4 slots left) with a starting slot still unfilled → up to 1.25, scaled by
  `disciplineDecay`. This is what produces the desperate $30 bid on a mediocre TE at the end,
  which happens in every real auction.
- Bot has more than $8 per remaining slot → nudge up 5%; less than $2 per slot → clamp to $1 bids.

### 3.5 Occasional irrationality

Real managers get locked into bidding wars. With ~8% probability per player, a bot enters "locked in"
mode for that player and raises its max by 10–25%. Two bots locked on the same player is exactly how
a $45 player goes for $58, and the sim looks wrong without it.

### 3.6 Bidding mechanics

Do **not** jump straight to max. Bots respond to the current bid:

- Bid if `currentBid + 1 <= maxBid`.
- Response delay: random 300–1,500 ms, shorter when `currentBid` is well under `maxBid`
  (eagerness reads as confidence and is a real tell).
- When `currentBid` is within $3 of `maxBid`, add hesitation — a 40% chance of pausing an extra
  beat before bidding, and a small chance of dropping out one dollar early.
- Occasionally (~15%) a bot that opens the bidding jumps to ~60% of its max rather than $1, which
  is what real managers do to scare off casual interest.

### 3.7 Nomination strategy

Rotate through teams. On its turn a bot picks from:

- **Budget drain (45%)** — nominate a player it does *not* want but others will, weighted toward
  expensive players at positions where the bot is already full. This is the dominant real strategy
  and my league's history shows it working: half the money is gone by nomination 30 of ~150.
- **Value grab (30%)** — nominate a player it *does* want, when the bot has above-average budget per
  slot. Riskier, but it's what a manager with cash does mid-draft.
- **Need fill (15%)** — late draft, nominate to fill a hole.
- **Random (10%)** — noise.

Early nominations should skew heavily to high-`expected` players; the money clock in §4.1 depends
on it.

---

## 4. Calibration — this is the part that will be wrong if rushed

### 4.1 Timing

`calibration.timingMultiplier` is a 10-element array: observed price ÷ historical par, by decile of
nomination order, from my league's real drafts:

```
[1.008, 0.990, 0.968, 0.863, 0.865, 0.847, 0.793, 0.758, 0.950, 0.950]
```

Players go at par early and roughly 15–25% under par once budgets thin, with the last two deciles
propped up by end-of-draft desperation. `calibration.positionTiming` gives the same effect split by
position — note QB collapses hardest (0.94 early → 0.52 late) and RB holds its value best early
(1.02) but falls off a cliff late (0.77).

`calibration.moneyClock` is the fraction of total spend consumed by each decile of nominations:

```
[0.00, 0.25, 0.49, 0.68, 0.77, 0.85, 0.90, 0.94, 0.97, 0.99, 1.00]
```

**Use this as an acceptance test.** If your simulated drafts don't spend ~49% of the pool in the
first 20% of nominations, the bots are too cautious early.

### 4.2 Live inflation

Track continuously:

```
inflation = (total $ remaining across all teams) / (sum of `expected` for all undrafted players)
```

Feed it into `inflationFactor` with damping — bots should react to it but not perfectly. Multiply by
roughly `1 + 0.6 * (inflation - 1)`. Display this to the human; it's the single most useful live
number in an auction.

### 4.3 The winner's curse — read this before tuning anything

**The trap:** if every bot's valuation is centered on `expected`, clearing prices will land
systematically *above* `expected`. The winner of an auction is by definition whoever drew the highest
valuation, so the price settles near the *second-highest* of the live bidders' draws, not the mean.

For 12 bidders drawing from a normal distribution, the second-highest sits roughly **1.1 standard
deviations above the mean**. With `sd` around $5 that's a $5–6 overshoot on every contested player,
and the sim will feel wrong in a way that's hard to diagnose from the inside.

Roster needs cut this down — usually only 4–7 teams are live on a given player, which pulls the
overshoot toward 0.5σ — but it does not remove it.

**Do not try to derive the correction analytically.** Build a calibration harness instead:

1. Run 200 headless drafts with bots only.
2. For each `expected` bucket ($60+, $40–59, $25–39, $10–24, $1–9), compare mean clearing price to
   mean `expected`.
3. Tune two knobs until they match within ~5%: `NOISE_K` (how much bots disagree) and a global
   `CENTERING` offset applied to `base` in §3.2.
4. Also check: total spend per team should be $200, the `moneyClock` shape from §4.1 should be
   reproduced, and roughly 4.4 roster spots per team should go for $1–2.

Ship this harness as `npm run calibrate` with a printed comparison table. It is the difference
between a toy and something worth practicing against.

---

## 5. Interface

Single screen, desktop-first.

**Center** — current player up for bid: name, team, position, my rank, my value, expected price,
tier. Current high bid and which team holds it. Bid history for this player. My **Bid** button and a
**Max bid** field for auto-bidding up to a limit.

**Left** — my roster: slots filled, budget remaining, max legal bid, $ per remaining slot.

**Right** — the other 11 teams: budget left, slots left, and positions still needed. This is the
information a real auction gives you and it drives everything.

**Top** — draft progress, live inflation, and the money clock versus historical pace.

**Bottom** — the full player pool, searchable and filterable by position, showing my value, expected,
edge, and tier. Sortable by edge so I can see who's cheap relative to my rankings. Drafted players
grey out.

### Pacing

168 picks is a long sit. Include:

- **Watch list** — star players I care about. Auto-skip auctions for anyone unstarred once bidding
  passes my max, so I only actively participate where it matters.
- **Speed control** — 1x, 4x, instant.
- **Undo last pick** and **restart with same seed**, so I can replay a specific spot and try a
  different line.

### Post-draft

Show final rosters for all 12 teams, my total spend by position versus the historical average,
which players I got above or below `expected`, and — only now — reveal each bot's personality so I
can see what I was actually up against.

---

## 6. Tech

- **Vite + React + TypeScript**, plain CSS. No UI framework needed.
- **No backend.** All state in memory; JSON loaded as a static asset.
- Seeded RNG (e.g. `mulberry32`) so drafts are reproducible.
- Simulation logic in pure functions under `src/sim/`, fully separable from React so the calibration
  harness can run it headless under Node.
- `localStorage` for watch list and settings only.

Suggested layout:

```
src/
  sim/    engine.ts  bots.ts  valuation.ts  nomination.ts  rng.ts
  ui/     DraftScreen.tsx  MyTeam.tsx  OtherTeams.tsx  PlayerPool.tsx  Results.tsx
  data/   stafford_draft_data.json
scripts/  calibrate.ts
```

---

## 7. Build order

1. Data loading and types.
2. Draft engine: nomination rotation, bid resolution, roster and budget rules, completion. Test with
   trivial bots that always bid $1.
3. Bot valuations and bidding (§3).
4. **Calibration harness (§4.3) — before building the UI.** Tuning against a table of numbers is far
   easier than tuning by playing.
5. UI.
6. Watch list, speed control, undo, results screen.

---

## 8. Acceptance tests

- Every team ends with exactly 14 players and spends its full $200.
- No team can bid beyond `budget − spent − (openSlots − 1)`.
- Mean clearing price by `expected` bucket is within 5% of `expected`.
- The money clock matches `calibration.moneyClock` within a few points.
- About 4.4 spots per team go for $1–2.
- Position counts across the draft land near `calibration.avgRosteredByPos`
  (QB 17, RB 59, WR 62, TE 15, DEF 10).
- Same seed produces an identical draft.
