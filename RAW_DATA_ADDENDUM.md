# Addendum — using the raw history

Replaces the data file with `stafford_draft_data_raw.json`, which carries every individual pick from
nine seasons rather than summary statistics. Read alongside `REVISIONS.md`.

---

## What's in the file now

```
meta                league settings
leagueHistory
  seasons[9]        per-season summary + sorted price vectors, ready to resample
  rawPicks[1512]    every pick: year, nominationPick, player, nflTeam, pos, salary, keeper
  formatNotes       the four things that will bite you if ignored
currentPlayers[186] this year's pool with Yahoo AAV and blended price
priceCurve[168]     the smoothed league curve (kept — still the cleanest anchor)
positionalValues    smoothed target/low/high/sd by positional rank (kept for the same reason)
validationTargets   TESTS ONLY — not modelling inputs
```

Each entry in `seasons[]` has:

- `pricesDesc` — that season's 168 prices, sorted high to low
- `auctionPricesDesc` — the same with keeper-priced players stripped out
- `byPos` — sorted price vector per position

### Four things that will bite you

1. **Keepers, 2022–2025 only.** Priced at prior salary + $10, which is below market. When modelling
   auction behaviour, filter `keeper === true` out. Use `auctionPricesDesc`, not `pricesDesc`.
2. **The kicker slot became a second flex in 2021.** Deep-rank prices tested nearly identical across
   that change, so all nine seasons are usable — but don't treat pre-2021 `byPos.K` as meaningful.
3. **`nominationPick` is nomination order, not price order.** It's what makes timing effects
   modellable directly rather than through the summarised multipliers.
4. **Seven `--empty--` placeholder rows** have a price but no player or position. Drop them from
   positional work.

---

## Why this should fix the price problem

The summarised version gave bots a mean and a standard deviation and had them draw from a normal
distribution. Two things went wrong with that, and both are the kind of thing that produces exactly
the top-heaviness you saw:

**Real auction prices aren't symmetric.** They're right-skewed with a hard floor at $1. A normal draw
puts as much mass above the mean as below, so simulated top-end prices ran hotter than reality.

**Real prices are correlated within a season.** In a year when the room was aggressive early, RB1
*and* RB2 *and* RB3 all went high together. Independent per-player draws can't produce that, so the
sim never generates a coherent "cheap year" or "expensive year."

Both are fixed by sampling from what actually happened instead of from a fitted curve.

---

## Two ways to use it

### Method A — empirical residuals (do this first)

Instead of `noise = normal(0, sd)`, build an empirical residual pool:

1. For each positional rank (RB5, WR12, …), take the nine historical prices and the smoothed target
   from `positionalValues`.
2. Residual = `actualPrice / target` for each season. Nine ratios per rank.
3. Pool residuals across nearby ranks to get a decent sample — say ranks ±3 within the same position.
4. When a bot values a player, **sample a residual from that pool** rather than drawing from a normal.

This automatically reproduces the real skew and the real tail behaviour, and it needs no distribution
fitting. It is a drop-in replacement for the noise term in §3.2 of the original spec.

### Method B — season-shape resampling (for validation, and optionally for bot mood)

At the start of each simulated draft, pick one of the nine historical seasons at random. Use its
`auctionPricesDesc` vector as the expected *shape* of that draft, and scale bot aggression to match.

This gives correlated year effects: some simulated drafts come out looking like 2020 (top-heavy,
$75 at the top), others like 2023 (flat, $64 at the top). That variation is real and it's what makes
running twenty mocks worth more than running one.

---

## Better validation

Stop comparing simulated output to nine-season averages. Compare it to the **individual seasons**.

The right question isn't "does the mean match" — it's **"could this simulated draft plausibly be a
tenth season?"** Concretely:

1. Run 200 sims.
2. For each, compute: top-1 price, top-12 share, top-24 share, count of $1–2 players.
3. For each metric, check the simulated distribution **brackets the nine real seasons** — the real
   values should land inside the simulated range, not at its edge.

If every simulated draft is more top-heavy than all nine real seasons, that's the bug, stated
precisely. `validationTargets` still holds the averaged version if you want a quick smoke test, but
the season-by-season comparison is the real check.

---

## What to keep

`priceCurve` and `positionalValues` are smoothed summaries, and they stay. They're the anchor for
what a given rank is *worth*; the raw data supplies how much that price *varies and skews*. Anchor
from the smoothed curve, add noise from the empirical residuals.

Don't try to derive expected prices directly from raw picks — nine observations per rank is too few
to be stable on its own, which is why the smoothing exists.
