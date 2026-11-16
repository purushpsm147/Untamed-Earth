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


## Pre-registered statistical decision protocol (2026-11-16)

**Previous evidence:** five owner-supplied reports (AMD A=1, AMD B=2, NVIDIA A=1, NVIDIA B=1) show roughly 96% lower *requested update bytes*, but are insufficient for statistical claims about FPS or CPU savings. Do not treat ~1,500 sequential frames in one profile as independent replicates.

### Fast hardware runs

In the existing PR branch, build and preview normally, then open one of:

- A: `http://localhost:4173/?profile=1&uploadOnly=1&animalUploads=A`
- B: `http://localhost:4173/?profile=1&uploadOnly=1&animalUploads=B`

Choose **Enter the valley** with the **same seed** and a fresh world each time; keep the tab visible. High-only mode warms the scene for 4 seconds, flies the same existing camera route, downloads no measurements automatically (use the report download link), and skips Auto, synthetic load and restarts. It keeps default gameplay and the normal profiler unchanged.

On each GPU separately, collect **8 counterbalanced blocks**, four runs per block, using:

```text
Block 1: A B B A
Block 2: B A A B
Block 3: A B B A
Block 4: B A A B
Block 5: A B B A
Block 6: B A A B
Block 7: A B B A
Block 8: B A A B
```

Each letter is a fresh browser game instance and its own downloaded JSON. Close the prior game instance between runs. The block, not the frame, is the inferential replicate. This counterbalances monotonic warm-up/drift **within** blocks, although it cannot eliminate all thermal or background-load confounding. Keep AC power, Windows GPU selection, browser version, seed, world, viewport, DPR, and other workloads stable. Never interleave reports from different GPUs in the same folder.

Place only the new High-only reports into separate directories (e.g. `reports/amd` and `reports/nvidia`). Run:

```bash
node benchmarks/analyze-animal-upload-ab.mjs reports/amd
node benchmarks/analyze-animal-upload-ab.mjs reports/nvidia
```

The analyzer validates matching hardware, seed, viewport/DPR, 4-run ABBA or BAAB order, zero dropped animals, and <=5% variation in visible counts per block. It reports block-level percentage effects, seeded 95% percentile bootstrap intervals, and an exact two-sided sign-flip test. Those methods assume approximately independent blocks and a stable workload; they are **not** evidence of independence between frames.

### Locked decision rules (before collecting additional reports)

**Primary outcome:** mean **render CPU milliseconds** for the High preset. Report the point estimate and 95% confidence interval of block-level percentage improvement on *each GPU independently*. Do not pool AMD and NVIDIA. Treat p95 and p99 frame time, draw calls, and shader/parity checks as secondary safeguards.

- **Promote candidate for owner review**, not automatic merge: at least 8 blocks; >=5% point-estimate improvement in render CPU; bootstrap 95% interval excludes zero on the beneficial side; exact paired sign-flip p < 0.05; and no persistent (>10%) deterioration in p95/p99 across blocks or visual/performance regressions on the other GPU.
- **Reject and close this experimental PR:** the 95% upper confidence limit lies below the prespecified 5% practically worthwhile improvement on both GPUs, or a repeatable secondary regression outweighs any CPU gain.
- **Inconclusive:** collect at most **10 blocks per GPU**. If still inconclusive, archive/close rather than leave this PR open indefinitely. A different hypothesis requires a new preregistered protocol, not selective reruns or changing thresholds after inspecting outcomes.

All thresholds are engineering choices, not claims of physiological or scientific significance. The exact sign-flip test assumes exchangeability of A/B within controlled blocks; report sensitivity to device drift if it is visible. No hardware-side speedup is claimed until this protocol is completed.
