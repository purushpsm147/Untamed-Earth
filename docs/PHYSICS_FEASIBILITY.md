# Physics feasibility: existing navigation vs Rapier

**Decision: do not adopt Rapier.** Keep the custom navigation. Close the one demonstrated correctness gap (animals walk
through tree trunks, rocks and logs) inside the existing analytic system, with the measured analytic approach below.

Baseline: integration `a0e08ba` (CI run 132 green). Branch `experiment/tech-validation-physics`. Environment for every
number here: Linux container, 4 logical CPUs (`os.cpus()` model reported in the JSON), Node 22.23 / V8 12.4, and
headless Chromium 153 for the browser probe. **No real-device measurement**; GitHub Actions runs the same harness in
quick mode only. Rapier `@dimforge/rapier3d-deterministic-compat@0.21.0` (and `rapier3d-compat@0.21.0` for size).

Evidence: [`evidence/tech-experiments/physics-feasibility.json`](evidence/tech-experiments/physics-feasibility.json)
(every scenario × mode, with repeats, replay and geometry checks),
[`physics-browser-probe.json`](evidence/tech-experiments/physics-browser-probe.json). Reproduce:
```
cd experiments/physics-rapier && npm install && cd ../..
node --expose-gc --import tsx experiments/physics-rapier/run.ts          # 3 seeds, 33 scenarios, 5 modes, 3 repeats (~6 min)
node experiments/physics-rapier/browser-probe.cjs                        # Chromium start-up and controller cost
```

## Phase A: the existing model and its limits
- **Collision model.** Animals are points with a clearance: building footprints are rotated rectangles
  (`Valley.blocked`, 0.6 m margin for movement, 0.9 m for steering look-ahead); the region edge is a wall; small mammals
  cannot enter water deeper than 0.3 m; grades above 0.95 uphill / 1.3 downhill are refused; steering looks ahead
  along eleven headings and follows walls (Living Valley V1).
- **Not obstacles at all:** tree trunks, snags, rocks, logs (drawn from the deterministic scatter) and vehicle wrecks,
  pylons and the bridge. Animals pass through them. This is the "irregular geometry where the footprint
  representation is insufficient" case, and the only correctness gap the scenarios found.
- **No path-finding**: local steering only (documented in SIMULATION.md).

## Phase B: the prototype
`experiments/physics-rapier/` (own `package.json`, outside the npm workspaces; nothing in production imports it).
Every mode runs the **production `Simulation`**: the test deer is given a fixed goal each tick exactly as the
navigation unit tests do, so the simulation's own steering, acceleration and turning produce each move. Modes differ
only in what happens to that move:

| Mode | What happens to the move |
|---|---|
| `existing` | nothing (production) |
| `rapier-validate` | rejected if a deer capsule (r 0.35 m, half-height 0.3 m) at the new position intersects a static collider |
| `rapier-kcc` | Rapier's kinematic character controller corrects it (slide, 43.5° climb limit matching the navigator, snap to ground, 0.3 m autostep) |
| `analytic-scatter` | rejected if it ends inside a trunk/rock/log circle (validation without a physics engine) |
| `analytic-slide` | pushed back out to the circle's edge, deer pairs separated (sliding without a physics engine, ~30 lines) |

**Same geometry, one world description.** Rapier colliders are built from `packages/worlds` only: the analytic
terrain as a 2 m heightfield (checked against `Valley.height`: ≤ 6 mm error), building footprints as rotated cuboids,
scatter solids as cylinders with the rendered models' radii. Building colliders agree with `Valley.blocked` on
**12,000 / 12,000** sample points (3 seeds). The simulation stays authoritative: Rapier never decides, never owns
time, and its corrected positions are written back into the simulation's own animal (IDs, RNG and save state are the
simulation's; the colliders can be rebuilt from saved state, so save/load needs nothing new).

## Phase C: results (3 seeds, 33 scenarios, 3 repeats each)

| Scenario type | existing | rapier-validate | rapier-kcc | analytic-slide |
|---|---|---|---|---|
| 1 Building footprints (7) | 7/7 reached · 10 trunk hits | 6/7 · **77 s stuck** | 7/7 · 0 | 7/7 · 0 |
| 2 Narrow passages (8) | 8/8 · 0 | 8/8 · 0 | 8/8 · 0 | 8/8 · 0 |
| 3 Traversable slopes (3) | 3/3 · 53 hits | 1/3 · **163 s stuck** | 3/3 · 0 | 3/3 · 0 |
| 3 Cliffs | none found: no reachable terrain steeper than 1.2 over 4 m in seeds 1–3 (20,000-point search); grade refusal is covered by `navigation.test.ts` | | | |
| 4 Wet → dry (3) | 3/3 · 0 | 3/3 · 0 | 3/3 · 0 | 3/3 · 0 |
| 4 River crossing (3) | 3/3 · 11 hits | 2/3 · 55 s stuck | 3/3 · 0 | 3/3 · 0 |
| 5 Herd escape, 60 s (3 herds) | 126 hits · 258 body overlaps | 0 · 127 overlaps · **192 s stuck** | 0 · 5 overlaps | 7 hits · 7 overlaps |
| 6 Repeated steering, 3 laps (3) | 2/3 · 126 hits | 1/3 · **1,061 s stuck** | 2/3 · **502 s stuck** (wedged) | **3/3** · 63 hits |
| 7 Dense forest line (3) | 3/3 · **215 hits** | 0/3 · 324 s stuck | 3/3 · 0 | 3/3 · 0 |

