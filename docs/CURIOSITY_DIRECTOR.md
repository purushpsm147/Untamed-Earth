> **Living Valley V1 update (UX-01, PR #45).** The director below has been reworked into a documentary director:
> 0.5 s decision cadence, herd/group subjects, narrative continuity, side-on shot planning with line-of-sight checks,
> and fade cuts for distant subjects. Its public API and safety rules are unchanged. The current behaviour is
> described in `docs/handover/GAMEPLAY_HANDOVER.md` §2.1. This report is kept as the record of the original
> contribution.

# Untamed Earth — Gemini Argon Engineering Report

**Target Repository:** `https://github.com/purushpsm147/Untamed-Earth`  
**Integration Branch Inspected:** `ccr-4783fee0-8wvc41`  
**Scope:** Assignment A (Curiosity Director) & Assignment B (Procedural Visual Laboratory)

---
## 1. Environment & Verification Disclosure

Per `docs/ENGINEERING_RULEBOOK.md` and `docs/QUALITY_GATES.md`, all verification claims below distinguish strictly between what was executed and what could not be run in this environment:

- **Executed & Verified:**
  - Inspected `CLAUDE.md`, `docs/HANDOFF.md`, `docs/ENGINEERING_RULEBOOK.md`, `docs/QUALITY_GATES.md`, `docs/ARCHITECTURE.md`, `docs/INDEPENDENT_REVIEW.md`, `docs/spec/MASTER_PROMPT.md`, `docs/spec/ADDENDUM_III_LIVING_WORLDS.md`, and core/ecology/world/environment/render source files on `ccr-4783fee0-8wvc41`.
  - Transpiled and executed all 6 unit tests for `CuriosityDirector.ts` in Node.js `v18.20.4` (`node --test`), passing **6/6** in `180.86 ms`.
- **Not Executed (Environment Constraints):**
  - The sandbox VM has no outbound network access and no pre-installed `node_modules`, `tsc`, `vitest`, `playwright`, or WebGL2/GPU runtime. Consequently, `npm ci`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, live WebGL2 screenshot capture, and real-GPU FPS/p95 benchmarks could **not** be run here, and no GitHub branch push or pull request could be created directly from the sandbox.
  - No production files (`Game.ts`, `Simulation.ts`, or `apps/web/src/render/*`) were modified.

---

## 2. Assignment A — Curiosity Director

### 2.1 Architecture & Design (`CuriosityDirector.ts`)
`CuriosityDirector` is an independent, deterministic, read-only documentary camera director designed to live in `apps/web/src/curiosity/CuriosityDirector.ts` (or `packages/curiosity`).

- **Zero Simulation Mutation:** Consumes only `Readonly<WorldSnapshotView>` (`tick`, `animals`, `env`, `world`) and `SimEventLike` (`birth`, `death`, `kill`, `alarm`) from `Simulation.events`. Never spawns wildlife, alters animal behavior, or writes back to `Simulation`.
- **Multi-Factor Scoring:**
  $$\text{score} = \text{significance} \times \text{decay}(t) \times \text{proximity} \times \text{novelty} \times \text{cooldown} \times \text{visibility}$$
  - **Event significance:** `kill` (1.0) > `birth` (0.88) > `alarm` (0.72) > `death` (0.58).
  - **Behavior significance:** `Chase` (0.85) > `Stalk` (0.72) > `Flee` (0.68) > `SeekMate` (0.56) > `Drink` (0.48) > `Forage`/`Feed`/`SeekCarrion` (0.42).
  - **Visibility occlusion check:** Midpoint terrain height check between camera and candidate penalizes ridge-occluded targets (`0.45x` / `0.75x`).
- **Stability & Hysteresis:**
  - `minHoldSec` (default `8.0 s`) prevents rapid target thrashing.
  - `switchHysteresis` (default `1.25x`) requires a new candidate to beat the current subject by 25% after `minHoldSec`.
  - Immediate switch if the tracked animal dies or disappears (`!a.alive`).
  - `maxHoldSec` (default `22.0 s`) rotates to fresh subjects with `subjectCooldownSec` (`30.0 s`) and `eventTypeCooldownSec` (`10.0 s`).
- **Bounded Resource Use:**
  - `maxEventBuffer = 32` (evicts lowest effective-score event under flood).
  - `maxCandidates = 64` (deterministic strided sampling when animal count > 64).
  - `maxCooldownEntries = 128` (FIFO-bounded `Map` for cooldowns and novelty counts).
- **Camera Safety & Accessibility:**
  - Enforces `minClearanceM` (`2.2 m`) above `max(valley.height, valley.waterSurface + env.stage)`.
  - Pushes camera outside `Valley.buildings` footprints to prevent clipping.
  - `reducedMotion` mode lowers orbit angular velocity (`0.08 -> 0.025 rad/s`), softens damping, and provides `fadeAlpha` for gentle transitions.
  - `interrupt()` immediately yields control back to manual Observer, Follow, or Wildlife mode.

### 2.2 Integration Interface for Claude (`Game.ts`)
No edits were made to `Game.ts`. Recommended minimal integration in `apps/web/src/game/Game.ts`:

```ts
// 1. Subscribe once in Game constructor:
this.sim.events.on((e) => this.curiosity.pushEvent(e));

// 2. Toggle Curiosity Mode:
// On enter: this.curiosity.start({ x: cam.x, y: cam.y, z: cam.z, lookX, lookY, lookZ });
// On manual WASD/mouse/possess: this.curiosity.interrupt();

// 3. In updateCamera(dt) when curiosity.isActive():
const target = this.curiosity.update({
  tick: this.sim.tick,
  animals: this.sim.animals,
  env: this.sim.env,
  world: this.sim.valley,
}, dt);
const pose = this.curiosity.getPose();
camera.position.set(pose.x, pose.y, pose.z);
camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
```

### 2.3 Unit Test Results (`CuriosityDirector.test.ts`)
Executed via Node.js `v18.20.4` (`node --test`):
1. `deterministic selection for identical inputs` — **PASS**
2. `empty world fallback produces finite scenic pose` — **PASS**
3. `bounded buffers under event and animal saturation` (2,000 events + 1,500 animals) — **PASS** (`eventBufferSize <= 32`, `cooldownSize <= 128`, `noveltySize <= 128`)
4. `switching hysteresis and minHoldSec prevent jitter` — **PASS**
5. `immediate switch on subject death and non-mutating snapshot` (`Object.freeze` enforced) — **PASS**
6. `terrain/building clearance and manual interrupt` — **PASS**

---

## 3. Assignment B — Procedural Visual Laboratory

### 3.1 Static Evaluation of Existing Renderer (`apps/web/src/render/*`)
Based on source inspection of `ccr-4783fee0-8wvc41`:
1. **`TerrainView.ts`:** Uses 2-octave value noise in `#include <color_fragment>` with `uDry`/`uWet`, but lacks slope-based rock/scree blending and shoreline wetness gradients, making steep valley ridges and riverbanks share uniform soil shading.
2. **`GrassView.ts`:** 6-blade instanced tufts with quadratic wind sway and dry-straw tinting, but no view-dependent sun backlighting (subsurface translucency) or gust modulation, which flattens backlit meadows at dawn/golden hour.
3. **`WaterView.ts`:** Single `PlaneGeometry` with 2-layer value-noise finite-difference normals, Schlick Fresnel, and solar specular. Lacks crest/shore foam cues and higher-frequency wind-driven capillary ripples.
4. **`AnimalView.ts` & `animalGeo.ts`:** Clever zero-bone `InstancedMesh` vertex-shader animation (`aPart`, `aPivot`, `iAnim`) for legs, head, and wings (`MAX = 700`). However, torsos remain rigid during locomotion (no gait-coupled vertical bob or spine pitch), which makes fast chases look slightly stiff.
5. **`Engine.ts` & `quality.ts`:** Clean WebGL2 + ACESFilmic pipeline, but as noted in `docs/INDEPENDENT_REVIEW.md`, `Engine.dispose()` and `adapt()` upgrade recovery are currently owned by GPT-6's stabilization pass.

### 3.2 Visual Lab Prototype (`VisualLabScene.ts`)
`VisualLabScene.ts` is an isolated drop-in module (`apps/web/src/lab/VisualLabScene.ts`) that does not touch production render files:
- **5 Fixed-Seed Presets (`seed = 150`):** `valley_overview`, `river_dawn`, `forest_herd`, `ruins_golden_hour`, `monsoon_storm`.
- **Baseline vs. Enhanced A/B Toggle (`uEnhanced` uniform):** Allows instant side-by-side comparison without rebuilding geometries.
- **Zero Heavy Dependencies:** Pure procedural GLSL `onBeforeCompile` / `ShaderMaterial` extensions on Three.js primitives—zero external textures or network assets.

### 3.3 Benchmark Methodology & Known Limitations
- **Methodology:** Run each of the 5 presets in both `baseline` and `enhanced` modes for 180 frames after a 30-frame warmup, recording `performance.now()` p50/p95 frame times and `renderer.info.render` (`calls`, `triangles`) via `VisualLabHarness.getTelemetry(renderer)`, plus `captureFixedSeedPng()` for visual diffing.
- **Known Limitations:**
  - No live WebGL2 GPU numbers or PNG screenshots are attached because this sandbox lacks a browser/GPU runtime.
  - Slope rock blending in `createLabTerrainMaterial` uses vertex normals (`vLabWn`), so low-LOD distant chunks (`6` quads/side) will have smoother rock transitions than near chunks (`48` quads/side).
  - Shore foam in `createLabWaterMaterial` is currently wave-crest-based rather than depth-buffer-based to avoid an extra depth pre-pass on midrange mobile budgets.

---

## 4. Next Steps to Merge & Verify in Repo

1. Create feature branches off `ccr-4783fee0-8wvc41`:
   - `feat/curiosity-director`: add `CuriosityDirector.ts` and `CuriosityDirector.test.ts` under `apps/web/src/curiosity/`.
   - `feat/visual-lab`: add `VisualLabScene.ts` under `apps/web/src/lab/`.
2. Run the required quality-gate suite in a connected environment:
   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run build
   npm run test:e2e
   ```
3. Capture fixed-seed PNG baselines from `VisualLabHarness` on a real GPU device before proposing any production shader cherry-picks to GPT-6/Claude.
