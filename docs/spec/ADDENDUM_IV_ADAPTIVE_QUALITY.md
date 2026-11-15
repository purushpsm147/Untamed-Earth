# Addendum IV — Intelligent adaptive quality and performance governor

**Goal:** each machine sees the richest scene it can comfortably run, without changing the underlying living ecosystem. A high-end gaming desktop should get more naturalistic visual detail; basic laptops and mobile devices see cheaper geometry/shadows/resolution but the *same* ecology and rules.

## Initial capability assessment
Use available WebGL2/WebGPU feature checks, viewport/DPR, logical CPU concurrency and approximate device-memory hints, plus a short bounded startup benchmark. Browser APIs do not provide accurate full RAM, VRAM, GPU model or thermal headroom; do not infer definitive hardware capacity. Never exhaust a weak device just to run a benchmark. Save a conservative initial profile with manual correction.

## Governor design
- Choose a **target FPS** (30 / 60 and optional user settings), a **quality ceiling**, and Auto (default) or explicit manual preset.
- Track EMA/robust rolling p50/p95 frame time; separately time CPU simulation ticks, render work and browser frame spikes where measurable.
- Step down only after sustained overload; first reduce internal resolution, then distant geometry/foliage, shadow map, water/reflection/atmosphere complexity and cosmetic particles; eventually preset downshift.
- Step up conservatively with sustained headroom: first resolution recovery, then **recovery to a higher preset** up to the user's ceiling. Document cooldowns/hysteresis and anti-oscillation policy. An auto downgrade must not permanently lock scene fidelity.
- Ignore hidden-tab and major resume spikes for performance inference. Cap unneeded FPS and skip rendering in hidden tabs according to explicit sim-time policy.
- Avoid dynamically rebuilding all material or geometry every frame; profile allocations and disposal.
- Low/Medium/High/Ultra plus Auto, with accessible manual FPS cap, max quality, diagnostics and reduced motion. Persist preference.

## Resource budgets
Graphics allocation must reflect supported-device budget. Lazy-load environments, geometry, audio and textures, dispose unloaded resources, bound buffers and worker jobs, avoid always allocating Ultra-size effects on Low unless measured and justified. Degrade gracefully on WebGL context loss or unavailable storage. A hardware power/thermal guarantee is impossible; reduce avoidable load and report limits.

## Ecology invariant
Changing graphics must not alter seed, births/deaths, resource totals, population state, hunger, AI decisions or group relationships. Visual instancing and cosmetic ground foliage may thin; true plant biomass remains simulated. Distant simulation may use appropriately validated hierarchical updates; never delete animals merely to sustain FPS.

## Acceptance & QA
Controlled load tests must verify initial preset, downshift, restoration to higher preset after headroom, hysteresis under spikes, user override/ceiling, no changed ecology state, bounded memory after 20+ region visits/restarts, and context-loss path. Real midrange Android/iOS device tests are separate from desktop emulation. Log actual browser/device/renderer, viewport, p95 frame time, memory signals and before/after quality transitions. See `docs/INDEPENDENT_REVIEW.md` for observed current auto-upgrade gap and preallocation risk.
