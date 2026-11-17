# Valley boundary audit (issue #29, step 1)

Status: **read-only audit. No simulation behaviour was changed.**
- Branch: `audit/valley-boundary`, based on the PR #28 head `a13837f`, which is jackal territories on top of
  failed-target memory.
- The design that follows from this audit is in `docs/OPEN_BOUNDARY_DESIGN.md`.

## 1. Method
**Code inventory.** Every use of `REGION_SIZE` and every edge clamp in `packages/ecology`, `packages/worlds` and
`apps/web` (§2).

**Observer.** `benchmarks/ecology/boundary-audit.ts`, a read-only observer.
- It reads animal, territory and terrain state.
- It subscribes to the existing `kill` and `death` events.
- It never writes and never draws random numbers. `tests/unit/boundary-audit.test.ts` shows the state hash and both
  random streams are identical with the observer attached.

**Distance to edge.** `d = min(x, z, R − x, R − z)`, in bands of 0–8, 8–30, 30–60, 60–120, 120–240 and 240–720 m.
- Occupancy is compared with each band's share of **walkable** ground: dry, outside ruins, grade ≤ 0.95, and outside
  the 6 m hard wall.
- This is fairer than raw area. The outer 8 m is only 50% walkable, because of the wall at 6 m.

**Runs.** The PR #28 code, 30 seeds (1–30) × 365 game days at dt 2 (the 1,000× tick), plus shorter runs at the 1×,
10× and 100× ticks (§4).
- Raw per-seed output: `docs/evidence/boundary/audit-gate2-30-seeds.jsonl`.
- Aggregate: `docs/evidence/boundary/audit-gate2-30-seeds-summary.txt`.

```
npx tsx benchmarks/boundary-audit.ts 30 365 2 1 > audit.jsonl     # (split into parallel batches in practice)
python3 benchmarks/boundary-audit-summary.py audit.jsonl
```

## 2. What the code does at the edge (inventory)
| Where | Rule | Effect |
|---|---|---|
| `Simulation.passable` | `x < 6 ∨ z < 6 ∨ x > R−6 ∨ z > R−6` → impassable | **Hard wall 6 m inside every edge** for ground movement. Steering treats it like a building wall |
| `Simulation.terrainCost` | Same 6 m margin → `Infinity` | Path costs refuse the wall strip |
| Flight (`move`, airborne) | `x, z` clamped to 4..R−4 | Flyers may reach 4 m, **inside the ground wall** (finding B1) |
| `startWander` | Target clamped 10..R−10 | Wandering never aims outside |
| `startFlee` | 70 m flee target clamped 8..R−8 | A flee toward the edge is shortened to the wall |
| `spawn` | Position clamped 8..R−8 | Births happen inside the wall |
| `pickSite` (initial groups) | 70..R−70, and `habitatScore = 0` where `valley.sample().border > 0.05` | **No initial home within ~110 m of an edge**, except along the river corridor |
| Group fission home; territory disperser anchors; territory claim | 60.., 80..R−80, `inBounds(…, 60)` | Jackal territory centres are never within 60 m of an edge |
| `Environment` forage capacity | `cap × (1 − 0.6 × border)` | Up to 60% less forage on the border ridges |
| `Valley.sample` terrain | Border ridges rise 48–108 m toward the edge; they stay open along the river corridor | Edges are ridges, except where the river enters and leaves (north and south) |
| `drinkable`, controlled-input target | 6 m / 8 m margins | — |
| `SpatialHash` | Covers exactly `REGION_SIZE` | — |
| Renderer (`TerrainView`, `ScatterView`) | Draws a 2-chunk (192 m) apron of terrain beyond the region | The player sees ridges continue past the edge. Nothing lives there |
| Game camera | Clamped 4..R−4 | — |

**At the edge an animal is turned back, never removed.**
- No code path deletes, kills or transfers an animal for being near or at an edge. The audit saw 0 positions outside
  the region in 30 seed-years.
- The population is closed:
  - animals are created only by `populate()` at world creation and by `giveBirth`;
  - they are removed only by `kill()`, through the death causes (predation, starvation, dehydration, age, background,
    poison, experiment);
  - `nextId` only increases.

