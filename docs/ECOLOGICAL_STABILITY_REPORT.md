# Ecological stability investigation (Mission 4)

Baseline: integration `a0e08ba` (CI run 132 green). Experiments: branch `experiment/ecology-stability`.
Fix: branch `fix/ecology-critical-thirst` (this report). Machine-readable 15-seed summary:
[`evidence/ecology/summary-15-seeds.json`](evidence/ecology/summary-15-seeds.json); raw per-day evidence (with
seed, runtime and configuration metadata) is on the experiment branch under `docs/evidence/ecology/` (Mission 4, 23 MB)
and `docs/evidence/ecology/gate1/` (Gate 1 variants, gzipped). All runs: unmodified weather (it has its own random
stream, so **every comparison below uses identical weather for the same seed**), 365 game days at the 1000× tick (2 s),
Linux container, Node 22.

**Time scale.** One life-year is 48 game days (`LIFE_COMPRESSION` 7.6), so 365 game days ≈ **7.6 life-years and
generations**. Earlier reports that said "within a year" meant 365 game days.

## Method
- **Diagnostics** (`benchmarks/ecology/observer.ts`): an external observer that subscribes to the simulation's existing
  events and reads state after each step. It never writes state or draws random numbers; a unit test proves identical
  state, both RNG streams and replay with it attached. It records populations, births and deaths (cause, season, life
  stage), cohort survival to maturity, reproduction (receptivity rules replicated read-only, male proximity,
  conceptions, failed matings), hunting (stalks, chases, kills, why failed chases ended, closest approach), condition,
  water memory, intake, forage at and around chital herds, habitat use, behaviour budgets, and the context of every
  dehydration death.
- **Controlled single-variable experiments** (experiment branch): `ECO_EXPERIMENT` switches, defaults identical to
  production (hash-checked), each disabling one Living Valley component or enabling one candidate fix.
- **Controlled pre-navigation comparison**: commit `e1303f9` plus only the weather-stream split, verified to produce the
  identical weather sequence as current code for seeds 1–3. (The earlier comparison was confounded.)
- **Seeds**: 1–3 for screening, then 1–15 for every candidate fix.
- Run: `node --import tsx benchmarks/ecology-diagnostics.ts --days 365 --seeds 1,2,3 [--variant name]`;
  compare: `node --import tsx benchmarks/ecology-compare.ts baseline <variants...> [--dir path] [--json out.json]`
  (adds death totals, crash/CV dynamics and dehydration context); hashes: `benchmarks/ecology-hashes.ts`.

## Baseline (15 seeds)
Jackals extinct in **12/15**, chital in 4/15, hares 3/15, crows 3/15; all six species persist in **0/15**.
Median day-365 populations: chital 4, boar 19, jackal 0, hare 46, crow 12, myna 45.

## Causal findings, in priority order

### 1. Critically thirsty animals choose food over water (structural; primary cause of jackal decline)
- Baseline, 12 seeds with death context: **59 jackal dehydration deaths**, all of them with a remembered water site,
  at a median **13 m from the river centreline** (one outlier at 698 m), while *approaching carrion* (32), idle (13),
  seeking water (5) or resting (3); 20 were juveniles.
- **The same defect kills crows**: 237 crow dehydration deaths in the 15-seed baseline, median 2 m from the river,
  mostly approaching carrion (99) or idle (44). It is a general decision defect, not a jackal quirk.
- Cause: water utility is capped at 1.25 (`thirst^1.4 × 1.25`), carrion reaches ~1.45 for a hungry jackal plus 0.12
  hysteresis, so a hungry jackal at maximum thirst keeps choosing a carcass. When that carcass is unreachable (in or
  across deep water, which jackals avoid since Living Valley), the progress check abandons the approach, but nothing
  stops the next decision picking the same carcass. Dehydration drains health 0.02/h (vs 0.012/h for starvation).
- Effect beyond direct deaths: parched jackals have lower health (0.90–0.95 vs 0.98–0.99), spend 9–13% of time on
  carrion instead of 2–3%, breed less, and their pups survive to maturity at 0–22% instead of 36–41%.
- Evidence the deep-water cost is the trigger: disabling only `jackalDeepWaterAvoidance` keeps jackals alive in 3/3
  seeds (19–27 litters) with zero dehydration deaths. Exempting only water-seeking from that cost does **not** help
  (15 seeds: jackals extinct 14/15), confirming the losses happen while doing something else (approaching carrion).

