# Population scaling: the real simulation

Baseline: integration `a0e08ba` (CI run 132 green). Branch `experiment/tech-validation-population`. All numbers:
Linux container, Intel Xeon @ 2.10 GHz, 4 logical CPUs, Node 22.23 / V8 12.4, `--expose-gc`. **Not real hardware**;
the Victus should rerun `node --expose-gc --import tsx benchmarks/population-scaling.ts` before decisions that depend
on absolute numbers. GPT-6's PR #15 measured synthetic data layouts; this report measures the actual `Simulation`.

Evidence (`docs/evidence/tech-experiments/`): `population-scaling-container-baseline.json` (a0e08ba code),
`population-scaling-container-per-species-index.json` (after the one targeted change), `natural-ecosystem.json`
(unmodified food web, 365 days, seeds 1–3), `natural-ecosystem-e1303f9.json` (same, before Living Valley navigation).

## Method
- **Profiler** (`packages/ecology/src/profile.ts`): opt-in `Simulation.profiler`; `null` by default (one null check
  per stage). Times environment, spatial index, herd groups, physiology, births, deaths, decide/perception, predation,
  herd behaviour, other behaviour, move/personal space, carcasses, sweep, stats; counts spatial queries and candidates
  visited. Reads only the clock: state, both RNG streams and hashes are identical with it on (unit-tested).
- **Synthetic population stress** (`benchmarks/fixtures/population.ts`, test-only): `stressFixture(seed, n)` uses the
  supported Experiment API `addAnimals` in the natural species proportions: real adults, unique IDs, real groups,
  habitat placement. It measures computation at a controlled count. **It is not a sustainable ecosystem**: food and
  water were never sized for these numbers.
- **Naturally evolving ecosystem** (`benchmarks/natural-ecosystem.ts`): the unmodified simulation from its natural
  start, 365 days at the 1000× tick, no levers, no rule changes.
- Speeds as the game runs them: 1× = 10 ticks/s of 0.1 s; 10× = 40/s of 0.25 s; 100× = 100/s of 1 s; 1000× = 500/s
  of 2 s. Camera focus set as in the game (distant animals decide less often). Budget: the game lets the simulation
  use up to 9 ms per 60 Hz frame (**540 ms of CPU per real second**); "comfortable" = 250 ms/s (a quarter of a core).
- 3 rounds per size × speed (20 warm-up ticks, 80–300 measured), plus a separate profiled pass for the breakdown.
  Every round ended in the identical state hash (per-engine determinism held in all 48 configurations).

## Finding 1 (latency, not population): lazy scatter generation inside ticks
The first time a bird looks for a perch in a chunk, `Valley.perches` builds that chunk's whole vegetation scatter
(noise sampling for every tree, shrub, reed, rock and piece of litter): 5–7 ms per chunk, 361 chunks, **1.7–2.7 s in
total, paid inside ticks**. Before warm-up, p99 ticks were 16–61 ms at 216–1,000 animals (max 123 ms); the natural
run shows day-1 p99 of 28–43 ms. After warm-up, p99 is ~1–5 ms at the same sizes. This affects the game today
(main-thread hitches early in a session) and is independent of population. The benchmarks pre-warm and report the
warm-up separately. Fix candidates: build perches from the tree pass only (perches use only trees: ~6% of the
candidates the full scatter evaluates), or pre-build them in the terrain Worker at load.

## Finding 2: the scaling curve and the first population bottleneck
Median tick and CPU per real second (baseline code; ms/s = median × ticks per second):

| Animals | 1× | 10× | 100× | 1000× |
|---|---|---|---|---|
| 216 (natural) | 0.21 ms · 2 ms/s | 0.20 · 8 | 0.33 · 33 | 0.36 · **180** |
| 1,000 | 1.00 · 10 | 0.76 · 30 | 1.15 · 115 | 1.88 · **938** |
| 2,500 | 3.47 · 35 | 3.38 · 135 | 3.87 · **387** | 5.09 · 2,547 |
| 5,000 | 8.74 · 87 | 11.98 · **479** | 14.39 · 1,439 | 20.57 · 10,285 |
| 10,000 | 26.33 · **263** | 37.25 · 1,490 | 58.01 · 5,801 | 82.59 · 41,293 |

