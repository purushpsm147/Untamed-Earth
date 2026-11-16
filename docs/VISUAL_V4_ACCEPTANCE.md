# Visual V4 acceptance decision — 2026-11-16

**Outcome: NO-GO. V4 rejected, not merged.** This document closes the experimental V4 review without confusing a technically interesting rendering prototype with a production-quality visual breakthrough.

**Reviewed source:** draft [PR #13](https://github.com/purushpsm147/Untamed-Earth/pull/13), branch `experiment/gpt6-v4-realism` at `8f8182b8ba729cca53a16ad69d18c9dc253e83b6`, based on still-unmerged Gemini [PR #12](https://github.com/purushpsm147/Untamed-Earth/pull/12).

## Evidence and findings

- **Actual screenshots recovered:** All twelve CI captures from failed [GitHub Actions run 43811199796](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43811199796), `playwright-reports` artifact (7-day retention), representing both presets (`chital_closeup`, `riverbank_vista`), 720p/1080p, and matched baseline/V3/V4 modes. The screenshots were inspected, not inferred from code or synthetic images.
- **Visual assessment:** V4 replaces some segmented torso geometry with a skinned continuous envelope, but the animals remain awkwardly shaped or rigidly posed, and the shore, grass, canopy and lighting remain conspicuously stylized. It does not meet the stated documentary-naturalism quality bar. A shader/refinement alone is not an authored, proportionally correct `Axis axis` asset.
- **CI result:** 5/8 naturalism tests passed, 3 failed. The V3 720p/1080p 180-frame pacing capture timed out at 900 s in CPU-only SwiftShader. The V4 browser comparison logged `THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN`; screenshot completion alone does not excuse a WebGL geometry warning.
- **V4 synthetic 300-frame flat-ground walk:** 43.816765659476065 mm *maximum* stance-foot **pivot** vertical error; 40.28456515698098 mm p95; 20.170840514276034 mm maximum horizontal lock error and 17.968484206364543 mm p95. The vertical failure is almost 9× the original 5 mm contact tolerance. These are pivot readings, not measurements of a physically shaped hoof outsole.
- **V4 live slice diagnostics:** max vertical stance error 0.15858529021744605 m and max horizontal stance error 0.017199000000029326 m, across the eight staged animals. Performance values in the artifact were recorded in software-rendered Chromium and must **not** be presented as GPU FPS.
- **V3 note:** prior PR #12 acceptance failed at 5.936 mm vertical contact error. The subsequent sole-target refinement improved later instantaneous samples (the V4 CI JSON includes a 0.033 mm V3 sample) but the long-running V3 evidence still timed out and has not passed its full acceptance gate.

## Integration disposition

**Accepted into production:** None of PR #12 or PR #13's experimental graphics code. Their branches, commits, CI artifacts, geometry tests and learnings remain available for future targeted work. This decision does **not** roll back the existing production Three.js renderer or Claude's integration improvements.

**Not accepted:** second rendering stacks or wholesale V4 scene replacements, unmeasured `SkinnedMesh` or instancing optimizations, unsupported zero-skating/photorealism claims, and frame-rate claims derived from SwiftShader.

**Separate branch:** Gemini audio [PR #11](https://github.com/purushpsm147/Untamed-Earth/pull/11) remains unmerged: it creates a separate AudioContext and does not consume authoritative ecological alarm events. Its event-sound ideas may be reused only through the existing audio/observation boundary.

## V5 reopening criteria

1. Start from the **current integration branch**, not the unmerged PR #12 scene. Use a new narrowly scoped, opt-in renderer experiment.
2. Begin with an anatomically correct, clearly licensed `Axis axis` glTF/GLB model or a comprehensively reviewed sculpted topology; verify antlers, muzzle, joints and silhouette with clay side/front/three-quarter views.
3. Prove believable movement and resting in short unedited footage, with animated **sole** contact tracking on slopes and stance horizontal drift. Separate physical locomotion from presentation IK.
4. Compare actual matched seed/time/weather/camera baseline versus experimental screenshots at 720p/1080p. Human visual acceptance is mandatory.
5. Require clean shader/bounding geometry, repeatable typecheck/unit/build/browser tests, bounded disposal/leak behavior and real GPU profiling before proposing integration.

## Next workstream

Proceed with *independent* physics/spatial-query and high-population architecture benchmarks documented in [TECHNOLOGY_EXPERIMENTS.md](./TECHNOLOGY_EXPERIMENTS.md). No technology migration or graphics merge follows from this decision.

References: [PR #13 acceptance comment](https://github.com/purushpsm147/Untamed-Earth/pull/13), [V4 failed run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43811199796), [PR #12](https://github.com/purushpsm147/Untamed-Earth/pull/12), [Architecture](./ARCHITECTURE.md).