"Hits" = ticks a deer centre was within a trunk/rock/log radius + capsule radius; "body overlaps" = deer-pair ticks
closer than two capsule radii. **Building penetrations: 0 in every mode** (the existing navigator already handles
buildings). Path efficiency and time to destination are within 2% between existing, kcc and analytic-slide wherever
all three arrive. `analytic-scatter` behaves exactly like `rapier-validate` (same verdicts, ~1/2–1/4 of the cost).

**Cost** (per deer per tick, median over scenarios; the simulation's whole step is 0.037 ms here):

| | median | p95 | p99 | setup |
|---|---|---|---|---|
| rapier-validate | 0.004 ms | 0.10 ms | 0.18 ms | 47 ms to build ~460 colliders per scenario |
| rapier-kcc | **0.125 ms** (3.4× the entire simulation step) | 1.5 ms | 1.8 ms | 47 ms |
| analytic-slide | **0.007 ms** | 0.14 ms | 0.39 ms | none |
| Chromium probe, kcc on flat ground, 400 cylinders | 0.020 ms | 0.056 ms | 0.082 ms | import 45 ms + init 46 ms |

Start-up and memory (Node): import 72 ms, WASM init 88 ms, +10 MB RSS at init (external +5.6 MB); peak RSS during the
whole run 374 MB (dominated by 165 simulations, not Rapier). **Download: +1.65 MB gzip / +1.20 MB brotli** (WASM inlined
as base64), against ~180 kB gzip for the entire game today.

**Determinism.** With the deterministic build, all 165 runs replayed identically (same engine). Rapier's
deterministic build promises cross-platform bit-identical results, but the simulation itself is deterministic only per
JavaScript engine (transcendental `Math` differs between Node and Chromium; see SIMULATION.md), so Rapier would add no
cross-engine guarantee. The non-deterministic SIMD build was not adopted for that reason; its size is the same.

## What the evidence says
1. **The real problem is the obstacle model, not the collision solver.** Nothing in scenarios 1–7 needed a physics
   engine: buildings, gaps, slopes and banks are already correct; the failures are scatter solids the simulation does
   not know about.
2. **Validation-only integration is harmful** (Rapier or analytic): rejecting moves the steering does not understand
   turns trunk hits into long stalls (up to 1,061 s) and failed arrivals.
3. **Rapier's controller works where obstacles are sparse, but is not robust in clutter**: it wedged for 502 s in one
   loop, because steering keeps pushing into obstacles it cannot see; a collision solver cannot fix a decision layer
   that is blind to the obstacle.
4. **An analytic slide matches the controller's arrival rate (better in the loop) at ~1/18 of the cost**, with a
   residual of short grazes in dense clusters (63 hit-ticks in one loop, 7 in herds), and needs no dependency.
5. Distinguish the two layers: making steering *aware* of trunks (adding them to `terrainCost` so routes avoid them)
   improves route choice; a slide/collision step only stops interpenetration. Rapier offers only the second.

## Recommendation and acceptance criteria
**Retain custom navigation; no Rapier**, not even selectively for animals. Revisit only for a feature that needs real
dynamics (falling debris, vehicles, ragdolls), which is out of scope.

Next production change (separate PR, after review):
1. Add solid scatter (trunks, snags, rocks ≥ 0.8 scale, logs) to the simulation's obstacle model as circles in a
   per-chunk grid, read from the same deterministic scatter (the cache warm-up cost found in the population report
   must be paid at world creation or in the worker, not inside ticks).
2. Make steering aware of them (`terrainCost` returns Infinity inside a circle + clearance) and add the analytic slide
   as a last-resort resolution.
3. Acceptance: in this harness, trunk/rock/log hits ≤ 1% of today's in every scenario type; arrival rate and time to
   destination within 5% of today; 0 building penetrations; simulation tick cost at the natural population +≤ 10%;
   `npm run movement` snaps/jolts/pinned not worse; 100-day invariants, save/load and per-engine replay unchanged
   (state hashes will change, intentionally, and must be re-baselined in one reviewed commit).
4. Vehicle wrecks/pylons need real footprints in `packages/worlds` first (today they have none); measure separately.