Where the time goes (profiled, exclusive stage ms per tick):
- **1×: locomotion/steering (`move`) dominates at every size** and grows ~linearly (5,000: 6.8 of 8.7 ms; 10,000: 14.8).
- **Under time acceleration, perception dominates** and grows super-linearly: at 1000× it is 15.0 ms at 5,000 and
  68.8 ms at 10,000 (×4.6 for ×2 animals). Each decision scans every animal within its vision radius (95–220 m);
  candidates visited per query grow with density: 11 at 216 animals → 151 at 5,000 → 311 at 10,000. Decisions per
  tick grow with the tick size (timers count simulated seconds), so the O(N²) term appears first at 100×/1000×.
- Births/deaths, carcasses, herd groups, environment: negligible (< 0.1 ms) even at 10,000. GC: 3–9% of tick time.

**First substantial population bottleneck: perception neighbour enumeration (O(N²) in a fixed valley).**

## The one targeted change: per-species spatial index
Perception only ever needs the animal's own species (crowding, mates, alarms), its predators (if it can be afraid) and
its prey (if it is hunting). A per-species spatial hash (same cell size, same insertion order) lets it visit only
those; personal space needs only its own species. Each prey species has exactly one predator species, so threat
candidates (the only random draws in perception) are visited in exactly the original order. `SpatialHash.clear` now
clears only used buckets (O(items)), so seven indexes cost no more than one at small sizes.

**Parity:** state hash, population and RNG state identical at every checkpoint of 16 scenarios (natural seeds 1/2/4
at all four speeds; 1,000- and 2,500-animal fixtures at 10× and 1000×), `benchmarks/population-parity.ts`.

After the change (median tick · ms per real second):

| Animals | 1× | 10× | 100× | 1000× |
|---|---|---|---|---|
| 216 (natural) | 0.17 · 2 | 0.16 · 6 | 0.36 · 36 | 0.37 · 186 |
| 1,000 | 1.08 · 11 | 0.66 · 26 | 1.18 · 118 | 1.82 · 912 |
| 2,500 | 3.38 · 34 | 3.33 · 133 | 3.41 · 341 | 4.76 · 2,382 |
| 5,000 | 8.84 · 88 | 9.93 · **397** | 8.44 · 844 | 12.75 · 6,374 |
| 10,000 | 21.44 · **214** | 24.98 · 999 | 25.21 · 2,521 | 41.04 · 20,521 |

Candidates visited per perception query at 10,000: 311 → 53. Gains appear from ~2,500 animals and reach ×2.3 at
10,000 / 100×; the natural-size tick is unchanged within run-to-run noise (0.14–0.21 ms at 1×). p99 at 10,000 / 100×:
133 → 50 ms.

Other measurements (after the change): heap ≈ 0.4 KB per animal (10,000 animals: 48 MB heap in total, most of it the
valley and environment); save JSON ≈ 820 B per animal (8.2 MB at 10,000; 0.76 MB at the natural size), snapshot
3 ms + stringify 51 ms at 10,000; load 220–370 ms at every size (dominated by building the valley and environment,
not animals); fixture build 230–300 ms.

## Practical limits (this CPU, existing architecture + per-species index)
Two constraints apply: CPU per real second against the game's 540 ms/s simulation budget (250 ms/s comfortable), and,
because a tick cannot be split across frames, the tick itself against the 9 ms per-frame budget (a longer tick is a
visible hitch).

