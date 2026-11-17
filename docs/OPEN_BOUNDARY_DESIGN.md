# Open valley boundary: design (issue #29), revision 2

Status: **design only. Revised after the owner's review of PR #30.** No migration code exists.
- The audit this design rests on is `docs/OPEN_BOUNDARY_AUDIT.md`.
- Finding B1, birds stranded at the edge, is fixed in its own PR from integration (`fix/b1-bird-edge`).

**Owner decisions on revision 1:**
1. Identity-preserving regional individuals are approved in principle, with coarse off-map simulation allowed.
2. Jackals and hares only, for now.
3. Movement across the boundary must be simulation-authoritative; investigate a narrow transit corridor (§5).
4. The parameter table needs the corrections listed below.
5. B1 is fixed first.

**What revision 2 changes:**
- **Ring geometry contradiction resolved** (§3). Revision 1 put a second territory row 1,440 m outside a ring only
  960 m wide. The ring is now 1,440 m wide, and the territory counts are checked geometrically.
- **The "10 straddling slots" claim is withdrawn.** It came from a lattice argument that ignored two things:
  - A centre 480 m outside the edge has an exclusive disc that only *touches* the map.
  - Spacing must hold against the valley's own territories.
- **Straddling and fully external territories are defined and reported separately.**
- **Off-map hunger, thirst, reproduction, mortality and travel time are specified** (§4).
- **Feasibility of a simulation-authoritative transit corridor**, with measurements (§5).
- **Immigration is now purely movement-driven.** It cannot be triggered by low counts or vacancies (§5.4).
- **Uncertainty is stated for territory spacing, initial occupancy and hare density** (§8).

## 1. Events the model must distinguish
| Event | What it is |
|---|---|
| **Excursion** | A resident of a straddling territory crosses the edge and comes back. It is movement within its home range: not emigration, not death |
| **Emigration** | An animal whose home is in the valley, or who has none (a floater or disperser), leaves. It stays alive in the region |
| **Visit** | An off-map animal enters the valley and leaves again without settling |
| **Immigration** | An off-map animal enters and then establishes residence. A jackal does so by taking a territory slot whose centre is in the valley; a hare by settling a home in the valley |
| **Return** | A former valley resident comes back |

## 2. Approach (approved in principle)
**Regional individuals.**
- Off-map animals are ordinary `Animal` records with `offmap = true`. They keep ID, sex, age, mother, group, needs,
  failed-target memory and territory relations.
- Off-map they are advanced by a coarse, deterministic hourly model (§4) that uses the same species parameters.
- They are not rendered.
- They cross the boundary only by movement, through a narrow simulation-authoritative transit corridor (§5).

**Rejected alternatives:**
- anonymous pools, because they cannot preserve identity;
- a renderer-only illusion, because the owner rejected it;
- a full-resolution larger world, because it changes every budget.

## 3. Regional landscape geometry (verified)
**Landscape.**
- The landscape is the valley (1,440 m square) plus a ring of width `W = 1,440 m`, giving a 4,320 m square of
  18.7 km², 9× the valley.
- The ring is the only off-map space. Nothing exists beyond it.

**Why 1,440 m.** It is the smallest ring that holds a row of territories that do not touch the map:
- The exclusive radius is `r = spacing / 2 = 480 m`.
- A territory is **straddling** if its centre is outside the map at a distance `c` from the edge with `0 < c < r`, so its
  disc overlaps the map.
- A territory is **fully external** if `r ≤ c ≤ W − r`.
- With `W = 960 m`, only straddling territories fit (`c < 480`). The external source population would then exist only
  where it touches the valley, which is not a neighbouring population in any useful sense.

**Territory placement.**
- Regional centres are placed at world creation by the **same rule valley floaters use**: a candidate is accepted only if
  it is at least `spacing` from every held centre, valley and regional alike.
- Candidates are drawn uniformly over the ring from `migRng`; the rule is random sequential packing.
- After creation, regional floaters claim new regional territories by the same rule, so the regional territory count is
  dynamic, as it is in the valley.
- No lattice is used.

**Geometric check.** `benchmarks/regional-geometry.ts`, 60 seeds, using the #28 world-start valley territories. Values
are median [10–90%]:

| Ring W | Spacing | In-valley (start) | Straddling | Fully external | Regional total |
|---|---|---|---|---|---|
| 1,440 m | **960 m (pre-registered)** | 1 [1–2] | **2 [1–3]** | **7 [6–9]** | **9 [8–10]** |
| 1,440 m | 720 m (−25%) | | 4 [2–6] | 14 [12–15] | 18 [16–20] |
| 1,440 m | 1,200 m (+25%) | | 2 [1–3] | 4 [3–6] | 6 [5–7] |
| 960 m (rev. 1) | 960 m | | 5 [4–6] | 0 | 5 [4–6] |