### 2. Pursuits are cut short by the Living Valley progress check (structural; lowers kill success)
- In current code 402–525 of ~550–800 failed chases per run end for no hunting reason, at ~8 s: the closest-approach
  test ("did you get closer in the last 4 s?") gives up a pursuit in which prey runs at similar speed, before the
  jackal's endurance (110 s sprint vs 28 s for hares) can tell. Kills per chase: **12–16%** now vs **42–43%** in the
  controlled pre-navigation build.
- Exempting pursuits restores 40–51%, confirming the mechanism. **But** it also makes hares collapse (15 seeds,
  with fix 1: median hares at day 365 fall from 74 to 4), because attack probabilities were calibrated around the
  truncated chases. This needs a joint predator–prey calibration, so it is **not** in the fix PR.

### 3. No other single Living Valley component causes the collapse
Disabling many-eyes vigilance, coordinated flight, regroup, locomotion limits, personal space or dry resting
individually leaves jackals extinct in every screening seed. With all of them off (but the progress check on),
outcomes vary widely by seed (one run reached 39 jackal litters), which is why the larger seed sample was needed.

### 4. Chital starve where they stand (structural, pre-existing)
Forage under chital herds falls from ~0.46–0.50 to 0.16–0.27 while the valley mean stays ~0.53–0.60, in both the
current and pre-navigation builds. Chital search only ~70 m (5 samples, 3 pulled toward the herd centre) with a
home-range pull toward a home centre that never moves. Proposal tested below; not in the fix PR.

### 5. The ecosystem lacks predator regulation and has no immigration (structural, pre-existing)
When jackals thrive (water avoidance off, or the pre-navigation build) they overexploit prey: hares extinct in 3/3,
chital down to 2–9. When they fail, chital starve. There is no territoriality limiting jackal density and the valley
is closed (no immigration or emigration). With 6 founders, extinction is likely in a closed 2 km² valley even with
plausible rules; real populations of this size persist through immigration.

### Ruled out
- **Tick size**: kills per chase and kills are similar at 0.25 s and 2 s ticks (48-day comparison).
- **Background mortality calibration**: daily hazards are mild in life-years (pup survival to half-maturity ~55%).
- **Food-limited jackal breeding**: hunger blocks only 2–15% of eligible breeding hours.
- **Pair cohesion** as a primary cause: receptive females rarely have their own male nearby, but when jackals are
  healthy most matings are with males of other groups and the population grows anyway.

## Intervention (in the draft PR): a physiological emergency layer for critical thirst
The first version of this PR added +0.6 to water utility above thirst 0.85 and claimed that critical thirst "outranks
every other need". Review showed the claim was false: an exhausted diurnal bird roosting at night kept roosting (roost
1.64 with hysteresis vs water 1.612), and the committed-action early returns (`Feed` while hunger > 0.05, `Chase`)
ran *before* utilities, so a feeding or chasing animal never saw the bonus at all. The utility bonus is replaced by
an explicit layer in the decision hierarchy.

### Behavioural priority policy (Gate 1)
Evaluated in this order on each re-decision (`Simulation.decide`):

| # | Layer | Rule |
|---|---|---|
| 1 | Flood escape | small ground animals leave rising water |
| 2 | Escape | `fear > 0.4` → flee. **Never overridden by thirst** (a predator kills faster than dehydration) |
| 3 | **Physiological emergency** | `thirst > CRITICAL_THIRST` (0.85) and not drinking → go to water (or range for it if no water is known) |
| 4 | Committed actions | `Drink` and `Chase` continue; `Feed` continues while hunger > 0.05 |
| 5 | Dependent young | follow the mother |
| 6 | Utilities | ordinary needs compete (water `thirst^1.4 × 1.25`, the pre-PR curve, no bonus) |

Interruptibility under the emergency layer:

