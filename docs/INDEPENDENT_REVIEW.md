# Independent engineering review — static inspection (2026-11-15)

**Scope:** GitHub branch `ccr-4783fee0-8wvc41`, commit `14e57324832b7b74c79f3b6a64feb44b5ddc13a4`. Read repository tree, key simulation/render/gameplay source, tests, and current docs using the GitHub connector. **Not a runtime audit**: reviewer could not run npm, render frames, listen to audio, or profile real hardware. Do not report these findings as measured failures.

## Positive evidence
- Simulation is packaged separately from Three.js rendering; `Simulation` is headless and seeded.
- Four connected biomes are implemented as deterministic terrain; renderer streams terrain and uses instanced geometry.
- Real animal state, needs, food web, reproduction, predation and snapshot functions are present, not simply aesthetic particle motion.
- Gameplay has observer, deer possession and experiment pathways; presence of genuine unit and Playwright tests.
- `docs/QA.md` explicitly distinguishes software Chromium from real GPU measurements, and `docs/ROADMAP.md` labels untested and unfinished features. This is good engineering disclosure.

## Findings / priorities

### P1 — Incomplete render-object teardown on restart: likely resource retention
Evidence: `apps/web/src/render/Engine.ts` allocates `Sky`, `GrassView`, `WaterView`, `AnimalView`, `WeatherFx`, and a landmark mesh (constructor approximately lines 26–72), but `Engine.dispose()` (approximately lines 209–213) only disposes terrain, scatter, and the renderer. Those objects have BufferGeometry/Material allocations; `GrassView`, `WaterView`, `AnimalView`, `WeatherFx`, and `Sky` do not expose corresponding teardown in inspected code. `apps/web/src/main.ts` calls `game?.dispose()` on restart. In Three.js, renderer disposal is not a substitute for disposing application-owned geometry/materials. **Next:** implement idempotent `dispose()` for each owner, dispose shared resources exactly once, and add repeated start/reset test + object-count/heap trend diagnostics. Confirm with actual browser profiler.

### P1 — Auto-quality degradation lacks a return path to a *higher preset*
Evidence: `apps/web/src/render/Engine.ts`, `adapt()` around lines 136–170, lowers resolution, then steps down QUALITY_ORDER; recovery only raises `resScale` toward 1, never increments the preset after a downgrade. On an initially High desktop scene that becomes temporarily heavy, the game may stay Medium/Low indefinitely even with ample headroom. **Next:** preserve user-selected quality ceiling and safe initial cap, implement symmetric upgrade with sustained headroom/cooldowns; add deterministic controller tests and trace-based browser verification. Distinguish quality target from actual hardware suitability.

### P2 — Low preset preallocates Ultra-size buffers
Evidence: `Engine.ts` constructor creates `new GrassView(..., QUALITY.ultra.grassCount)` and `new WeatherFx(QUALITY.ultra.rain)` before `applyQuality()`. The draw count is subsequently reduced, but allocated buffers remain at Ultra capacity even on Low. This may be acceptable in absolute bytes, but conflicts with strict memory-budget intent until measured. **Next:** budget initialization, growth strategy, and measurement on low-memory devices.

### P2 — Terrain Worker responses need stale-request validation
Evidence: `apps/web/src/render/TerrainView.ts` updates chunks based on response location and `res`, then resets `pending` without checking whether the response is still current (`apply` around lines 84–109). Camera movement and LOD changes can supersede in-flight requests, producing temporary incorrect LOD and avoidable rebuilding. **Next:** request IDs/generations and wanted-LOD checks, stress test rapid camera flight with delayed/out-of-order responses. Avoid treating this as a confirmed severe crash until reproduced.

### P2 — High-speed simulation drops accumulated work
Evidence: `Game.ts` around lines 484–500 caps simulation processing to 9ms per rendering frame and zeroes the backlog if too large. UI reports achieved simulation rate, which is honest; however requested 1000× time is *not* guaranteed, and evolution becomes hardware/performance dependent. **Next:** explicitly document wall-clock vs achieved simulation time, test slow devices, ensure no silent temporal jumps; consider headless fast-forward or bounded-worker processing for long experiments.

### P2 — Narrow browser and device QA
Evidence: one `tests/e2e/smoke.spec.ts` exercises boot, mode switch, animal count, experiment, saving and reload; it does not validate movement paths, context loss, repeated restarts, visual baselines, long-run browser memory, reduced-motion, touch, gamepad, or real GPU. `playwright.config.ts` configures Chromium SwiftShader; `docs/QA.md` acknowledges limitations. **Next:** add targeted scenario tests and physical-device evidence before declaring supported performance.

### P3 — Accessibility issue in mobile HTML viewport
Evidence: `apps/web/index.html` contains `maximum-scale=1, user-scalable=no`. This can block pinch-to-zoom for UI and impacts accessibility. **Next:** remove disabling of zoom, ensure UI adapts and game gestures remain scoped to canvas.

### P3 — Realism and content scope must remain separate
Evidence: current fauna uses procedural geometric models and compressed simulation physiology (see `docs/SIMULATION.md`); photorealism and ecological calibration should remain goals, not completed status. Future space, Eden, prehistoric, nuclear environments, social lens, and recursive alien gag are not part of current code.

## Review verdict
**Promising functional architecture and substantial proof-of-concept; not yet independently release-verified.** Priority is to prove resource lifecycle, adaptive recovery, browser robustness and true hardware performance before adding world packs. This document does not override the code's observed state or the project's own QA; each concern needs a minimal reproducer, test, fix, and rerun.

## Required follow-up evidence
For each P1/P2 issue: exact revision, reproduction seed and steps, before/after instrumentation, test added, tests actually run, and any residual uncertainty. Attach screenshots/traces for rendering bugs; preserve measured device specs for performance claims.