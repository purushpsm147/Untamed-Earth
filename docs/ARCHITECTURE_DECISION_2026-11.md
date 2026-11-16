# Architecture decision: physics, population scale and the next 12 months (2026-11)

Inputs: [PHYSICS_FEASIBILITY.md](PHYSICS_FEASIBILITY.md) (draft PR #17), [POPULATION_SCALING_REPORT.md](POPULATION_SCALING_REPORT.md)
(this branch), GPT-6's synthetic layout benchmarks (PR #15) and raycast baseline (PR #16). All measurements are from a
4-CPU Linux container (Node 22 / V8 12.4, headless Chromium 153). Real-hardware reruns are pending and listed below.

## Answers
1. **Rapier: no; keep custom navigation.** The current navigator has zero building penetrations in every scenario.
   Its only demonstrated gap is that trunks, rocks and logs aren't obstacles. Rapier's controller closes that gap, but
   it costs 3.4× the whole simulation step per animal, adds 1.65 MB gzip, and wedged in clutter. Validation-only use
   caused stalls of up to 1,061 s. A ~30-line analytic slide matched it at about 1/18 of the cost. Revisit only for
   features that need real dynamics (debris, vehicles), which are not planned.
2. **Practical maximum on the tested CPU: about 3,000 active animals** with every speed up to 100× within the game's
   simulation budget, or about 1,000 with comfortable headroom. At 1× alone, about 5,000 animals (tick latency is the
   limit). At 1000×, about 500 (the natural ~220 already use a third of a core).
3. **First bottleneck: perception neighbour enumeration** (O(N²) in a fixed valley), and it dominates under time
   acceleration. At 1× it's locomotion and steering, which grow linearly. Before population matters, a separate,
   population-independent latency problem appears: lazy scatter generation inside ticks (spikes up to 120 ms until warm).
4. **Selective changes, not an ECS.** A per-species spatial index, a data-structure change with no layout migration,
   halved high-population ticks with bit-identical results. GC is only 3–9% of tick time, and PR #15 found plain typed
   arrays beat bitECS on synthetic work. A formal ECS would rewrite a stable model for gains that only show above
   populations the ecosystem never reaches. Typed arrays are justified only for a hot field proven by profiling
   (candidates: position/heading for the steering loop at 1×).
5. **Not yet.** The real food web peaks at ~480 animals in this valley, and computation is fine there. Aggregate
   (population-level) simulation becomes necessary for larger or additional worlds, or for many valleys simulated at
   once off-screen. Design it before the second world, not now.
6. **Largest scale win without losing richness, in order:** (a) fix ecological stability, since jackals go extinct in
   every one-year run and chital starve, so the valley cannot even hold its starting population (before the Living Valley
   movement changes jackals survived but prey species collapsed, so predation success needs recalibrating, not reverting); (b) remove the
   in-tick scatter warm-up; (c) land the per-species index; (d) level-of-detail decisions: distant animals already
   decide less often, so extend that to steering cadence for animals far from the camera, measured against
   `npm run movement`.

## Recommended 12-month architecture

**Near term (next 1–3 months, evidence-backed):**
- Keep the headless TypeScript `Simulation` as the single authority, with vanilla Three.js and one `AudioContext`.
- Land the per-species spatial index after review. State is bit-identical, so no hash re-baseline is needed.
- Move scatter/perch generation out of ticks: build perches from the tree pass only, at load or in the Worker.
- Add trunks, rocks and logs to the analytic obstacle model, steering-aware plus slide (PHYSICS_FEASIBILITY.md criteria).
- Calibrate one-year ecological stability: predation success after the Living Valley herd/steering changes (3–13× lower),
  jackal water access, founder size, chital forage. Add a 365-day,
  three-seed CI-optional check.
- Keep the opt-in profiler and the scaling/parity benchmarks; rerun them on the Victus and a midrange phone.

**Medium term (3–9 months, conditional):**
- If profiling at the target population shows `move` dominating at 1×, steering LOD for animals beyond ~300 m of the
  camera (identity and needs preserved; trajectories coarser), with a parity/quality budget.
- Typed-array storage only for a profiled hot path, behind the same `Animal` API and the observation contract.
- A deterministic math module only if cross-browser replay or shared saves become a product requirement.

**Speculative (9–12 months, for additional worlds):**
- Individual ↔ aggregate population tiers per region (individuals near the player, cohort models elsewhere), with
  conservation tests (no untracked births/deaths when switching tiers).
- Simulation in a Worker if a world's tick exceeds the main-thread budget at 1× after the steps above.

## Acceptance criteria for the near-term work
| Change | Gate |
|---|---|
| Per-species index | 16/16 parity scenarios identical; unit + browser suites green; 10,000 / 100× median ≤ 0.5× baseline on the Victus |
| Scatter warm-up out of ticks | p99 tick at natural size in the first 5 game-minutes ≤ 5 ms (container) / ≤ 3 ms (Victus); no new startup stall > 1 s |
| Analytic scatter obstacles | Physics harness: trunk/rock/log hits ≤ 1% of today; arrival rate and time within 5%; natural-size tick +≤ 10%; movement report not worse |
| One-year stability | 3 seeds × 365 days: no species extinct; no unexplained starvation dominance; 100-day invariants unchanged; rule changes documented in SIMULATION.md |
| Real-hardware reruns | Victus and one phone: scaling table, physics probe, `?profile=1`; results kept separate from container/CI numbers |
