# Animal instance-upload A/B experiment (research only)

**Status:** opt-in experiment. No production change in default behavior, ecology, animal silhouettes, pose logic, or shadow casting.

The renderer already uses merged procedural animal geometry, seven `InstancedMesh` model batches, and GPU leg/head/wing animation (`AnimalView.ts`). The purpose is to test **instance-buffer update traffic**, not to falsely claim a reduction in existing draw calls or to migrate to skeletal animation.

## Variants

- **A / baseline (default):** Existing `AnimalView` marks full-capacity instance matrix, animation, and pose attributes dirty every frame.
- **B / active-range:** The identical `AnimalView` populates exactly the same arrays, but calls Three.js `clearUpdateRanges()` and `addUpdateRange()` for only `count` visible instances in each nonempty batch. Empty batches request no update.

URL: `?animalUploads=A` versus `?animalUploads=B`. The absent parameter selects A.

For comparable full-scene profiling use `?profile=1&animalUploads=A` and `?profile=1&animalUploads=B`, on the same seed, browser, viewport, graphics device, and initial settings. The existing profiler takes a fixed camera route, measures Low/Medium/High presets, Auto, and restart resource counts. Repeat runs and alternate A/B order to minimize thermal and compilation bias.

The profile JSON adds `animalUploadExperiment` and `presets[quality].animalUploads` with `frames`, `averageVisible`, `averageRequestedBytes`, and `totalDropped`. **Requested bytes estimate attributes marked dirty by our code, not actual PCIe traffic, bytes uploaded by the WebGL driver, or GPU memory use.** The baseline estimate omits empty batches that may not actually render. The observable acceptance metric remains reproducible p50/p95/p99 frame time and render CPU time on real hardware.

## Validation

- `npm run typecheck && npm test`
- `npm run test:e2e` to confirm default A behavior is unchanged.
- Test that A and B produce byte-identical active instance matrices and animation attributes, without mutating the authoritative simulation.
- Run fixed-preset profiles in A and B on real GPUs at 720p and 1080p; record the actual browser and viewport.
- Compare resource counts after repeated world restarts. A 30–60 minute soak can assess nonmonotonic heap/resource behavior.
- Repeat on integrated graphics and a mobile device when available.

The experiment currently **does not** implement frustum culling, projected-size LOD, shadow splitting, new geometry, WebGPU, or a simulation worker. Gemini's proposed `AnimalLodView` was not adopted because it did not use the actual `iAnim/iPose` shader contract, allocated/cloned matrices every frame, and did not implement a real shadow split.

**Promotion gate:** Do not merge based on lower estimated requested bytes alone. Require repeatable improvement in real-device rendering performance or another demonstrated benefit without regressions. If it fails to produce a meaningful improvement, keep the existing simple upload path. No production merge without project-owner approval.