**Consequences, stated plainly.**
- At 960 m spacing the valley is touched by only about two straddling regional territories, plus its own one or two. Its
  jackal neighbourhood is a few pairs, not ten.
- Any visiting jackals come mainly from about two straddling pairs. Any immigrants come from dispersers born across
  about nine regional territories.
- These counts follow from the spacing assumption. Spacing is the largest single uncertainty (§8), which is why it has a
  sensitivity run.

**Hares.**
- Off-map hares live in the ring strip within 260 m of the edge (two home ranges, assumed). Hares farther out cannot
  reach the valley within the run and are not represented.
- Strip area: 4 × 1,440 × 260 + 4 × π × 260² / 4 ≈ 1.71 km².

**Edge-sector connectivity.** Derived from terrain, not tuned.
- For each 120 m edge sector, connectivity is the walkable fraction of the 0–120 m band in the valley times the band's
  mean habitat suitability for the species.
- The river corridor sectors connect hares best, because the generator keeps the ridges open there (audit B2).

## 4. Off-map coarse model (hourly, deterministic, `migRng`)
**Random numbers.**
- All off-map draws use `migRng = Rng(hash3(seed, 99, 3))`. With the boundary closed it is never constructed or drawn
  from, so configuration C reproduces #28's frozen hashes (audit §5).
- The step order is fixed: off-map animals are updated by ascending ID once per game hour, after the on-map step that
  completes the hour.

**Coarse position and travel time.**
- Every off-map animal has a coarse position on the 4,320 m landscape.
- Each hour it moves by a bounded random walk, or by directed travel.
- **Hourly random walk** (ordinary daily ranging). Hourly displacement is `activity(hour) × speed × 3,600 s ×
  tortuosity`:
  - `activity` is the species' own diel activity curve, the same one used on-map;
  - `speed` is the species' walking speed;
  - `tortuosity` is 0.15 (assumed), turning metres walked into net displacement per hour;
  - the walk is reflected so the animal stays within `1.5 × homeRange` of its home centre, the same pull distance used
    on-map.
- **Directed travel**, for dispersers and floaters: up to `activity × walk × 3,600 s × 0.5` toward the current travel
  target.
- Travel time is therefore explicit. A disperser born 1.5 km outside needs game hours to days to reach the edge, and
  cannot appear in the valley the hour it is born.

**Hunger and thirst.**
- They are not frozen. They relax toward a sector equilibrium `n* = 0.25 + 0.35 × (1 − suitability × (1 − crowding))`
  with a 12 game-hour time constant (assumed).
- `crowding` is local density over sector capacity, 0–1.
- On entry, the animal carries its current values into the full on-map physiology.

**Mortality.**
- Off-map animals have the same hourly background hazard as on-map animals (`juvHazard` / `adultHazard`, with the same
  crowding and poor-health multipliers).
- Starvation and dehydration are represented by health: health falls at the on-map rate while `n* > 0.7`, and recovers
  as on-map otherwise. An animal dies when health reaches 0, with the cause recorded as starvation or dehydration,
  whichever need is higher.
- Age follows the on-map rule.
- **No predation term is added off-map.** Unmodelled predation is already part of the background hazard. This is
  conservative: it neither adds nor removes risk relative to on-map animals.

**Reproduction.**
- It uses the on-map rules unchanged: breeding season, receptivity (the same hunger and health thresholds, using the
  relaxed needs), gestation, litter size, weaning and maturity.
- Jackals breed only as the resident pair of a regional territory, with the same founder, natal, helper and dispersal
  rules as #28.
- Off-map young are full individuals, with their mother recorded.

**Records.** For on-map behaviour, failed-target memory and water memory are kept but ignored off-map. They expire by
time as usual.

## 5. Crossing: simulation-authoritative transit corridor (feasibility study)
### 5.1 Proposal
- A **transit corridor** `T = 24 m` wide just outside each edge, inside the 192 m terrain apron the renderer already
  draws.
- Positions in the corridor are real simulation positions. Only animals in a new `Transit` state may occupy them:
  - an entering animal walks from the corridor's outer line to inside the 6 m wall;
  - an exiting animal walks from the wall out across the corridor and becomes off-map when it reaches the outer line.
- Every other animal still treats the edge wall as before.
- Possessed animals never enter `Transit`.

