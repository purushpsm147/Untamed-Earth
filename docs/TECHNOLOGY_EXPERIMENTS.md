# Technology experiments — physics, spatial queries and population scaling

**Scope:** independent headless experiments only. The existing TypeScript headless ecology remains authoritative. No Rapier, Cannon-es, Ammo.js, React Three Fiber, Howler, Miniplex or bitECS migration is authorized by these experiments.

**Starting point:** `ccr-4783fee0-8wvc41`, after the Living Valley behavioral and documentary work. See [Architecture](./ARCHITECTURE.md), [Simulation](./SIMULATION.md) and [Visual V4 no-go](./VISUAL_V4_ACCEPTANCE.md).

## Experiment A: physical collision and spatial queries

Compare the **existing analytic valley + custom steering** against:
1. `three-mesh-bvh` for static mesh ray casts and camera/obstacle occlusion;
2. `@dimforge/rapier3d-compat` for an isolated *kinematic* animal/camera collider, with no new simulation authority;
3. only if useful, a tiny baseline against `cannon-es`. Do not evaluate `ammo.js` unless soft bodies or Bullet-specific features become requirements.

**Benchmark cases:** dry flat terrain, slopes up to/refusing the same grade as the existing navigator, dry/wet shore, narrow gaps between ruins, five obstacles, 200+ static obstacles, camera rays through tree/rock scatter, multiple nearby kinematic bodies, and a seeded 10-minute chital escape path. Use identical geometry, footprint shapes and seeds. Do not confuse a swept-capsule collision test with animal foot-grounding, environmental biology or pathfinding.

**Record:** median/p95/p99 query or step times (Node and a real browser), heap/WASM memory, binary download size and startup cost, per-tick destination error, obstruction/penetration count, stuck/pinned count, and results across at least three seeds. Test whether a collider can run as a **pure proposal/check** beside the existing authority before any integration. If it changes steering, deterministic replay or save-state expectations, reject or isolate it.

**Adoption gate:** demonstrate a concrete navigation/visibility correctness benefit, with modest and measured CPU/memory overhead, and no regressions in 100-day ecology invariants or save/load. Declare exact baseline and tool versions, and whether deterministic WASM is in use. No full rigid-body world for ordinary grazing deer without evidence.

## Experiment B: ECS and population scaling

First run the unmodified `Simulation` at real starting and observed population sizes using the existing `benchmarks/sim-bench.ts`, `benchmarks/sim-report.ts` and `benchmarks/movement-report.ts`. Then implement **isolated** `Miniplex` and `bitECS` microbenchmarks over identical animal-state data. Replacing just the container with an ECS and calling it a faster ecology simulation is not an apples-to-apples result.

**Matrix:** 250 / 1,000 / 5,000 / 10,000 / 25,000 synthetic entities for data-oriented component queries and updates, clearly labeled *synthetic component benchmarks*. Separately measure **actual** `Simulation` populations obtained through supported save/snapshot factories or explicit stress fixtures, preserving identity and collision rules. Do not pass a synthetic population result off as a tested live ecosystem.

**Representative component operations:** spatial-hash index/rebuild, radius query, movement and orientation update, hunger/thirst/energy update, finding predator/prey species, herd/group membership updates, birth/death churn and serialization. Match semantics exactly. Collect 20+ warmup iterations and 100+ measured iterations with distributions, not a single best case. Use `process.memoryUsage` and any browser memory data with limitations stated. Measure startup/allocation overhead, hot-update costs, query latency, GC/long frames and bytes per entity.

**Correctness parity:** same seed and initial state; same set of entities/IDs and output state after each representative operation; no lost births/deaths; no accidentally shuffled order; no inferred performance scaling based only on entity count. Keep presentation on the versioned read-only `packages/ecology/src/observe.ts` contract.

**Adoption gate:** do **not** migrate the main `Simulation` if the existing 250-animal tick is already well under budget or if ECS gains only appear above an irrelevant scale. Prefer selective typed arrays for proven hot paths over replacing a stable ecology model. Any ECS migration must include save-format compatibility tests, per-engine deterministic replay, 100-day invariants, and production CPU measurements.

## Independent audio and framework decisions

- Stay with **vanilla Three.js** for renderer ownership. R3F would require a wholesale lifecycle rewrite while offering no intrinsic improvement in animal anatomy or grass silhouettes.
- Keep **one native Web Audio `AudioContext`** in the game's existing `AudioEngine`; use real `onAudioEvents` ecology events. Compare sample-management helpers such as Howler only if actual recorded sound assets make the custom layer hard to maintain.
- Physics is a collision/constraint question, **not** a substitute for procedural IK, asset quality or gait animation.
- A visible improvement must still pass visual and behavioral acceptance; green microbenchmarks alone do not imply better gameplay.

## Execution isolation

Use `experiment/tech-validation-*` branches from a pinned, green integration SHA. Write commands, reproducible fixture seeds, hardware/software environment labels, baseline numbers, dependency provenance, and artifacts to `docs/evidence/tech-experiments/`. Keep dependencies out of the production app unless an experiment is accepted. Create separate PRs for A and B, and do not merge either without explicit review.

**Recommended order:** (1) complete acceptance of Claude integration CI; (2) run a zero-dependency baseline profiler; (3) three-mesh-bvh and Rapier localized probes; (4) Miniplex/bitECS microbenchmarks; (5) actual high-population ecology parity tests; (6) adoption decision by measured win, not fashionable stack choice.