| Speed | Comfortable up to | Within the game's budgets up to | Binding constraint |
|---|---|---|---|
| 1× | ~5,000 (median 8.8 ms, p99 14 ms) | ~5,000; at 10,000 every tick (median 21 ms, p99 38 ms) is a frame hitch | tick latency |
| 10× | ~2,500–4,000 | ~5,000–6,000 | CPU per second |
| 100× | ~1,500 | ~3,000 | CPU per second |
| 1000× | **< 250** (the natural 216 already uses 186 ms/s) | ~500 | CPU per second |

At 1000× the game already drops backlog rather than spiral (Game.ts), so 1000× above ~500 animals means the requested
rate is not reached, not a hang. **Practical maximum for the full experience (all speeds up to 100× within budget):
about 3,000 active animals on this CPU; about 1,000 with comfortable headroom.** Real hardware will differ;
the Victus has not run this benchmark yet.

## Finding 3: the naturally evolving ecosystem never needs this scale, and is not stable over a year
365 days at 1000×, unmodified rules, seeds 1–3 (populations chital/boar/jackal/hare/crow/myna):

| Seed | Start | Peak | Day 365 | Extinct within a year | Max daily mean tick |
|---|---|---|---|---|---|
| 1 | 216 | 334 | 104 | jackal, hare | 0.72 ms (after day 1) |
| 2 | 219 | 387 | 211 | jackal | 0.87 ms |
| 3 | 216 | 477 | 135 | chital, jackal, crow | 1.36 ms |

- The real food web produces **at most ~480 animals**: computational scale is not the constraint on the current
  valley; ecological sustainability is.
- **Jackals go extinct in every seed** within a year (founding population 5–6; deaths mostly background, dehydration
  and starvation). Without predators, hares boom (200–260) and crash. **Starvation is the leading chital death**
  (43–81 per seed); seed 3 loses all chital by day ~330.
- The earlier 100-day checks (unit tests, `npm run sim`) all persisted; this is a 1-year instability. It is reported,
  not fixed: this task forbids changing ecological rules, and the fix needs its own reviewed calibration work.

### Pre-navigation comparison (`e1303f9`, before Living Valley movement and herd changes)
Same harness, same seeds (note: `e1303f9` also predates the separate weather stream, so each seed's weather differs).

| Seed | Peak | Day 365 (chital/boar/jackal/hare/crow/myna) | Extinct | Chital deaths: predation / starvation | Jackal dehydration |
|---|---|---|---|---|---|
| 1 | 425 | 12/0/33/1/65/73 | boar | 101 / 3 | 0 |
| 2 | 326 | 13/14/8/0/67/73 | hare | 88 / 28 | 0 |
| 3 | 431 | 5/10/20/0/59/59 | hare | 78 / 40 | 1 |
| *a0e08ba, seeds 1–3* | 334–477 | jackals 0 in all | jackal (all), + hare / chital+crow | 34 / 43, 7 / 78, 6 / 81 | 4, 3, 6 |

Neither version is stable over a year, but they fail differently. Before, predators dominated (jackals survive,
chital die mainly to predation, prey species collapse). After the Living Valley changes, **predation success fell by
3–13×** (many-eyes vigilance, coordinated herd flight, acceleration limits, jackals avoiding deep water) and jackal
dehydration deaths appeared; jackals then die out and chital starve under unchecked competition. The relative share of
behaviour vs weather changes is not separated here. This is the highest-priority follow-up: a reviewed calibration of
predator success and water access, judged by a 365-day, 3-seed stability check (ARCHITECTURE_DECISION_2026-11.md).

## Correctness checks
`tests/unit/step-profiler.test.ts`: profiler on/off identical state and RNG; all ticks accounted; stage time ≤ wall
time; fixtures deterministic, natural proportions within 2%, valid placement; a fixture steps, saves and reloads
bit-identically; alive = start + births − deaths; new animals always get fresh, never-reused IDs (the ID counter is
shared with groups and carcasses, so gaps are normal). Every benchmark round asserts per-engine determinism. Observation
contracts unchanged. Cross-engine `Math` differences remain a documented limitation (SIMULATION.md); no math-library
change was made.
