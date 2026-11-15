# Untamed Earth — Visual Lab Engineering Report (PR #7)

**Target Repository:** `https://github.com/purushpsm147/Untamed-Earth`  
**Pull Request:** `#7` (`experiment/gemini-visual-lab` → `ccr-4783fee0-8wvc41`)  
**Scope:** Assignment B — Isolated Procedural Visual Laboratory, True Baseline Comparison, Shader Diagnostics, & Automated Browser Benchmark Harness

---

## 1. Resolution of GPT-6 Review Findings on PR #7

| GPT-6 Review Finding | Resolution Implemented |
| :--- | :--- |
| **1. P2 — No runnable scene/driver** | Added `VisualLabRunner` and `mountVisualLabApp(canvas)` in `apps/web/src/lab/VisualLabScene.ts`, wired to `/?lab=1` in `apps/web/src/main.ts` so the default game entrypoint (`/`) is untouched. `VisualLabRunner` instantiates a full deterministic `Simulation(150)`, `Valley`, `Environment`, `Sky`, `ScatterView`, `WeatherFx`, `buildLandmarks`, synchronous multi-LOD terrain chunks (`buildChunkMesh`), instanced grass tufts, water + leachate pools, and instanced wildlife across all 5 fixed-seed presets. |
| **2. P2 — Benchmark validity & true baseline** | Replaced the single-shader `uEnhanced` branch toggle with **two separate compiled material suites**: `baselineMats` (which replicates the exact production GLSL of `TerrainView.ts`, `GrassView.ts`, `WaterView.ts`, and `AnimalView.ts`) and `enhancedMats`. `runBenchmark()` runs warmup frames + `gl.finish()` + timed sample frames and records `meanMs`, `p50Ms`, `p95Ms`, `minMs`, `maxMs`, `drawCallsPerFrame`, and `trianglesPerFrame`. |
| **3. P2 — WebGL2 shader compilation validation** | Added `collectShaderDiagnostics()` which compiles both baseline and enhanced programs in WebGL2 and inspects `gl.getProgramParameter(..., LINK_STATUS)`, `gl.getShaderParameter(..., COMPILE_STATUS)`, `gl.getShaderInfoLog()`, and `gl.getProgramInfoLog()`. Guarded `instanceMatrix` with `#ifdef USE_INSTANCING` so non-instanced compilation never fails. |
| **4. P3 — Screenshot capture & resource lifecycle** | Enabled `preserveDrawingBuffer: true` on the isolated lab `WebGLRenderer`, rendered immediately prior to `toDataURL('image/png')` in `capturePng()`, and implemented idempotent `dispose()` that releases all terrain chunk geometries, landmark geometry/material, `ScatterView`, grass, water, leachate pools, animal geometries, sky, rain, both material suites, and the renderer (asserted to reach `geometries === 0` and `textures === 0` by `tests/e2e/visual-lab.spec.ts`; actual results depend on CI). |

---

## 2. Production Renderer Files Left Unchanged

Per assignment instructions, **zero** files under `apps/web/src/render/*`, `apps/web/src/game/Game.ts`, or `packages/*` were modified. Only:
- `apps/web/src/lab/VisualLabScene.ts` (isolated lab scene, true baseline vs. enhanced materials, UI panel, and benchmark runner)
- `apps/web/src/main.ts` (`?lab=1` URL query branch mounting `mountVisualLabApp(canvas)`)
- `tests/e2e/visual-lab.spec.ts` (automated Playwright e2e verification, screenshot capture, and report writer)
- `docs/ENGINEERING_REPORT.md` (this report)

---

## 3. Baseline vs. Enhanced Shader Comparison