**Save, load and hash assume a closed population, implicitly.**
- `SimSnapshot` stores the living animals, carcasses, counters (`births`, `deaths`, `fertility`, `eaten`), history,
  groups, territories, `territoryStats` and both random states. It has no field for anything off-map, because there is
  nothing off-map.
- `stateHash()` mixes each living animal's id, x, z, hunger, health and behaviour; a sample of vegetation; the river
  stage; and both random states.
  - It does **not** include territories, carcasses or counters. A divergence confined to those would surface in the
    hash only once it changed an animal.
  - An open-boundary model must extend the hash to cover its off-map state. The extension must be conditional, so the
    closed configuration keeps #28's hashes.
- **Existing off-map or background abstractions.** There is exactly one: the hourly `background` hazard (`adultHazard`
  / `juvHazard`, scaled by crowding). Its comment says it stands for disease and "unmodelled predators". It removes
  animals. Nothing adds them.
  - There is no fauna pool, no immigration and no regional population.
  - The `EcoObserver` and diagnostics read only on-map state.

## 3. Findings (30 seeds × 365 days, 1,000× tick)
### B1. Defect: flyers strand in the 4–6 m strip and can die there
- The flight clamp (4 m) and the ground wall (6 m) disagree. A bird that lands between 4 m and 6 m from an edge cannot
  take a single ground step: every step it tries, even one moving inward, is still inside the impassable strip.
- Reproduction (seed 21):
  - Mynas fly toward a drinking point beside the river where it leaves the map at the south edge, at about
    (726, 11).
  - They land at the clamp (728, 4) and stay there `Seeking water` at zero speed, 6.6 m from the target.
  - Over 365 days, 24 mynas died of **dehydration** and 12 of starvation inside the 8 m band. The first bird was
    stranded on day 43.
- Pooled over 30 seeds: myna 948 and crow 187 animal-hours pinned (trying to move, < 0.05 m/s, < 8 m from the edge).
- This is a correctness bug in the closed edge, unrelated to migration. **Proposed:** a separate, small fix with a
  regression test (design §9.1). It is not fixed here because this step is read-only.

### B2. Every species avoids the outer 120 m, by construction
Occupancy relative to walkable area (1 = uniform):

| Species | 8–30 m | 30–60 m | 60–120 m | 120–240 m | 240–720 m |
|---|---|---|---|---|---|
| Chital | 0.34 | 0.34 | 0.51 | 0.83 | 1.50 |
| Boar | 0.29 | 0.29 | 0.54 | 0.90 | 1.47 |
| Jackal | 0.29 | 0.20 | 0.30 | 0.61 | 1.73 |
| Hare | 0.52 | 0.37 | 0.52 | 1.16 | 1.27 |

**Cause.** The cause is the setup, not behaviour at the wall:
- no initial home site lies within ~110 m of an edge;
- forage capacity is lower on the border ridges;
- wandering is pulled toward home.

The outer ring is treated as poor, ridge-top habitat. That is defensible for hares and chital, and less so for jackals.
**For migration:** flux through ridge sectors will be small for hares. The river corridor, where the generator keeps the
ridges open, is the natural connection.

### B3. Predation is concentrated against the wall (cornering)
Kill share ÷ occupancy share within 60 m of an edge, pooled, with a 95% seed bootstrap:

| Prey | Kills | Within 60 m: risk ratio [95% CI] | Share of all kills within 60 m |
|---|---|---|---|
| Chital | 1,474 | **4.11** [3.49–4.84] | ≈ 20% |
| Hare | 5,951 | **2.21** [1.55–3.41] | ≈ 13% |
| Boar | 2,147 | **1.61** [1.20–2.02] | ≈ 7% |

**The mechanism is visible in the flee data.**
- 3.5% of hare flee episodes and 2.0% of chital flee episodes had their 70 m target shortened by the edge clamp.
- 4.4% of hare flee episodes and 2.6% of chital flee episodes ended within 30 m of the edge.

A fleeing animal runs into the wall and is caught there. Where the land beyond the edge is open, a real animal would
keep running. For hares, about one kill in eight happens in this artificial corner. This is part of the hare predation
problem from Gate 2, and it is an **artefact of the closed edge**, not of hunting rules.

