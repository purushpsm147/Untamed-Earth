# Visual handover audit — Reclaimed Valley naturalism

**Author:** Claude (Graphics and Animation Lead), 2026-11-24. **Director:** ChatGPT.
**Audited base:** integration branch `ccr-4783fee0-8wvc41` at `3a0e7f9` (PR #33 merge). Work branch:
`claude/reclaimed-valley-naturalism-erqqqu`.
**Method:** every claim below was checked against git objects, GitHub PR/Actions metadata or images opened during this
audit. Where something could not be checked it says so. No GPU was attached to this session: every render produced here is
**SwiftShader (CPU)** in headless Chromium.

Baseline verification on this branch before any change (container, Node 22, 4 vCPU):
`npm ci` ok · `npm run typecheck` ok · `npx vitest run` **22 files, 132 tests passed** (229 s).

---

## 1. What exists and where (recoverability)

| Item | Location | Status | Recoverable? |
|---|---|---|---|
| Production renderer (Three.js r187, WebGL2) | `apps/web/src/render/*` on integration | Shipping | Yes — authoritative baseline |
| Visual Lab (Gemini + GPT-6) | PR #7, branch `experiment/gemini-visual-lab` @ `2cf92da`; `apps/web/src/lab/VisualLabScene.ts` (1 670 lines) | **Closed, not merged** | Yes (branch exists). Review: `docs/VISUAL_LAB_REVIEW.md` |
| Natural riverbank + articulated chital (Gemini V1→V3, GPT-6 wiring) | PR #12, branch `experiment/gemini-natural-riverbank` @ `582952b`; `apps/web/src/lab/NaturalRiverbankScene.ts` (1 565), `lab/ChitalPrototype.ts` (837), `experiments/naturalism/NaturalRiverbankLab.ts` (756), `Slice1NaturalismMount.ts` (156); doc `docs/NATURALISM_EXPERIMENT.md` | **Open, not merged**, conflicts with integration | Yes for the head. See §1.1 for lost commits |
| PR #12 commits cited in its own comments (`1606884`, `ad2fa7f`, `b140d1f`, `ad00344`, `1c0838a`, `e748634`; also `dbef846`, `5baf592`) | Not on any branch. The branch was **rebuilt from a fresh base on 2026-11-17** (`e71115d`…`582952b`), orphaning them | Orphaned | `ad00344` (and its ancestors `1606884`…`1c0838a`) **fetched by SHA** and pinned locally as tag `recovered/pr12-ad00344` (not pushed). `dbef846`, `5baf592` not yet tried. GitHub may garbage-collect orphans — **owner action: push a tag to pin them** |
| V4 skinned chital pilot (GPT-6) | PR #13, branch `experiment/gpt6-v4-realism` @ `8f8182b`; `ChitalPrototypeV4.ts` (998), `RiparianVegetationKitV4.ts` (505) | **Rejected (NO-GO)**, closed | Branch yes; decision `docs/VISUAL_V4_ACCEPTANCE.md` |
| V4 CI screenshots (run 43811199796) | Actions artifact, 7-day retention | **Expired** — artifact list now empty | **No** (only the text summary in `VISUAL_V4_ACCEPTANCE.md`) |
| PR #12 last green CI captures (run 44099810345, head `582952b`) | Artifact `14337402898` (expires 2026-11-24 14:39 UTC) | Downloaded today, digest `sha256:05c34b34…85c2` matches GitHub | **Yes — archived** as JPEG in `docs/handover/evidence/recovered-pr12-run44099810345/` (14 images + 2 metrics JSON) |
| PR #12 V1 A/B composite | `docs/evidence/pr12-riverbank-chital-ab-swiftshader.jpg` | Committed on integration (`e1303f9`) | Yes |
| Visual Lab A/B composites | `docs/evidence/visual-lab-ab-{forest_herd,river_dawn}.jpg` | Committed | Yes |
| Animal frustum/shadow culling A/B (GPT-6) | PR #22, `experiment/animal-frustum-shadow-ab-gpt6-20261116` @ `55d0f49` (Engine.ts +12, `docs/ANIMAL_FRUSTUM_AB.md`) | Open draft | Yes; perf-only, untouched here |
| Production pose work | `render/animalPose.ts`, `AnimalView.ts` (folded-leg lying, blended head/amp, distance-driven gait phase) | Merged (`46e5e80`) | Yes |
| Dawn/dusk lighting | `render/Sky.ts` twilight ambient curve, exposure adaptation | Merged (`1695c09`), evidence `docs/evidence/dawn-dusk-before-after.jpg` | Yes |
| Adaptive quality | `render/quality.ts`, `render/qualityGovernor.ts` (trial-and-undo governor) | Merged (#3, `c86a691`, `263e584`) | Yes |
| Renderer lifecycle | `render/Engine.ts` `acquireRenderer` (one WebGLRenderer per canvas) + every view's `dispose()`; leak test `tests/e2e/reliability.spec.ts` | Merged (#2) | Yes |
| Real-GPU profiles | `docs/evidence/profile-hp-victus16-{radeon-vega8-run1,run2,rtx3060-laptop}.json` | Committed | Yes — the **only** real-GPU data in the project; all presets vsync-capped at 144 Hz, so they prove headroom, not cost |
| Documentary scenario | `/?scenario=documentary`, `apps/web/src/scenario/documentary.ts`, video produced by `npm run documentary` (not committed) | Merged | Yes |
| Audio soundscape | PR #11 | Out of scope (audio) | — |

### 1.1 Data-integrity notes
- PR #12 comments describe fixes (hero facing camera, `SeekWater` ≠ drinking, frontal-visibility test) that are **not in
  the current PR #12 head**. The head's CI was green, but it is green on a *different* code set from the comments.
- PR #12's V3 report (recovered) shows `heroPitchRad: 0.4` (the hero deer body is pitched 23°) and the 5 mm hoof gate is
  measured at **pivot markers on staged, mostly stationary animals**, not on a moving sole. It was passing at `3.2e-5 m`,
  which says the IK solves to the marker, not that feet look planted.
- Frame times in every PR #7/#12/#13 report are SwiftShader. PR #12 V3 720p: p50 571–771 ms. PR #12 comment claims of
  "RTX 3060 p50 3.2 ms" have **no artifact** and must be ignored.

---

## 2. Reusable work (what to keep)

| Asset | Why it is worth keeping | Caveat |
|---|---|---|
| Production `Engine` lifecycle (`acquireRenderer`, per-view `dispose`, `renderLists.dispose`) | Measured: identical WebGL object counts across 4–6 restarts | Any new view must follow it; shadow `customDepthMaterial`s and data textures must be disposed too |
| Production `TerrainView` streaming + worker + LOD | Solid, tested; vertex data already carries a "grassy" alpha channel | Material is a plain `MeshStandardMaterial` patched with `onBeforeCompile` — a natural extension point |
| Production `QualityGovernor` | Verified downgrade and recovery on real hardware | Any new cost must be expressible as preset fields so the governor can shed it |
| Read-only observation contract (`packages/ecology/src/observe.ts`: `behaviorFamily`, `gaitOf`, `motionView`) | The single agreed source for animation state | Must not be bypassed by reading `a.beh` codes (PR #12 did) |
| `animalPose.ts` blending model (lie ramp, head target smoothing) | Unit-tested, deterministic | Needs extending to graze/drink/alert layers and a real lying skeleton pose |
| Distance-driven gait phase (`AnimalView.update`) | Correct principle: phase from distance, not time | Single stride length per species class; no per-gait duty factor |
| PR #12 water depth idea (Beer–Lambert absorption from bank distance) | Right physical model for shallow banks | Its implementation baked an analytic map for one staged scene only |
| PR #12 V3 pelage anatomy notes (white bib, dorsal stripe, lyre antlers, cupped ears) | Correct field marks | Rendered cream-dominant (wrong axis); texture-atlas approach |
| PR #13 V4 lesson: lofted continuous torso + explicit bind matrices | Correct direction for silhouette continuity | `SkinnedMesh` per animal does not instance; NaN bounding sphere; pivot-only contact |
| Visual Lab finding: grass backlight is the only perceptible gain | Saves time | Never re-measured on GPU |

## 3. Rejected approaches (do not repeat)
1. **Second complete rendering stack / standalone scene** (PR #7 lab, PR #12 `NaturalRiverbankScene`, Gemini V4
   `NaturalRiverbankLab`): duplicates terrain/water/sky, never compares like with like, drifts from production, and cannot
   be integrated incrementally. *Rejected in `VISUAL_LAB_REVIEW.md` and `VISUAL_V4_ACCEPTANCE.md`.*
2. **Staged entities** (PR #12 repositions real simulation animals into poses): breaks "simulation authoritative";
   screenshots then show choreography, not ecology.
3. **Absolute-height cameras** (PR #7 `forest_herd` 12 m underground).
4. **Timing `renderer.render()` without forcing completion** (PR #7 0.4 ms "frames").
5. **Per-animal `SkinnedMesh`** (PR #13): breaks instancing (production draws up to 700 animals in ~7 draw calls).
6. **Grading animation by a pivot-to-terrain number** alone: a passing 5 mm pivot gate co-existed with visibly
   wrong posture (23° hero pitch) and rigid poses.
7. **Shader-only polish on the existing primitives** (PR #7): imperceptible at gameplay distances.
8. **Photorealism / GPU FPS claims from SwiftShader** — every prior PR had to retract some.

## 4. Visual deficiencies of the production renderer (ranked by visible impact)
Observed in `docs/evidence/documentary-scenario-swiftshader.jpg`, `pr12-riverbank-chital-ab-swiftshader.jpg` (baseline
half) and fresh captures from this session (Phase 3).

| # | Deficiency | Root cause (file) |
|---|---|---|
| 1 | Chital read as "balloon on pegs": one ellipsoid torso, four straight 5-sided cylinders, no shoulder/haunch, no joints, stick antlers | `animalGeo.ts quadruped()`: `SphereGeometry(1,12,8)` body, `cyl(...,5)` legs |
| 2 | Gait is a pendulum: each leg rotates rigidly about the hip; no knee/hock flexion, no stance/swing, no duty factor, feet slide on slopes; whole body rigid (no spine, no head nod, no weight transfer) | `AnimalView.ts` vertex shader `ang = aPart.x * sin(iAnim.x) …` |
| 3 | Spots are vertex-colour blotches on a 12×8 sphere; coat is a flat brown; no dorsal stripe, throat patch or white underside of tail | `animalGeo.ts` `paint()` with `hash3f > 0.62` |
| 4 | Grass: sparse 6-blade tufts with uniform normals, uniform green, long bare gaps, saturated yellow-green ground between | `GrassView.ts tuftGeometry()` (upward normals), `TerrainView` vertex colours |
| 5 | Water: one flat tinted sheet, opacity from Fresnel only; no depth colour, no shallows, no bank wetness; sun glints blow out | `WaterView.ts` |
| 6 | Banks: grass colour runs straight into the water plane; no mud/silt band, no wet darkening | `chunkMesh.ts` colours, `TerrainView` material |
| 7 | Trees: cylinder + 4–7 icosahedron blobs ("lollipops"), flat-shaded scatter | `scatterGeo.ts broadleaf()/tallTree()` |
| 8 | Atmosphere: single `FogExp2` coloured by horizon; no aerial perspective toward the sun, no height falloff; distant hills keep full saturation | `Engine.ts` fog, `Sky.ts fogDensity()` |
| 9 | Shadows: `PCFShadowMap` hard edges; grass receives but never casts; animals cast with the rigid pose | `Engine.ts` |
| 10 | Palette: saturated mid-greens and pure-blue sky at midday; reads as a tech demo, not Indian late-monsoon/dry-season light | `chunkMesh.ts`, `Sky.ts` palette constants |

## 5. Architectural constraints any visual work must respect
- **Ecology untouched.** Presentation reads `Simulation` through `observe.ts`; never writes. Interpolation via `px/pz`
  and the renderer's `alpha` only.
- **One `WebGLRenderer` per canvas**, every GPU object disposed in `dispose()`; restart leak test must stay flat.
- **Instancing**: animals must remain a handful of draw calls; per-animal objects are not acceptable at 700 animals.
- **Adaptive quality**: new cost must be tied to preset fields (shadow map, grass count/distance, water detail, pixel ratio)
  so `QualityGovernor` can shed it; ecological truth (which animals exist and where) must not depend on quality.
- **Lazy loading**: experimental code behind a URL flag and dynamic `import()`, zero bytes on the default path.
- **Static hosting, no network assets, no paid services.** Any external asset needs a verified licence; procedural assets
  generated in code are project-owned.
- **Determinism**: rendering may use `Math.random` only for cosmetic, non-simulation effects; captures must be
  reproducible, so the slice uses no `Math.random` in anything visible.

## 6. Asset licensing status
No third-party meshes, textures, HDRIs or fonts are used by the production renderer or by this slice; every geometry
and texture is generated procedurally in project code (project-owned, same licence as the repository). PR #12/#13 also
used only procedural assets. An authored, licensed *Axis axis* glTF (as `VISUAL_V4_ACCEPTANCE.md` suggests) remains an
option; none was sourced in this session (no network asset fetches were attempted or needed).

## 7. Evidence references
| Evidence | Path / link |
|---|---|
| PR #12 V3 + V1 CI captures (recovered) | `docs/handover/evidence/recovered-pr12-run44099810345/` |
| PR #12 V3 metrics (pitch, pivot errors, draw calls, SwiftShader pacing) | same folder, `v3-frame-pacing-report.json` |
| PR #12 V1 composite | `docs/evidence/pr12-riverbank-chital-ab-swiftshader.jpg` |
| Visual Lab composites | `docs/evidence/visual-lab-ab-forest_herd.jpg`, `visual-lab-ab-river_dawn.jpg` |
| V4 decision (screenshots expired) | `docs/VISUAL_V4_ACCEPTANCE.md`, run 43811199796 |
| Real-GPU profiles | `docs/evidence/profile-hp-victus16-*.json`, `docs/PERFORMANCE.md` |
| Production documentary stills | `docs/evidence/documentary-scenario-swiftshader.jpg` |
| Orphaned PR #12 commits | SHA `ad003442a9eaa2491b409103d05285bca40a5b2c` (+ ancestors), CI runs 44089558085–44089703127 |

## 8. Direction taken for the vertical slice (Phase 2)
Not a new engine. The slice is an **alternative presentation layer over the production `Engine`**, behind
`/?slice=riverbank`, reusing the real `Simulation`, `Valley`, terrain streaming, sky and governor. It swaps or patches
only the views that the deficiency table identifies: chital model/animation, grass, water, terrain material,
atmosphere/shadows. Baseline and slice are rendered from the **same seed, tick, weather, time and camera pose** by
toggling `mode=baseline|natural`, so Phase 3 compares like with like and Phase 4 can integrate view by view.
Details and results: `docs/handover/RIVERBANK_SLICE.md`.
