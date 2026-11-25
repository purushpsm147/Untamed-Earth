# QA report

Last updated: 2026-11-24 by QA-01 (Platform, QA and Release Engineering; see `docs/handover/PLATFORM_HANDOVER.md`). Earlier
sections below were written on 2026-11-16 and are kept as history. Environment for software results: Linux container,
Node 22, headless Chromium 153 with **SwiftShader (software rasteriser), no GPU**, plus GitHub Actions (ubuntu-latest,
same software renderer). Software frame times support no performance claims. **Physical hardware:** one laptop (HP
Victus 16: Radeon Vega 8 iGPU and RTX 3060 Laptop, Edge 157, 2026-11-15), archived in `docs/evidence/profile-hp-victus16-*.json`
(see PERFORMANCE.md). **No phone, Firefox or Safari has been tested.**

## Gate status at integration `3a0e7f9` + PR #43 head `07dd3aa` (2026-11-25)
| Check | Where | Result |
|---|---|---|
| `npm ci`, typecheck, build | local | Pass. Main JS 676 kB (181 kB gzip) + worker + lazy chunks |
| Unit + headless (23 files) | local | **135/135** (132 on `3a0e7f9` + build provenance ×2 + coarse-LOD readiness regression) |
| Browser suites (smoke, reliability, gameplay, documentary): 21 tests | CI | **21/21**: [run 384](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45467323137) (push) and [run 385](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45467341467) (PR), both green on `07dd3aa` |
| Browser, local (this container) | local | Reliability 6/6 on `07dd3aa`; graphics-quality test pass (needed a 12 min CLI timeout here, see below). Full local run on `d484a37`: 19/21, both failures diagnosed below |
| GitHub Actions on integration HEAD `3a0e7f9` | CI | **Run 322: failure** (19/20). Fixed by PR #43 (not yet merged) |

**This container is not a timing reference.** Measured against CI on the same tests, it is about 2–4× slower (graphics-quality test
56 s in CI vs 2.9–4.4 min here; seeded random interaction 54 s vs > 240 s, about 3.7 s per action, steady progress to action ~64 of 80, no hang).
Timeouts that only trip here are recorded as environment, not product, and no test timeout was changed.

## Soak evidence (QA-02, 2026-11-25, `ee9545d`, software-rendered: object counts and trends only)
Opt-in project `npx playwright test --project=soak` (`tests/soak/soak.spec.ts`; `SOAK_MINUTES`, `SOAK_RESTARTS`). Not part of `test:e2e` or CI.
Raw samples: `docs/evidence/soak/*-2026-11-25.json`. Result: **3/3 passed in 40.1 min.**

| Test | Result |
|---|---|
| 30 min live run (seed 1, Curiosity Mode, 10x), 57 samples every 30 s | 58,099 ticks; no page errors, no fatal; JS heap after GC 23–29 MB, second-half slope **−0.15 MB/min**; live WebGL buffers vary 411–693 with streaming, second-half slope −0.31/min; textures ≤ 5, programs ≤ 13; **0 frames > 2 s** (SwiftShader frame p50/p95 300/367 ms: not a performance claim) |
| 25 world restarts (seed 11, same pose) | live WebGL objects **identical on all 26 loads** (305 buffers, 5 textures, 11 programs, 65 VAOs, 3 framebuffers); renderer geometries identical; heap after GC 20.2–21.6 MB, slope +0.03 MB/restart (noise) |
| WebGL context loss (`WEBGL_lose_context`) | recoverable message shown, no page error while the loop keeps running against the lost context; Reload → Continue restores a readable world from the **manual save** (tick 266), not the post-loss state |