### B4. Jackal territories are already truncated by the edge
Over 19,984 territory-days:
- Centres average **239 m** from the nearest edge (minimum 62 m, where the claim rule stops them).
- **93%** of territory-days have an exclusive disc (radius 480 m) that crosses the edge.
- On average **29%** of each disc lies outside the map, and only **69%** of each disc is walkable valley ground.

In other words, the closed valley holds territories whose geometry already extends beyond it, but nothing beyond the
edge can be used, defended, inherited or supply a breeder. This supports the owner's point, and it is the basis of the
straddling-territory design (design §3).

### B5. Edge contact is rare for ground animals, and no animal is lost at the edge
- Contact time within 8 m of the edge is ≤ 0.05% of animal-hours for ground species, and ≤ 0.33% for birds.
- Ground animals were essentially never pinned: chital 4.5 h in 10 million animal-hours, and 0 for boar, jackal and
  hare.
- Deaths per band follow occupancy, apart from B1 and the cornering in B3.

## 4. Speed check (1×, 10×, 100× ticks)
| Tick (speed) | Seeds × days | Out of region | Ground pinned h | Hare+chital flee targets clamped | Prey kills within 60 m |
|---|---|---|---|---|---|
| 0.1 s (1×) | 3 × 4 | 0 | 0 | 55 / 2,335 (2.4%) | 2 / 33 |
| 0.25 s (10×) | 3 × 30 | 0 | 0.4 | 507 / 17,646 (2.9%) | 14 / 154 (9%) |
| 1 s (100×) | 3 × 120 | 0 | 1.9 | 1,437 / 69,104 (2.1%) | 55 / 535 (10%) |
| 2 s (1,000×) | 30 × 365 | 0 | 4.5 | 29,907 / 1,101,284 (2.7%) | ≈ 14% (§3) |

The edge rules behave the same at every speed:
- no animal leaves the region;
- ground animals are almost never pinned;
- 2–3% of prey flee episodes are shortened by the wall;
- about a tenth of prey kills fall within 60 m of an edge, where prey spend about 5% of their time.

B1 did not appear in the short runs, which are too short and use seeds 1–3; it needs a bird to land at the clamp. Raw
data: `docs/evidence/boundary/audit-speed-x{1,10,100}.jsonl`.

## 5. Frozen baseline (PR #28, for configuration C)
- **Code:** `gate2/jackal-territories` at `a13837f`, which is PR #28's head. Its base is PR #27,
  `fix/failed-target-memory`.
- **60-seed evidence:**
  - `docs/evidence/ecology/gate2-summary-60-seeds.json` and `gate2-analysis.txt`, on the PR #28 branch;
  - raw per-day runs at `experiment/ecology-stability:docs/evidence/ecology/gate2/` (commit `32df5d6`).
- **Reproduction:** for each configuration's checkout, `node --import tsx benchmarks/ecology-diagnostics.ts --days 365
  --seeds 1,…,60 --dt 2 --out <file>`. Then run `GATE2_DATA=<dir> python3 benchmarks/ecology-gate2-analysis.py`.
- **State-hash checkpoints** at `a13837f` (`node --import tsx benchmarks/ecology-hashes.ts --seeds 1,2,3 --days
  30,120,365 --dt 2`):

```
seed 1: 247798275/496149708/2797566479
seed 2: 968829163/366674588/3950749006
seed 3: 885610738/865767361/4228589442
(state hash after game day 30 / 120 / 365, dt 2)
```

An open-boundary implementation with the boundary **disabled** must reproduce these hashes exactly.

## 6. Answers to the issue #29 audit questions
| Question | Answer |
|---|---|
| Clip, turn, disappear or die at an edge? | **Turn.** A 6 m wall that steering avoids, with targets clamped inside it. Nothing disappears. Death at the edge occurs only through B1, birds stranded in the strip, and through ordinary predation, which is concentrated there by cornering (B3) |
| Group and territory behaviour at edges | Groups never home near an edge (B2). Jackal territory discs cross the edge on 93% of days, with 29% of each disc unusable (B4) |
| Do hash and save/load assume a closed population? | Implicitly yes: there is no off-map state to store. The hash omits territories and counters (§2) |
| Existing off-map abstractions | Only the background hazard, which removes animals and adds none. No pools, no immigration |
| #28 baseline frozen | §5 |
