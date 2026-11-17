# Camera-aware animal visibility A/B — experimental

## Purpose

Untamed Earth already batches each animal model in one GPU-animated `InstancedMesh`. The current production `AnimalView.update()` includes all living animals inside a camera-distance radius even if they are behind the camera. This prototype asks whether a conservative visibility test can avoid the expensive **per-animal** pose, terrain-sampling, and instancing work without losing important shadows.

**No automatic merge is authorized.** This experiment is independent of PR #21 (partial attribute updates), which remains unmerged.

## Switches

- **A (default):** `?animalCulling=A` or no parameter. Existing radial-distance renderer behavior.
- **B (experiment):** `?animalCulling=B`. An animal within the original distance radius is kept when its conservative sphere intersects **either** the view camera frustum **or** the active directional shadow-camera frustum.
- When shadow rendering is disabled by the quality preset (e.g. Low), only the view camera is used. The currently selected animal is retained within the existing radius to avoid breaking selection/follow presentation.
- The same merged geometry, instance matrices, animation shaders, materials, and shadow settings are used in both variants. GPU upload trimming and geometric LOD are **not** part of this PR.

The visibility proxy is intentionally padded: roughly 5 m plus flood rise, placed using the cached heightfield, interpolated altitude, and a vertical offset. This favors false-positive retention over a vanished animal. The directional light shadow camera is refreshed *after* `Sky.update()` and *before* the renderer's shadow pass. All animals intersecting that shadow camera remain eligible to cast shadows, including animals behind the viewer.

**Limits:** A conservative proxy is not a rigorously proven bound for every future model/pose. Camera- or light-frustum visibility is not occlusion visibility. Off-screen shadow-only animals remain in their species' camera draw call because the current pipeline shares instances between both passes; that is safe but limits GPU savings. Carcasses and UI rings are not culled by this experiment. The existing 700-instance-per-model cap remains and any overflow is reported rather than hidden.

## Reproducible real-scene comparison

Run two builds of the same experimental branch, on the same hardware and seed:

- `http://localhost:4173/?profile=1&short=1&animalCulling=A`
- `http://localhost:4173/?profile=1&short=1&animalCulling=B`

Use the same browser, viewport, graphics preset, and world seed. Alternate A–B–A order on the AMD integrated GPU and RTX 3060. Compare **render CPU cost**, frame-time p50/p95/p99, draw calls, and triangles. The profile JSON adds `animalCullingExperiment` and, per preset, `animalCulling`: average candidates (inside original radial radius), skipped candidates (outside both relevant frusta), shadow-only retained animals, actual submitted instance count, overflow count, and average `AnimalView.update()` CPU milliseconds. The CPU figure excludes view/light-frustum preparation in `Engine.frame`; total render CPU cost captures that overhead.

**Do not claim performance gains based only on culled counts.** Extra frustum checks may cost more than they save for small populations; some shadow-only animals also keep camera draw work alive. All FPS values remain subject to display vsync, and WebGL GPU memory is not directly measured. CI SwiftShader results are for rendering correctness, not comparative hardware performance.

## Verification gates

1. `npm run typecheck`, `npm test`, `npm run build`, and Playwright smoke/reliability/documentary suites.
2. Unit tests for camera-facing, behind-camera, dynamically moved cameras, shadow-only casters, disabled shadows, and exact A/B instance-attribute parity when all candidates remain in the light frustum.
3. Browser smoke test for opt-in B, nonzero radial candidates, real culling, no simulation hash change while paused, and no capacity overflows.
4. Inspect documentary close-ups, panning, shadow continuity, selected/follow animal behavior, low/high graphics, water, and birds on actual hardware.
5. Resource lifecycle checks across repeated world restarts.

**Promotion gate:** A perceptible/meaningful benefit must be demonstrated with matched-seed repeated **real-hardware** A/B profiles and no disappearance, popping, shadow, selection, or determinism regressions. No production merge without explicit owner approval.