**Finding (P3, for UX-01 / director):** after a context loss the simulation keeps running behind the error message
(tick 457 → 985 in 5 s at 100x) although nothing is shown. That unseen progress was not persisted in this run (the
manual save was restored), but whether it is persisted depends on whether an autosave or the `pagehide` save completes
first. Suggest pausing the simulation when the context is lost. Not changed by QA-01 (product behaviour, `Game.ts` is UX-01's).
**Update:** fixed by UX-01 in `5b4370e` (PR #45, unmerged). QA's soak context-loss test passes against it: 25 ticks after the loss (one frame before the event) instead of 528.

## Gate status on 2026-11-16 (history)
| Check | Where | Result |
|---|---|---|
| Typecheck, build | local | Pass. JS 710 kB (194 kB gzip) + 11 kB worker + lazily loaded profiler (4 kB) |
| Unit + headless simulation (15 files) | local | **93/93 pass** (80 at `3d53c14` + 7 governor trial tests + 5 pose tests + 1 dry-resting test); 100-day headless run: all six species persist |
| Browser suites (smoke, reliability, gameplay, documentary; 19 tests) | local | **19/19 on `acecba0`**. Then two CI-only flakes fixed (below), each 3/3 locally. Earlier pass: 18/19. Chunk traversal sampled geometry while terrain was still streaming (76, 81, 75, 87: no growth trend, but last − first 11 > 10); now samples once streaming is idle, threshold unchanged, 3/3 repeats. Earlier run: wildlife run-speed averaged in the new acceleration phase; now measured after the speed plateaus, threshold unchanged, 3/3 repeats |
| GitHub Actions | CI | **Run 130 on `263e584`: success** (typecheck, 93 unit/headless, build, all 19 browser tests). Failures in this pass (115, 124, 129) diagnosed and fixed below |

## CI record
| Run | Commit | Result | Cause | Fix |
|---|---|---|---|---|
| 44 | `21c3aba` | Fail | Wildlife: deer was resting when the jackal appeared; resting halves detection per check by design, so an 8 s window missed 6–25% of the time | Deer stands up first (`1695c09`) |
| 46 | `dcd446c` | Fail | Click-select: the followed deer walked off the screen centre before the click | Pause, click the deer's projected position (`6c1a3e4`) |
| 48 | `d7423cd` | Fail | (a) walk-speed check diluted by ticks before the key was first sampled (1.12 m/s measured for a 2.08 m/s walk); (b) chunk traversal timed out: the scripted path advanced at most 0.1 s per frame, so slow CI frames stretched it past 4 min | Measure only while moving; path advances by real time (`c93468d`) |
| local | `6c1a3e4` | 2 fails | Short key holds fell between frames 250–1000 ms apart, so they did nothing | Input latches taps between frames (product fix, unit-tested); tests poll for effects (`6b8261e`) |
| 45, 47, 49, 50 | — | Cancelled | Superseded by a newer push | — |
| **51** | **`c93468d`** | **Success** | — | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43732212471) |
| 69 | `13e9e08` (PR #10 merge) | Cancelled | Superseded | — |
| **70** | **`9b64860`** | **Success** | PR #10 (poll for movement) + frame waits in the observer helper | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43749604134) |
| local | `9b64860` | 1 flake in 5 | Slow-vs-fast camera compared distance over a fixed hold; Shift-held frames rendered less often | Compare commanded speed (`755aa2f`) |
| **78** | **`e1303f9`** | **Success** | Observation contracts | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43752123947) |
| **85** | **`3d53c14`** | **Success** | Navigation, herds, documentary scenario | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43758379766) |
| 115 | `c86a691` | Fail (1) | Chunk traversal: renderer geometry count 54, 70, 77, 67. That counter only includes geometry drawn at least once, so it depends on which chunks the 420 m/s path sampled (frame rate) | Exact terrain accounting (created − disposed = tracked meshes, no orphans); original 14/10 bounds kept as growth bounds on non-terrain geometry |
| **130** | **`263e584`** | **Success** | — | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43818776943) |
| 129 | `3a9d068` | Fail (1) | Traversal and observer fixes held. New assertion from this pass ("SwiftShader's downgrade trial measures a gain") failed: on the CI runner the trial never registered a gain in 90 s. Root cause in the governor: 1.2 s windows at ~4 fps hold ~5 frames, and means are hitch-sensitive | Each window now needs >= 8 frames and compares medians (new unit test: slow hitchy device keeps helpful downgrades); browser test checks the verdict is measured and applied consistently, not which verdict a given machine produces |
| 124 | `49ac48c` | Fail (2) | Same traversal flake; observer camera Space rose 0.93 m in a fixed 700 ms hold on a saturated runner | Hold until the camera moves (bounded 20 s), > 1 m threshold unchanged |
| 131, 132 | `42abea5`, `a0e08ba` | Success | docs; PR #14 | — |
| 220 | `5cf7b4a` | Success | PR #20 critical thirst | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43916688742) |
| 246 | `9e25ecc` | Cancelled | Superseded by 247 | — |
| 247 | `deb1de8` | Success | PR #19 (test stabilisation) on top of PR #23 | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43932288080) |
| 275 | `0acc437` | Success | PR #24 behaviour audit | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/44032676828) |
| **282** | **`78bb515`** | **Success** | PR #25: 120 unit, 20 browser | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/44050126945) |
| 322 | `3a0e7f9` | Fail (1) | Reliability "terrain converges after violent camera travel": `terrainSettled()` passed, then `mismatched` = 97. Streaming state is recomputed only in the next frame's `TerrainView.update()`; after `debugCam()` an already-settled old position read all zeros. Deterministic reproduction: teleport + read in one task → 0. Not a product defect | `terrainSettled()` waits for an `update()` pass that started after the call (`debugState().updates`), assertions unchanged; regression test added (`daf0ffa`, PR #43) · [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/44116004501) |
| 353/355 | `daf0ffa` (PR #43) | Cancelled | Superseded by the next push | — |
| **363/364** | **`d484a37`** (PR #43) | **Success** | First fix + docs | [363](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45397584349), [364](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45397593497) |
| local | `d484a37` | 2 fails | (a) Graphics-quality test: fixed 3.5 s sleep, Medium read 80/88/89 geometries in round 1 vs 102–105 later (reproduced 2/2 in isolation; UX-01 reproduced it on `3a0e7f9` and on PR #45 CI run 45399663928). (b) Seeded random interaction: 240 s timeout from container slowness (see above) | (a) `gfxSettled()` helper: terrain settled + geometry/chunk counts stable over 1 s (`f0afb90`); threshold ≤ 6 unchanged. (b) none needed |
| 378 | `f0afb90` (PR #43) | Fail (1) | The new readiness regression test itself: helper passed, next read `mismatched` = 18. Deeper cause: a missing chunk is first filled at LOD 6 and its full-detail target is set only on the next `update()`; in between, `mismatched` (vs `want`) and every other counter read 0 | `debugState().mismatched` compares with the chunk's final LOD `lodFor(dist)` (diagnostics only); deterministic unit regression, verified failing before the fix (`07dd3aa`) |
| **384/385** | **`07dd3aa`** (PR #43) | **Success** | 21/21 browser, 135 unit | [384](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45467323137), [385](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45467341467) |

## What the tests cover

**Unit / headless** (`tests/unit/`)
- Core: RNG determinism and resumability, noise bounds, spatial hash vs brute force.
- World: same seed gives the same world; all four areas present; trees never in water or buildings; chunk seams match across LODs.
- Environment: drought vs monsoon diverge; fields stay in range; day/night cycle.
- Ecology: 1/3/10/100-day runs; exact population accounting; identity stable across detail-focus changes; daily intake within 35–170% of species requirement; thirsty animals find water and drink at the edge; tired animals rest; prey flee perceived predators (fearless adults don't); jackals hunt and kills feed them; nobody inside buildings; vegetation recovers after drought; save/load continues bit-identically.
- Render lifecycle (PR #2) and terrain stale-response handling (PR #4).
- Quality governor (PR #3 + integration): downgrade order, recovery to ceiling, hysteresis at a performance cliff, exponential backoff and relaxation, sub-4 fps devices, start-up calibration, 30/60 fps targets, frame pacing on 60–240 Hz displays, hardware assessment.
- Curiosity director (PR #6/#8 + integration): determinism, bounded buffers, hold/hysteresis, death handling, skip exclusion, building clearance with the game's real rotated footprints, speed cap, event-animal tracking, size-based framing with a 3.5 m minimum, aim height.
- Sky lighting: night stays dark, twilight lights the ground, golden-hour warmth, midday exposure, ambient monotonic through the morning.
- Scatter instance buffers: no truncation, growth, shrink with hysteresis, no reallocation on small changes.
- Input: a key tapped between two frames counts once.
- Quality governor trials: a downgrade that does not cut frame time by 5% is undone exactly; ≤ 6 probes in 15 min of a render-insensitive slowdown; the hold lifts when frame time gets 30% worse; ceiling and manual presets respected; deterministic. Render-bound fixtures use a render-sensitive device model.
- Animal pose (presentation only): lie-down ~1.5 s and smooth, quick get-up, never lying while moving, head and leg swing blend between graze/drink/walk/run/alert, birds never lie, the simulation hash is untouched.
- Observation contracts: the simulation hash is identical with animation/audio observers attached; audio events equal the raw event stream.
- Navigation (`navigation.test.ts`): a deer detours round a 19 m ruin to its far side without entering it (path < 2.2× straight line); no ground animal turns faster or accelerates harder than its species limits over a day; cliffs refused and jackals out of deep water (< 3% of time); an unreachable goal is abandoned within 60 s; save/reload mid-movement is bit-identical and older saves load; a jackal beside a herd triggers alarms, at least half the herd flees, and the herd regroups within ten minutes; herd mates stand inside each other in < 2% of samples (15.4% before).
- Documentary scenario: identical state, conditions and camera on every run, equal to stepping a fresh world by hand.

**Browser** (`tests/e2e/`)
- Smoke: boot, render, time acceleration (exactly 1 game-minute per tick at 100×), mode switches, save and reload; resource disposal on restart; Auto overrides a saved manual setting.
- Gameplay: camera in every direction and all four areas; deer walk/run speeds, grazing that removes forage, drinking only at water, rest, perceived predator and escape, release with identity intact; click-select, follow, Social Lens matches simulation state; experiment levers, pause, exact reset; save–close–reopen restores the same state hash; runtime quality changes leave the ecosystem untouched; repeated chunk traversal; every panel by mouse and keyboard; Curiosity Mode (subjects, hold, skip, pause, captions, instant hand-back, Become); 80 seeded random actions with invariants after each.
- Documentary walk-through (`documentary.spec.ts`, records video): fixed start with deer in view, Curiosity, interruption, inspector shows the simulation record, save–close–reopen restores the same hash and the same deer.
- Reliability, governor: a constant 80 ms feed (rendering cannot help) is probed once and undone on the real renderer (pixel ratio, draw distance, shadows restored); on SwiftShader the real downgrade's trial measures a gain and keeps it.
- Reliability: live WebGL objects identical after 4 restarts; terrain converges after violent travel with stale results discarded; terrain readiness is judged only after a streaming pass for the current camera (regression for CI 322); world loads on the main thread if the Worker dies; Auto detects the software renderer and lowers resolution under real overload while manual settings are respected and persisted; governor decisions drive real renderer settings up to the ceiling, and the simulation hash at tick 300 matches a fixed-quality control.

## Measurements (software renderer)
| What | Value |
|---|---|
| Frame time p50 / p95, fixed route, 1280×720 | Low 250 / 983 ms; Medium 517 / 1517 ms; High 850 / 1767 ms (`?profile=1`) |
| Draw calls / triangles on the route | Low 62 / 284 k; Medium 115 / 736 k; High 158 / 1.17 M |
| Simulation per tick (`npm run bench`, container CPU, ecology only) | 1× step: 0.37 ms before steering → 0.46 ms after (~210 animals; 10 ticks per real second = 0.5% of one core). 100×: 0.43 → 0.43 ms. 1000×: 0.59 → 0.65 ms |
| WebGL objects across restarts 1–5 | identical (299 buffers, 5 textures, 17 programs, 67 VAOs, 3 framebuffers) |
| JS heap across restarts 1–5 | 50.5, 71.6, 71.3, 67.2, 66.9 MB (plateau) |
| Instance buffers on Low | 10.82 MB before, 0.72 MB after (same drawn counts); High 1.57 MB |
| Dawn/dusk mean luma (seed 1, fixed pose, clear, frozen time, Medium) | 05:24 0.203 → 0.258; 18:36 0.192 → 0.248; 06:24 0.379 → 0.360; noon 0.599 → 0.562; night 0.063 → 0.066 |
| Curiosity framing | crow 10 m → 3.5 m, perched myna 3.8 m, chital 9 m |
| Auto recovery after removing load | **Not verifiable here** (no headroom on a software rasteriser); verified on real hardware, see PERFORMANCE.md |
| Movement after this pass (seeds 1/4/9) | chital sideways/backward moves per 1000 moving ticks 22–30 → 0.1–0.2; idle/resting/foraging animals in > 0.2 m water 3.2–5.9% → 0–0.4%; chital within 0.5 m of another 0.4–1.1%; pinned windows 0/2/2 |
| Documentary opening shot (seed 2, tick 570, rendered camera) | 9 herd deer in frame, 7 taller than 6% of frame height (max 21%); before: specks across a meadow |
| Node vs Chromium Math (20,000 inputs each) | last-bit differences in sin, cos, atan2, pow, exp, log, cbrt (0.05–18% of inputs); sqrt, hypot identical. Simulation deterministic per engine only |
| Movement quality, 1 game day, seeds 1/4/9 (`npm run movement`), before → after Living Valley V1 | heading snaps per 1000 moving ticks 0–2.6 → 0–0.01; chital speed jolts 1.1–2.0 → 0.3–0.5; hare jolts 9.6–35.8 → 0.3; jackal time in deep water 0.7/10.4/7.4% → 0.02/0/0%; chital distance to herd centre 25/52/39 m → 16/19/17 m; pinned 20 s windows 1/2/0 → 1/6/2; with personal spacing chital distance to herd centre is 20/21/18 m |

Evidence images: `docs/evidence/documentary-camera-before-after.jpg`, `docs/evidence/documentary-scenario-swiftshader.jpg`, `docs/evidence/dawn-dusk-before-after.jpg`, `docs/evidence/curiosity-framing-before-after.jpg`;
profile report: `docs/evidence/profile-swiftshader-2026-11-15.json`.

## Defects found and fixed (integration and follow-up sessions)
| Defect | Severity | Fix |
|---|---|---|
| Short key taps lost on slow devices (frames further apart than the tap) | P2 | Taps latched until the next frame |
| Instance buffers preallocated at maximum on every preset (~10 MB waste on Low) | P2 | Grow on demand, shrink with hysteresis; grass sized per preset |
| Dawn/dusk murky, noon washed out | P2 | Twilight ambient curve, warm bounce, exposure adaptation |
| Birds framed from 10 m by Curiosity | P3 | Size-based standoff with 3.5 m minimum |
| Instanced-mesh buffers leaked per world restart | P1 | `InstancedMesh.dispose()` everywhere |
| New WebGLRenderer per world leaked three.js framebuffers and textures | P1 | One renderer per canvas |
| Terrain Worker death → main-thread fallback too slow → fatal loading error | P1 | Per-frame time budget; stall-based watchdog |
| Quality governor never adapted below 4 fps | P2 | Consecutive long visible frames count as overload |
| Curiosity footprints rotated the wrong way (test shared the bug) | P2 | Valley convention; oracle fixed; real-building test |
| Curiosity camera had no speed limit | P2 | 55 m/s cap (22 with reduced motion) |
| Focused slider or checkbox swallowed Escape and movement keys; Tab hijacked | P2 | Focus-aware key handling; Ecosystem panel moved to `T` |
| Animals inside building footprints; hares trapped by floods | P2 | Spawn/forage/landing guards; flood escape |
| Pinch-zoom disabled on mobile | P3 | Viewport meta fixed |

## Not verified
Phones; Firefox and WebKit; any GPU other than the Victus pair; the governor under CPU-only load on real hardware
after `c86a691`; Ultra and full-screen 1080p; audio output (never listened to); touch and gamepad on devices; long
(30 min+) browser soak and > 20 restarts; WebGL context restore (context loss shows a reload message); offline launch
(no service worker exists); memory budgets; visual quality judged against photorealism goals.
Procedure for collecting the missing evidence: `docs/handover/HARDWARE_VALIDATION.md`. Beta checklist: `docs/handover/RELEASE_READINESS.md`.

## Known issues
- At the 3.5 m safety minimum a myna is still only ~6% of frame height.
- Midday meadow grass still reads pale.
- Animals steer locally with wall-following (no path-finding): occasionally one gives up on a destination behind a long obstacle. The camera passes through trees.
- Herds have no leader; the lying pose is a rigid-leg fold (no knee joint).
- Auto quality under CPU-only load: fixed and tested in software; real-hardware re-run pending.
- The Victus hardware reports do not record which commit they measured (it was a build between `6c1a3e4` and `eb92959`). New `?profile=1` reports include `build.sha`.
- Determinism is per JavaScript engine (see SIMULATION.md).
- Jackal/hare dynamics are seed-sensitive (see SIMULATION.md).