### 5.2 What must change, and what was measured
| Subsystem | Today | Needed for the corridor | Evidence |
|---|---|---|---|
| Terrain height in the simulation (`Valley.heightFast`, a 4 m grid) | Clamped to the region. Outside, it returns the edge height | Extend the grid by `T` on every side: 1,488 m / 4 + 1 = 373 points per side instead of 361, about 6% more memory (≈ 556 KB vs 521 KB) | Probe, seeds 1, 7 and 21, points 10–30 m outside the edge: the clamped grid differs from the true terrain (`Valley.height`) by **7.7–8.5 m on average, up to 25.7 m**. Without the extension, an animal in the corridor would float above or sink below the rendered ridge |
| Grade (steering limit 0.95) | — | None. The corridor is walkable | True grade above 0.95 at 15 m outside the edge: 0.0–0.4% of points |
| Water depth | Uses `heightFast` | Correct once the grid is extended. The river leaves the map at the north and south edges | 8–11 of 1,680 corridor points are wet. Hares, which avoid water, will route around them by the existing rules |
| Vegetation, water and building grids (`Environment.cellIndex`) | Clamped to edge cells | Animals in `Transit` do not forage, drink or rest. They only travel | — |
| Spatial hash | Clamps indices, so outside items go into edge buckets; distances are exact | None | Code read (`packages/core/src/spatial.ts`) |
| `passable` / `terrainCost` | 6 m wall | Allow the corridor for `Transit` animals only, in their transit direction | — |
| Collision with buildings | No buildings near edges | None | — |
| Rendering (`AnimalView`) | Places animals using `valley.height` near the camera and `heightFast` far away | Correct once `heightFast` is extended. Draw `Transit` animals normally. The apron already shows the terrain | — |
| Selection and possession | Raycast against instances; possession of any rendered animal | `Transit` animals cannot be possessed. They are selectable for inspection | — |
| Sound | Positional events from simulation positions | None | — |
| Camera | Clamped 4..R−4 | None. The player cannot follow an animal into the ring. Off-map animals are shown in the UI as "beyond the valley" | — |
| Time advancement | The continuous sweep is ≤ 1 m per sample and bounded at 32 samples per tick | None. 24 m is crossed in a few ticks at every speed | — |
| Save/load and hash | Positions are numbers; the snapshot has no off-map fields | Save `offmap`, `transit`, the coarse position, regional territories and `migRng`. Extend the hash conditionally, so it is unchanged when the boundary is closed | — |

**Conclusion.** An inexpensive simulation-authoritative corridor is **feasible**.
- The one structural change is extending the height grid, which is cheap.
- The first commit of the migration PR will be a **corridor spike** with tests before any population logic:
  - terrain-height agreement inside the corridor;
  - a `Transit` walk-through at 1×, 10×, 100× and 1,000×;
  - save/load mid-transit;
  - no non-transit animal entering the corridor.
- If the spike fails any of these, I will stop and report the alternatives before falling back to anything visual.

### 5.3 Exit
- An open-boundary species may enter `Transit` outward only by movement:
  - a jackal whose movement target lies inside its own exclusive disc beyond the edge (straddling residents);
  - a disperser or floater whose travel direction crosses the edge.
- **There is no exit for fleeing.** Fleeing animals still meet the wall, because cornering is a separate question.
  Owner decision 1 asks whether flee may also exit.
- The exit is classified as an excursion if the animal's territory or home overlaps the outside, and as emigration
  otherwise.

### 5.4 Entry (no rescue rule)
An off-map animal enters only when **its own coarse movement** carries it across the edge line:
- a straddling resident ranging over its disc;
- a disperser travelling toward the valley.

It then walks in through the corridor. Entry never depends on:
- valley abundance;
- valley breeder vacancies;
- time since extinction;
- any target.

There is no code path from a valley count to an arrival. A unit test will assert that arrivals are identical in two
runs whose valley populations differ but whose off-map state is identical.

A jackal immigrant takes a valley breeder vacancy only through #28's ordinary floater rules after it has arrived.

## 6. Metrics (separate counters, saved)
**Per species:**
- local births, and deaths by cause;
- emigrations, excursion exits and returns, visits, immigrations, returns of former residents;
- off-map births and deaths by cause;
- off-map abundance;
- transit counts.

**Jackal territories**, by class:
- in-valley-centred;
- straddling;
- fully external.

**Reported:**
- **Resident persistence without newcomers**: founders and descendants of local mothers. This is reported separately
  from presence maintained or restored by migration.
- Permanent local extinction versus recolonisation.
- Jackal predator-days, split into residents, straddling-pair visitors and other visitors.
- Regional breeding pairs.
- Per-capita kills and total predation.
- Hare and chital survival.
- The edge-cornering share of kills (re-run of audit B3).
- Compute cost per simulated day.
- Peak on-map plus transit actor count.

**Conservation identity (test, every hour, every speed, across save/load):**

> on-map + transit + off-map + cumulative deaths = founders + cumulative births

## 7. Evaluation (unchanged structure)
- **A–E configurations:**
  - A: M2;
  - B: + memory;
  - C: + territories, closed, frozen at `a13837f` with B1 applied (C is re-frozen after B1 lands);
  - D: C + open boundary;
  - E: D with zero immigration.
