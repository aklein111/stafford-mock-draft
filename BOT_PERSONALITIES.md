# Bot personalities — modelling the eleven other managers

Read alongside `MOCK_DRAFT_SPEC.md`, `REVISIONS.md` and `RAW_DATA_ADDENDUM.md`.
Data file: `stafford_owner_profiles.json`.

Aaron is the human player. The eleven bots are Albex, Biefel, Dovitz, Evan, Loewy, Roddo, Rollz,
Sherman, Stavs, Sug and Zordo. (Ian played 2019 only and is excluded; 2017 has no owner labels.)

---

## The finding you need to build around

Eight seasons of owner-labelled drafts — 2018 through 2025, 11 managers, 1,232 picks — were tested
for stable individual tendencies. **Almost nothing is stable.**

The test is the intraclass correlation: between-manager variance divided by total variance. Above
0.5 means a trait is genuinely personal and repeatable. Nothing clears it:

| Trait | ICC | Verdict |
|---|---|---|
| QB budget share | 0.32 | weak, usable |
| $1–2 player count | 0.26 | weak |
| TE budget share | 0.21 | noise |
| Top-3 concentration | 0.21 | noise |
| Share spent by nomination 40 | 0.17 | noise |
| WR budget share | 0.09 | noise |
| Overpay vs market | 0.09 | noise |
| RB budget share | 0.08 | noise |
| Biggest single buy | 0.06 | noise |

**On every trait, a manager varies more against himself year to year than managers vary against each
other.** The most extreme case: RB budget share has a within-manager swing of ±13 points against a
between-manager spread of only 4 points. Dovitz averages 61% on RB across the last five seasons, but
his own range is 48% to 78%, and over the full eight seasons his RB share is statistically
indistinguishable from everyone else's.

Nobody consistently overpays either. The spread between the most and least aggressive manager is
about 8% on price-versus-market, while any individual manager swings ±7.6% between seasons.

### What this means for the build

Do not give the bots strong distinct personalities. Doing so would fit noise, and every simulated
draft would be wrong in the same fabricated way — Dovitz hoovering up running backs every single
time, when in reality he does that about half the time.

Build this instead:

1. **All bots share the league-average behavioural model** already specified — the money clock,
   timing multipliers, positional premiums. That model is well supported by the data.
2. **Each bot gets a small persistent tilt**, taken from `traits[].useThis`.
3. **Each bot is redrawn at the start of every draft** using `withinOwnerSD`. This is the important
   one and it is what makes the simulator honest.

Point 3 is not a limitation, it is the actual finding. Your league's managers genuinely do behave
differently from year to year, and a simulator that reproduces that will prepare you better than one
where everyone plays a fixed character.

---

## Implementation

### Per-draft trait draw

At the start of each simulated draft, for each bot and each trait:

```
centre = owner.traits[trait].useThis          // shrunk estimate
sd     = traitStats[trait].withinOwnerSD      // league-wide, from real data
drawn  = clamp(normal(centre, sd),
               traitStats[trait].observedMin,
               traitStats[trait].observedMax)
```

Use `useThis`, **not** `observed`. `observed` is the raw eight-season mean; `useThis` has been
shrunk toward the league mean in proportion to how reliable that trait actually is. For QB share
(ICC 0.32) Sherman's raw 10.4% shrinks to 7.1%; for RB share (ICC 0.08) everyone lands within a
point of the league mean, which is the correct answer given the evidence.

Both values are in the file so you can see what the shrinkage did.

### Mapping traits to bidding behaviour

| Trait | Drives |
|---|---|
| `qbShare`, `rbShare`, `wrShare`, `teShare` | that bot's budget plan for the draft, and its `positionBias` multipliers |
| `top3Concentration` | how stars-and-scrubs its budget plan is |
| `shareSpentByNom40` | how eagerly it spends early; feeds the budget reserve |
| `dollarPlayers` | how many slots it plans to fill at $1–2 |
| `overpayRatio` | a small multiplier on its walk-away price |

The budget plan from `REVISIONS.md` §2a should be **generated from these drawn traits** rather than
picked from a fixed menu. A bot that drew a 60% RB share plans to spend $120 on running backs, and
the reserve rule then keeps it honest.

### Keep the names visible

Label the bots with the real names. Bidding against "Dovitz" instead of "Team 7" is most of the
value here. Show each bot's remaining budget, open slots and positional needs live — that is real
information in a real auction.

Do **not** show the drawn traits during the draft. Reveal them on the results screen so I can see
what each bot was playing that particular draft.

---

## Validation

Beyond the checks already in `REVISIONS.md`:

- Across 200 simulated drafts, each bot's positional budget shares should have a mean near its
  `useThis` value and a spread near `withinOwnerSD`.
- No bot should end up looking like a caricature. If Dovitz spends 60%+ on RB in nearly every
  simulation, the per-draft redraw is not working.
- The distribution of team-level outcomes across bots should look similar — because in eight seasons
  of real data, it is.

---

## A note on your own knowledge

You have watched these people draft for nine years. If you are confident someone has a tendency the
data does not show, your read may still be right — eight seasons is not many, and some of what you
notice (bidding rhythm, who chases, who talks himself into a player) is not in a spreadsheet at all.

But treat the data as a genuine check. Where it says a tendency is not there, the most likely
explanation is that the pattern was memorable rather than real. Adjust the `useThis` values by hand
if you want, but adjust them a little rather than a lot.