| Current behaviour | At critical thirst | Why |
|---|---|---|
| Drink | continues | it is the remedy |
| Flee / flood escape | continues | escape outranks physiology |
| Feed, SeekCarrion | interrupted → water | the original defect (dying of thirst beside a carcass near the river) |
| Chase, Stalk | interrupted → water | a pursuit lasts seconds to minutes; thirst at 0.85 leaves ~5 h before health starts to drain, but the chase may not end near water and the animal repeatedly re-chooses food |
| Rest / Roost (nocturnal or crepuscular species, or any species in daylight) | interrupted → water | |
| Rest / Roost of a **diurnal** species in darkness (daylight < 0.1) | **deferred until first light** | activity-pattern rule, not a species exception: diurnal animals in this model do not travel in darkness. Cost: thirst saturates ~5 h after 0.85, then health drains 0.02/h, so a night's wait costs ≤ ~0.1 health; an animal already near death can still die (no survival guarantee) |
| Any other behaviour of a diurnal animal at night (awake, e.g. after a disturbance) | interrupted → water | an animal that is moving anyway goes to water rather than food |
| SeekWater | continues (no re-targeting while critical) | committed journey |
| Dependent young (mother alive) | follow the mother | young are provisioned (thirst tracks the mother's), the mother handles the emergency |

The diurnal-darkness deferral is a modelling assumption (the model gives diurnal species low activity and short vision
at night); no field study was consulted for the specific claim that a parched crow or myna will not fly to water at
night, so it is flagged for review rather than presented as field evidence. No species is named in the rule, and
water utility for non-critical thirst is unchanged from `a0e08ba`.

### Tests (`tests/unit/critical-thirst.test.ts`, 11 deterministic cases)
Starving + critically thirsty jackal beside a carcass → water; moderately thirsty (0.6) → carcass; just below the
threshold → carcass; already feeding at critical thirst → water; feeding with ordinary thirst → keeps feeding;
mid-chase at critical thirst → water; drinking at critical thirst → keeps drinking (and thirst falls); frightened and
critically thirsty → flees; exhausted crow roosting at midnight with thirst 0.86 (the review counterexample) → keeps
roosting, and the same crow at noon → water; awake crow at midnight beside a carcass → water; nocturnal jackal resting
at midnight → water. Against `a0e08ba` 6 of these fail (base water curve); against the first PR version (`9d323e6`) 2
fail (the `Feed` and `Chase` early returns) — the review's findings reproduced as tests.

### Water access defects found while validating the policy
The first 15-seed run of the emergency layer showed **more** myna dehydration deaths than baseline (68 vs 14), almost
all while *seeking water* a median 27 m from the river with the site remembered. Per-animal traces
(`node --import tsx benchmarks/ecology-trace.ts <seed> <species>`) found three pre-existing
defects that the emergency layer exposed (it keeps a parched animal trying instead of letting it drift to another
behaviour):

1. **Ground-pinned birds** (`move()`): a bird climbs only above 1.5× walking speed, but the climb decision used the
   previous tick's speed. A bird blocked on the ground has its speed reset to 0 every tick, so it could never take off.
   At the 1000× tick (2 s) a myna walking to the river took a ~20 m ground step into 1.6 m deep water past a 6 m bank,
   was blocked, and stayed on the bank until it died (`tests/unit/bird-takeoff.test.ts`: pinned for 120 ticks before,
   drinking by tick 2 after). Fix: decide altitude from this tick's speed (a reorder, no new parameter). The same
   defect starved birds: crow starvation falls from 462 to 5 with this fix alone.
2. **Water inside ruins**: `findWater` returned a dump pool inside a building footprint, where birds are held at roof
   height (2.5 m) and the drink probe needs < 0.3 m. The bird hovered over the water until it died.
3. **Water beyond the region margin**: `findWater` returned a river cell at z = 2 m, outside the 6 m margin that
   `passable()` enforces.

In each case the progress check forgot the site and the next decision found the same site again. Fix for 2 and 3:
`findWater(x, z, r, accept?)` takes an optional filter; the simulation passes `drinkable` (inside the region margin
and not inside walls). Regression tests: `tests/unit/water-sites.test.ts` (both fail without the filter).

### 15-seed results (identical weather per seed, 365 game days ≈ 7.6 life-years; 48 game days ≈ 1 life-year)
`docs/evidence/ecology/summary-15-seeds.json`. Variants: `utility-bonus` = the first PR version (`9d323e6`);
`emergency-layer` = the policy alone; `+takeoff` = with fix 1; `+water-access` = with fixes 1–3;
**`emergency-layer+water-access` = this PR**. Controls `baseline+takeoff` and `baseline+water-access` apply only the
locomotion/site fixes to `a0e08ba`, so each change's effect can be separated.

| Measure | baseline | utility-bonus | emergency-layer | baseline+takeoff | baseline+water-access | **this PR** |
|---|---|---|---|---|---|---|
| Jackal extinct | 12/15 | 11/15 | 9/15 | 10/15 | 13/15 | 8/15 |
| Chital extinct | 4/15 | 2/15 | 3/15 | 2/15 | 3/15 | 3/15 |
| Hare extinct | 3/15 | 4/15 | 3/15 | 0/15 | 1/15 | 4/15 |
| Crow extinct | 3/15 | 3/15 | 2/15 | 0/15 | 0/15 | 0/15 |
| All six persist | 0/15 | 3/15 | 4/15 | 4/15 | 2/15 | 3/15 |
| Dehydration deaths, total: jackal / crow / myna / chital / hare | 72/237/14/1/13 | 0/38/55/23/30 | 0/37/68/26/19 | 56/42/10/7/23 | 58/5/6/0/13 | **0/9/5/9/16** |
| Crow / myna starvation, total | 462 / 439 | 605 / 423 | 609 / 442 | 5 / 166 | 11 / 175 | 15 / 142 |
| Hare predation, total | 1440 | 3035 | 2671 | 1952 | 1867 | 2651 |
| Kills per chase (median) | 0.138 | 0.124 | 0.127 | 0.140 | 0.138 | 0.129 |
| Jackal litters (median) | 3 | 7 | 7 | 3 | 3 | 8 |
| Median day-365 chital/boar/jackal/hare/crow/myna | 4/19/0/46/12/45 | 10/14/0/74/20/39 | 5/12/0/54/11/31 | 4/13/0/44/74/54 | 2/10/0/69/80/54 | 6/11/0/9/67/64 |
| Hare: seeds crashing to ≤ 20% of running peak | 10 | 8 | 9 | 9 | 10 | 11 |
| Hare: median minimum after day 30 | 28 | 37 | 39 | 26 | 30 | 5 |
| Hare: median CV, days 183–365 | 0.45 | 0.41 | 0.53 | 0.65 | 0.47 | 0.79 |
| Jackal: seeds crashing to ≤ 20% of running peak | 5 | 10 | 9 | 6 | 4 | 10 |

**What is robust.**
- Dehydration beside water is essentially gone: jackal 72 → 0, crow 237 → 9, myna 14 → 5. The remaining deaths are
  mostly animals that are fleeing or wandering without a remembered site (hares), or a few seeking water.
- The locomotion fix alone removes bird starvation (crow 462 → 5–15) and bird extinctions (3/15 → 0/15).
- Predation is not made easier: kills per chase stay at 0.13–0.14.

**What is not robust.**
- Jackal extinction counts at n = 15 are dominated by trajectory sensitivity. Narrowing the night deferral alone
  (`emergency-layer-all-dark-deferral` → `emergency-layer`) moved jackal extinction from 6/15 to 9/15, with nearly
  disjoint sets of extinct seeds.
- 8/15 vs 12/15 is not significant (Fisher exact two-sided p ≈ 0.25). Treat the jackal counts as "no worse", not as
  an improvement.

**Gate 1 ecological acceptance: not fully met.**
- With the full fix, jackals persist longer in most seeds: median jackal-present days 362 vs 182 at baseline.
- Hare predation nearly doubles (1440 → 2651).
- Hare populations end lower: median 9 vs 46 (Mann-Whitney p ≈ 0.17, n = 15), with a median minimum of 5 vs 28 and
  more variation (CV 0.79 vs 0.45).
- This is finding 5 appearing once an artificial jackal mortality is removed. The model has no predator regulation:
  jackal diet breadth, territoriality and dispersal are missing.
- The PR removes defects; it does not make the ecosystem stable, and it shifts pressure from jackals to hares.
- Keeping the defects would be an untracked, fake population control, so I do not propose that. The decision for the
  owner is whether to accept this interim predator–prey imbalance until Gate 2 (jackal generalist diet, territories)
  addresses it, or to hold the PR until a Gate 2 mechanism lands with it.

**Intentional state-hash change.**
- Hashes from `node --import tsx benchmarks/ecology-hashes.ts --days 10,20,30` and `--days 120,240,360`, 2 s tick,
  seeds 1–3.
- **Correction:** the first PR version of this report labelled its hashes "days 120/240/360". They were taken every
  7,200 ticks, which is days **10/20/30**. The values themselves reproduce exactly.

| Seed | `a0e08ba` days 10/20/30 | first PR version (`9d323e6`) days 10/20/30 | this PR days 10/20/30 |
|---|---|---|---|
| 1 | 478602123/790196107/3620434384 | 3464037854/1173070098/1095992015 | 2298162173/3675228688/751902760 |
| 2 | 2420628016/1494600752/2765547395 | 2263421206/2972114127/1304295568 | 425619944/1429583609/2714388853 |
| 3 | 1919382446/1293843596/1422860966 | 872687463/1692326525/1291504284 | 802203571/2112651462/2488521148 |

| Seed | `a0e08ba` days 120/240/360 | first PR version days 120/240/360 | this PR days 120/240/360 |
|---|---|---|---|
| 1 | 676320141/3560467062/1449537436 | 1740526352/751355072/1421127066 | 1919280215/939853210/2241572292 |
| 2 | 2995718633/3930275761/1862026796 | 979495695/2158921676/2238650219 | 3113848433/1483976965/2056180836 |
| 3 | 3853392221/3562835345/1953707357 | 4030266239/98599803/3337349182 | 1972272782/1728861236/1969100673 |

The divergence from `a0e08ba` starts at the first decision of a critically thirsty animal, or the first blocked bird.
The state hash is still deterministic for seed + ordered inputs: the 100-day, replay and save/load tests pass.

### Outstanding (not addressed in this PR)
- Hares and chital still die of thirst occasionally (16 and 9 in total over 15 runs), mostly while fleeing or with no
  remembered water. These deaths have not been traced individually.
- Residual stranded bird: with this PR, `ecology-trace.ts 5 myna` still shows a myna dying at day 271, about 9 m from
  water, at 1.0 m altitude.
  - A likely mechanism is a dead band. A water-seeking bird runs only when the water is more than 12 m away, but
    climbs only above 1.5× walking speed and only when the destination is more than 9 m away. Between 9 and 12 m it
    walks and cannot take off.
  - I could not reproduce this in isolation, either at t = 0 or with the river stage lowered, so no change was made.
    Next step: snapshot the simulation just before that death and replay the case.
- The diurnal-darkness deferral is a modelling assumption, not field-calibrated.
- An unreachable water site is forgotten and can be re-found. That no longer kills, but bounded memory of failed sites
  belongs in Phase 4 (learning).
- Predator regulation (Gate 2).

## Lessons from wild ecosystems (what real animals do that the model lacks)
The remaining instabilities line up with documented behaviour of these species. Field evidence, briefly:

| What wild animals do | What the model does | Implication |
|---|---|---|
| **Golden jackals are generalists**: in Indian studies rodents, birds and fruit make up >60% of the diet (Bharatpur) or rodents, reptiles and fruit >80% (Kanha); mammals ~45% of scat occurrence in Sariska, mostly rodents; vegetable matter ~20% [JoTT 2020; ADW] | Jackal diet `veg 0.12`; hares and fawns carry much of the load, so a thriving jackal population collapses prey (finding 5) | Shift weight toward the small-fauna pool, carrion and fruit, so predation on hares/fawns is opportunistic, not the staple |
| **Pairs hunt together**: jackal pairs were more than twice as successful as singles on gazelle fawns; mothers defend fawns [Wyman 1967, Serengeti; Ngorongoro field note] | Jackals hunt alone; partners drift apart (receptive females rarely have their male nearby) | Pair cohesion (partners travel together) would raise breeding contact and make fawn hunting a pair activity, instead of tuning per-attack odds |
| **Territorial pairs, helpers that disperse**: breeding pairs are spaced around core den territories; helpers stay about a year then leave; jackals range 40–50 km when food is scarce [JoTT 2020; ADW] | No territories, no dispersal, closed valley; 6 founders | Territory-limited breeding (regulation) plus emigration/immigration at the valley edge (rescue): the two missing stabilisers |
| **Chital switch to browse in the dry season** (shrubs stay green longer; grass 53% of dry-season intake vs 95% wet, Queensland) and favour forest when dry [CSIRO RJ20015; Sri Lanka study] | Chital eat a single vegetation pool, same everywhere and all year | Seasonal browse resource in forest/scrub would buffer dry-season starvation |
| **Chital herds split when food is scarce**: dry-season groups of 5–6 [Sri Lanka study]; home ranges ~1.4 km² (F) / 1.95 km² (M) | Herd cohesion and regroup pull animals back to one centre regardless of food | Likely why wider forage search did not reduce chital starvation: cohesion should relax with hunger (fission–fusion), letting small groups spread over the range |
| **Chital drink daily near permanent water, approach cautiously in herds** | Water access works; vigilance in groups exists | Consistent; no change |

Sources: [Journal of Threatened Taxa 12(11), 2020](https://threatenedtaxa.org/index.php/JoTT/article/download/4489/6959?inline=1),
[Animal Diversity Web: Canis aureus](https://animaldiversity.org/accounts/Canis_aureus/),
[Zeitschrift für Säugetierkunde 43 (jackal fawn hunting)](https://www.zobodat.at/pdf/Zeitschrift-Saeugetierkunde_43_0210-0223.pdf),
[Ultimate Ungulate: Axis axis](https://ultimateungulate.com/Artiodactyla/Axis_axis.html),
[CSIRO Rangeland Journal RJ20015 (chital diet, Queensland)](https://publish.csiro.au/rj/RJ20015),
[Sri Lanka chital study (archive.org)](https://archive.org/download/biostor-148559/biostor-148559.pdf).
No field study found gives a jackal success rate per chase on hares; any attack-success calibration must therefore be
judged by population outcomes and diet composition, not a single literature number.

## Proposed next interventions (findings first; not implemented in production)
Ordered by evidence and by how much behavioural realism they add (each to be tested one at a time, 15 seeds, same
weather, against this baseline):
0. **Diet realism for jackals** (field diet composition): more small fauna, carrion and fruit; fewer kills needed per
   jackal. Directly addresses prey collapse when jackals thrive.
0b. **Pair cohesion and pair hunting** for pair-bonded species, and **fission–fusion chital herds** (cohesion relaxes
   with hunger). Both replace parameter tuning with behaviour observed in the wild.
1. **Predator–prey calibration with the pursuit fix** (finding 2): exempt Stalk/Chase from the closest-approach
   give-up (keep "not moving at all"), then calibrate attack success per prey type against field-plausible ranges
   (golden jackal success on hares and fawns), judged by 15-seed persistence and prey not collapsing. One change at a time.
2. **Hunger-scaled forage search** (finding 4): search reach and home-range tolerance widen as hunger rises
   (up to 3× at hunger 1). Tested on top of the critical-thirst fix, 15 seeds: jackals extinct **6/15** (from 11),
   all six species persist **5/15** (from 3), median day-365 boar 32, hare 91, jackal 1; but **chital starvation is
   unchanged** (median 60 vs 59). It mainly helps jackals, which also forage for small fauna over a large home range.
   So the chital local-depletion hypothesis is incomplete: wider search alone does not move herds off depleted
   ground. Next diagnostic: herd cohesion/regroup and calf-following anchoring herds (both pull animals back toward
   the herd centre), and forage regrowth rates. Not proposed for production yet.
3. **Open population boundary** (finding 5): rare, seeded immigration and emigration of jackals (and dispersing
   subadults) at the valley edge, and territory-based breeding limits. This is a substantial modelling change and
   needs its own design review.
4. **Unreachable targets** (finding 1, secondary): remember the last abandoned carcass so it is not re-chosen
   immediately.

## Validation of the fix (Gate 1, Linux container, Node 22, software-rendered Chromium)
- `npm run typecheck`: clean. `npm run build`: passes.
- `npm test`: **109/109**. Includes 100-day invariants, save/load bit-identical, determinism and replay, observer
  neutrality, the 11 critical-thirst cases, the bird take-off regression and the 3 water-site regressions.
- `npm run test:e2e -- --trace off`: **19/19**. Suites: smoke, gameplay, reliability, documentary (10.3 min).
- 15 seeds × 365 game days for 8 variants: see the table above.
- Hash checkpoints: re-run after the final commit; they match the measured code exactly.
- CI: see the PR.