- 60 paired seeds × 365 days, identical weather.
- **E keeps D's off-map simulation and `migRng` draws.** Off-map animals are simulated but never enter the valley; exits
  still occur. D and E are therefore paired on everything except inflow.
- **Sensitivity**, each a separate configuration and never a post-hoc retune:
  - off-map source size: ring width W ±50% (720 m / 2,160 m) and hare strip capacity ±50%;
  - connectivity ±50%;
  - jackal spacing 720 m and 1,200 m.

## 8. Pre-registered assumptions (experimental hypotheses, not established Indian wildlife parameters)
None of these will be changed after results are seen in order to improve survival. Changes require an owner decision
recorded before a re-run.

| Assumption | Value | Basis and uncertainty |
|---|---|---|
| Jackal exclusive spacing | 960 m (r = 480 m) | From #28 and stated as a modelling choice. Field home ranges span 0.1–35 km² (`docs/JACKAL_TERRITORIES.md`); no Indian estimate was found. **Uncertainty: very high.** The valley-scale choice sits at the small, human-influenced end of the range. Sensitivity 720 / 1,200 m |
| Ring width W | 1,440 m | Smallest width that holds fully external territories (§3). It bounds the regional population. **Uncertainty: structural.** Sensitivity ±50% |
| Initial regional occupancy | Each packed regional territory starts as a pair (0.75), a single adult (0.15) or vacant (0.10); helpers drawn as in the valley's `populate` | Assumed. Field studies report pairs holding territories for years, but no occupancy rate for a comparable landscape was found. **Uncertainty: high.** Its effect is checked through source-size sensitivity |
| Sector suitability | U(0.6, 1.0) × valley mean, drawn once per 120 m sector | Assumed. **Uncertainty: high** |
| Hare strip depth | 260 m | 2 × the model's hare home range. Assumed |
| Hare off-map density | Valley initial density (64 hares over the valley's walkable area) × suitability; capacity is the same density × strip area | Model-internal. No Indian *L. nigricollis* density was obtained; the Rollapadu census (Manakadan & Rahmani) exists but its figures were not read. **Uncertainty: very high.** Sensitivity ±50% |
| Off-map tortuosity (net displacement per metre walked) | 0.15 | Assumed. It sets ranging speed and therefore visit frequency |
| Need equilibrium off-map | `n* = 0.25 + 0.35 × (1 − suit × (1 − crowding))`, τ = 12 h | Assumed. Chosen so that a typical sector's equilibrium sits below the 0.6 hunger threshold, matching on-map fed animals |
| Jackal dispersal | Same helper age as #28. Direction uniform; travel continues until the animal joins or claims a territory, or dies | Field natal dispersal distances are 6.5–159 km (six animals; Potočnik et al. 2022, conference abstract via search). Many real dispersers would leave a 4.3 km landscape entirely. **The ring cannot represent that loss**, which biases it toward retention. This is stated, not corrected |
| Corridor width T | 24 m | Engineering choice inside the 192 m apron. No ecological effect intended |

Sources (found by search, not read in full):
- [Potočnik et al. 2022](https://air.uniud.it/retrieve/63f9b585-b940-48a5-9f54-1b7bdab3e2f0/Poto%c4%8dnik%20et%20al.%20%282022%29.pdf)
- [Lanszki et al. 2018](https://moorcroftlab.oeb.harvard.edu/resource/lanszkietal2018mammbiologypdf)
- [Manakadan & Rahmani](https://archive.org/download/biostor-151804/biostor-151804.pdf)

## 9. Implementation plan (after this revision is accepted)
1. **Corridor spike** (§5.2): height-grid extension, the `Transit` state and its tests. Stop and report if it fails.
2. **Off-map state:** the `offmap` flag, coarse positions, the regional territories (packing), `migRng`, the hourly
   coarse model, save/load, the conditional hash and the conservation test.
3. **Crossings:** exits by movement, entries by movement, classification and counters, and tests at four speeds.
4. **Configuration flags C, D and E**, plus sensitivity variants; the 60-seed evaluation; a report in Gate 2 format.

Hare refuges, other species, #12 and #22 are out of scope.

## 10. Decisions requested
1. **Flee exits.** Should a fleeing jackal or hare be allowed to exit through the corridor? Recommendation: **not in
   the first experiment.** Keep cornering as a measured outcome. Test flee-exit as a separate configuration only if you
   want it.
2. Accept `W = 1,440 m` and packing-based regional territories, with the corrected counts of about 2 straddling and 7
   external.
3. Accept the off-map coarse model in §4.
4. Accept the corridor spike as the first commit, with the stop-and-report condition.