| Subsystem | Production Baseline (`baselineMats`) | Enhanced Lab (`enhancedMats`) |
| :--- | :--- | :--- |
| **Terrain** | 2-octave value noise (`0.9`, `4.3`), seasonal `uDry` grass curing, uniform `uWet` darkening and roughness (`0.55`). | 3-octave value noise (`0.16`, `0.85`, `3.4`), world-normal slope-driven rock/scree with horizontal strata bands, plus shoreline elevation wetness gradient (`vLabWp.y - uWaterY`) and wet specular sheen (`roughness -> 0.26`). |
| **Grass** | 6-blade instanced tufts with 2-sine wind sway and vertex dry-straw tinting. | Adds low-frequency spatial wind-gust modulation + view-dependent sun backlighting subsurface translucency (`pow(max(dot(viewDirW, -uSunDir), 0.0), 2.6)`). |
| **Water** | 2 scrolling value-noise layers (`0.6`, `1.7`) + high-frequency normal perturbation, Schlick Fresnel, solar specular (`pow 220`). | 3 scrolling directional capillary wave layers (`0.58`, `1.65`, `4.4`), Schlick Fresnel, solar glitter, and animated wave-crest foam highlights (`smoothstep(0.76, 0.94, h0)`). |
| **Animals** | `aPart` / `aPivot` / `iAnim` vertex-shader rotation for legs, head/neck, and wings (`MAX = 400`). | Preserves exact `aPart`/`aPivot` leg/head/wing rotations and adds gait-coupled vertical spine bob (`abs(sin(iAnim.x)) * iAnim.y * 0.055`) and subtle lateral haunch sway during locomotion. |

---

## 4. Automated Test & Benchmark Methodology (`tests/e2e/visual-lab.spec.ts`)

Running `npx playwright test tests/e2e/visual-lab.spec.ts` (or `npm run test:e2e`):
1. Launches Chromium against `http://localhost:4173/?lab=1` at `1280×720`.
2. Calls `window.__visualLab.runFullSuite(8, 30)` across all 5 fixed-seed presets (`seed = 150`):
   - `valley_overview` (Midday)
   - `river_dawn` (Dawn wetland & river)
   - `forest_herd` (Forest edge & chital herd)
   - `ruins_golden_hour` (Reclaimed settlement at golden hour)
   - `monsoon_storm` (Storm rain, wind, & wet terrain)
3. Asserts every compiled WebGLProgram in both `baseline` and `enhanced` modes has `compiled === true` and empty `vertexLog`, `fragmentLog`, and `programLog`.
4. Writes all 10 PNG screenshots (`<preset>_baseline.png` and `<preset>_enhanced.png`) and `visual-lab-report.json` (containing `device` metadata, `isSoftwareRenderer` disclosure, `shaderDiagnostics`, and `benchmarks` with `p50Ms`/`p95Ms`/`drawCallsPerFrame`/`trianglesPerFrame`) into `test-results/visual-lab/` (automatically uploaded by `.github/workflows/quality.yml` in the `playwright-reports` artifact).
5. Calls `lab.dispose()` twice and asserts `renderer.info.memory.geometries === 0` and `textures === 0`.

---

## 5. Honest Environment & Hardware Limitations Disclosure

**Publication note:** The uploader has not executed this benchmark locally. CI results and screenshot artifacts must be inspected separately before claiming shader or browser verification.

- **Software Rasterizer in CI (`SwiftShader`):** `playwright.config.ts` launches headless Chromium with `--use-gl=swiftshader`. Frame times (`p50Ms` / `p95Ms`) recorded by CI or headless Playwright reflect **CPU software rasterization (`Google SwiftShader`)**, **not** physical desktop or mobile GPU hardware performance, and `device.isSoftwareRenderer` explicitly flags this in `visual-lab-report.json`.
- **No Unverified Claims:** We do not claim 60 FPS desktop or 30 FPS mobile hardware validation, VRAM savings, or photorealism from software-rendered runs. Physical GPU numbers should be recorded by opening `/?lab=1` in an accelerated desktop/mobile browser and clicking **Benchmark Current**.
