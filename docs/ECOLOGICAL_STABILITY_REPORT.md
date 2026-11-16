# Ecological stability investigation (Mission 4)

Baseline: integration `a0e08ba` (CI run 132 green). Experiments: branch `experiment/ecology-stability`.
Fix: branch `fix/ecology-critical-thirst` (this report). All runs: unmodified weather (it has its own random
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
  compare: `node --import tsx benchmarks/ecology-compare.ts baseline <variants...> [--json out.json]`.

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

## Intervention (in the draft PR): critical thirst outranks other needs
One line in `decide()`: above thirst 0.85, water gets +0.6 utility. Physiologically grounded (dehydration is the more
urgent threat), no species-specific tuning, no survival guarantee.

15 seeds, identical weather, baseline → with the fix (from `docs/evidence/ecology/summary-15-seeds.json`):

| Measure | Baseline | Critical thirst |
|---|---|---|
| Jackal dehydration deaths (median per run) | 5 | **0** |
| Crow dehydration deaths (total, 15 runs) | 237 | **38** |
| Jackal litters (median) | 3 | 7 |
| Kills (median) | 122 | 217 |
| Kills per chase (median) | 13.8% | 12.4% (unchanged: predation is not made easier) |
| Chital extinct | 4/15 | **2/15** |
| All six species persist | 0/15 | **3/15** |
| Jackal extinct | 12/15 | 11/15 |
| Median day-365: chital / hare / crow | 4 / 46 / 12 | 10 / 74 / 20 |

It removes a defect and improves every indicator, but it does **not** make the ecosystem stable: jackals still go
extinct in most seeds, for the reasons in findings 2, 4 and 5.

**Intentional state-hash change.** Every seed's state diverges from `a0e08ba` from the first decision of a critically
thirsty animal. Hashes at days 120/240/360 (seeds 1–3, 2 s tick): seed 1 `478602123/790196107/3620434384` →
`3464037854/1173070098/1095992015`; seed 2 `2420628016/1494600752/2765547395` → `2263421206/2972114127/1304295568`;
seed 3 `1919382446/1293843596/1422860966` → `872687463/1692326525/1291504284`. The production change produces exactly
the hashes of the experiment switch it replaces, so the 15-seed evidence applies to it.

## Proposed next interventions (findings first; not implemented in production)
1. **Predator–prey calibration with the pursuit fix** (finding 2): exempt Stalk/Chase from the closest-approach
   give-up (keep "not moving at all"), then calibrate attack success per prey type against field-plausible ranges
   (golden jackal success on hares and fawns), judged by 15-seed persistence and prey not collapsing. One change at a time.
2. **Hunger-scaled forage search** (finding 4): search reach and home-range tolerance widen as hunger rises
   (up to 3× at hunger 1). See its 15-seed result in the table below.
3. **Open population boundary** (finding 5): rare, seeded immigration and emigration of jackals (and dispersing
   subadults) at the valley edge, and territory-based breeding limits. This is a substantial modelling change and
   needs its own design review.
4. **Unreachable targets** (finding 1, secondary): remember the last abandoned carcass so it is not re-chosen
   immediately.

## Validation of the fix
Unit/headless suite 96/96 (100-day invariants, save/load bit-identical, determinism), including the new
`critical-thirst.test.ts` (fails without the fix) and the observer neutrality test. Browser suite and CI: see the
draft PR.
