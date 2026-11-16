# V4 naturalism pilot — implementation checkpoint (NOT acceptance)

**Branch**: `experiment/gpt6-v4-realism`, based on PR #12 `experiment/gemini-natural-riverbank`. Review as [draft PR #13](https://github.com/purushpsm147/Untamed-Earth/pull/13).

## Route and controlled comparison

- `/?slice=1&mode=baseline`: unchanged production-equivalent baseline.
- `/?slice=1&mode=naturalistic`: existing V3 naturalistic path (default).
- `/?slice=1&mode=naturalistic&variant=v4`: V4 experimental skinned-chital pilot **inside the same scene and WebGL renderer**. The original stage layout and camera modes remain available.
- `/?slice=1&mode=baseline&variant=v4`: exact baseline even when the V4 controller exists.

The opt-in variant is visual only. This is still a staged fixed-seed showcase, not emergent wildlife behavior. This pilot does not alter authoritative ecology or production renderer.

## What was implemented

1. A separate experimental `ChitalPrototypeV4.ts`: joined lofted torso/neck/head, eight-bone skinned mesh with explicit bind matrices, end caps and welded rings, body-space coat shader with ascending-edge `smoothstep` expressions, attached anatomical details, and explicit `Skeleton.dispose()`.
2. A new rig variant in the existing `Slice1NaturalismController`: retains original V3 exports/controller and the baseline renderer. Uses the staged herd identities and terrain-height callback. V4 maps the existing +X forward staging axis to its own +Z model axis.
3. Per-rig actual world-space stance target error diagnostics in XZ as well as vertical pivot-versus-terrain error. **These are probes, not evidence of zero skating**.
4. V3 experimental IK refinement against the **actual hoof-sole world marker** rather than just the ankle target. The original acceptance threshold of <5mm is preserved.
5. Playwright test coverage for closed indexed torso edge topology, required `aBodyPos` shader attributes, valid `smoothstep` literals, same-context renderer A/B, 720p/1080p screenshots, WebGL error capture and diagnostic JSON.

## Deliberately NOT imported from the Gemini proposal

The submitted standalone V4 `NaturalRiverbankLab.ts` creates another complete scene and renderer architecture, removes exports required by the current slice mount, and contains a guaranteed GLSL compile error (`flowUv1.z` where `flowUv1` is a `vec2`). We did **not** replace the live V3 scene or its native water shader with it. Likewise, the full proposed vegetation kit is not yet accepted or integrated. These remain candidates after actual comparison.

## Known limitations / open acceptance blockers

- V4 foot geometry, skin bind, behavior, and shader compilation are **unverified** until CI and screenshot artifacts are inspected.
- The V4 pose mapper uses an upright idle representation for `rest`; this is **not** a lying pose. Claude's authoritative observer contract is the appropriate future source.
- V4 slope pitch/roll is not equivalent to V3's two-axis terrain alignment.
- V4 foot errors refer to a pivot marker, not yet a separately evaluated shaped hoof sole; horizontal lock must be sampled over 300+ true movement frames.
- The staged showcase has mostly fixed world coordinates, so displacement-based gait phase does not substitute for true driven locomotion.
- No claim of a visual breakthrough, watertight all-mesh animal (only loft topology is tested), 2.5mm grounding, zero skating, photorealism, measured V4 GPU FPS, or hardware readiness is made.
- No field audio, grass/tree rendering overhaul, extra V4 water shader, or production change is part of this initial safe pilot.

## How to test

```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npx playwright test --project=naturalism --project=naturalism-v3 --project=naturalism-v4
```

SwiftShader screenshot artifacts from CI should be reviewed **visually** and downloaded before declaring any visual benefit. Its frame pacing is CPU software rendering, not Radeon/RTX GPU performance. The pre-existing V3 test is retained with its original strict 5mm threshold; failures must be fixed, not ignored.

Next: resolve any CI failures; inspect captured V3/V4/baseline images; update camera/morphology only based on observations; then investigate an ecotone vegetation experiment and run real hardware profiling. **Do not merge without user approval.**
