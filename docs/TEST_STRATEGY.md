# Test strategy and automation checklist

The first implementation contains meaningful unit and one browser smoke suite, but **independent testing must not be conflated with Claude's original QA report**. This document specifies how to expand proof as the product grows.

## Test pyramid and required metadata
Each test artifact records commit SHA, exact scenario seed, time step, browser/OS/device/renderer, viewport/DPR, quality, expected behavior, measured values, run duration, and logs/traces. Tests are deterministic wherever possible. CI green means the configured tests passed, not that real-device GPU performance was proven.

### Unit: core/world/environment
- RNG exact reproducibility and resumable state; determinism even after save/restore.
- Spatial hash equality to brute-force on seeded cases; no O(n²) global per-tick operations.
- World generation stable positions, seam/edge heights at mixed LODs, biome distribution, no trees in water or buildings, river/terrain collision constraints.
- Weather/soil/vegetation/nutrients finite and physically plausible; different rain forcing produces identifiable state changes.
- Terrain worker delayed/out-of-order/stale response handling and cleanup.

### Ecology headless
- Baselines for 1, 10, 100 days across multiple seeds with valid entity IDs and state bounds.
- Births/deaths/predation/resource accounting; no unlimited biomass or resurrection.
- Hunger/thirst/cell resource consumption; no omniscient prey/predator detection.
- Parent/group relationships and possession continuity; follow/deer/release and snapshot equality.
- A/B experiment with identical initial snapshot and controlled differences; inspect observed trajectories, don't hardcode population stability.
- 1×/10×/100×/1000×: define and report requested vs achieved progression; numerical stepping is stable, never silently skip important state.

### Browser functional
- Boot, terrain ready, 4 biome traversal, free camera input, select/follow, possess deer, graze/drink/rest, release, experiment and stats, save/reload, quality changes, mute/music, pause/background tab, invalid seed/saves, graphics/context failures, resizing/touch layout.
- Repeat restart/new-world flow 20+ times, ensure no lingering listeners, workers or materials. Use Playwright traces/screenshots and diagnostics; test actual visible render, not just DOM.
- Time-budget stress and prolonged browser idle. Test error/recovery.
- Future Curiosity Mode: target selection, camera no clipping, event holds/cooldowns, interrupt, reduced motion; no ecology mutation.
- Future Social Lens: show actual relationships, retain after player control/save.
- World registry: optional modules truly isolated and lazy.
- Simulation Inspectors: on/off, rare/replay, no false system alerts, bounded nested rendering and abort.

### Visual regression
Fixed seeded camera checkpoints: daylight forest, dawn, rain and thunder, night, river, settlement, waste dump, wetland, animal close-up, low/high LOD seam. Capture screenshot at known viewport and stable time. Compare with saved baselines but manually review realism, lighting, size and animation. Do not rebaseline away defects. Subtitles/UI contrast and small screens.

### Performance and memory
Use fixed recorded camera paths and workloads (open meadow, dense forest, rapid flight, multiple animals, 100× fast-forward, quality toggles, worker fallback, repeated world restart). p50/p95/p99 frame times, FPS, simulator time, draw calls/triangles, chunk/entity counts, startup/download bytes and JS heap where available. Do not claim total RAM/VRAM from browser-only estimates. Record physical hardware make/model where available; software-rendered Playwright is *functional*, not performance proof.

For leaks, warm up scene, run identical loops 10–20 times, allow GC, compare persistent resource counts and heap trends; understand temporary caches. Monitor GPU resource destruction on `dispose()`. A single heap high-water mark is not sufficient.

## CI baseline
```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```
Unit test may take 100 seconds. CI should timeout gracefully and publish logs. Do not make exact GPU FPS a CI gate on shared runners. Use dedicated profiled hardware for real quality gates.

## Defect workflow
Create regression reproducer before fix if possible; severity, expected/actual, screenshots and trace; isolate cause; fix; rerun focused plus smoke; attach output; document in `docs/QA.md` and handoff. Passing tests after deleting them or lowering assertions is forbidden.

## Acceptance evidence and status language
`Code present` ≠ `Working in browser` ≠ `Hardware-validated`. A high-end visual goal remains an ambition until human and device evidence. Mark unsupported targets as unverified, not as failures or successes. Preserve full causal/ecological state across all graphics presets.
