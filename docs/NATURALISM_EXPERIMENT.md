# Untamed Earth — Visual & Audio Naturalism Experiment (Assignments A–E)

**Repository:** `https://github.com/purushpsm147/Untamed-Earth`  
**Base Integration Branch:** `ccr-4783fee0-8wvc41`  
**Experimental Branches:**
1. **Visual Vertical Slice (Assignments A, B, C, E):** `experiment/gemini-natural-riverbank`
2. **Spatial Environmental Soundscape (Assignment D):** `experiment/gemini-natural-soundscape`

**Status:** Experimental source awaiting independent TypeScript, browser/WebGL2 and real hardware validation. The specimen herd is deliberately arranged with prescribed behaviors for A/B artwork: **not evidence of emergent ecology or autonomous animal decision-making.**

**Production Code Safety:** Zero files under `apps/web/src/render/*`, `apps/web/src/audio/AudioEngine.ts`, `apps/web/src/game/Game.ts`, or `packages/*` were modified. All prototypes live under `apps/web/src/lab/` and are lazily loaded only when `/?slice=1` or `/?soundscape=1` is present in the URL.

---

## Assignment A — Honest Visual-Quality Gap Analysis (Ranked by Visible Impact)

Inspection of the current production screenshots (`docs/evidence/curiosity-framing-before-after.jpg`, `docs/evidence/dawn-dusk-before-after.jpg`, `docs/evidence/visual-lab-ab-river_dawn.jpg`) and the production source code (`animalGeo.ts`, `scatterGeo.ts`, `GrassView.ts`, `TerrainView.ts`, `WaterView.ts`, `Sky.ts`, `AudioEngine.ts`) shows why the current game reads like a late-1990s 3D title—and why surface-level shader tweaks alone (PR #7) could not fix it:

| Rank | Deficiency Category | Root Cause in Production Code | Visible Impact in Captures | Vertical-Slice Solution (`NaturalRiverbankScene` & `ChitalPrototype`) |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **Low-Detail Animal Meshes & Silhouettes** | `animalGeo.ts` builds every quadruped from **1 sphere** (`SphereGeometry(1, 12, 8)`), **4 straight 5-sided cylinders** (`cyl(..., 5)`), a cylinder neck, and a sphere head. `GeoBuilder.add()` strips UVs (`g.deleteAttribute('uv')`) and paints chital spots by vertex-thresholding (`hash3f > 0.62`) on a 12×8 grid. | Chital look like brown "balloon animals on pegs" with jagged triangular vertex-color blotches instead of round white spots, no chest/flank/haunch contour, no knees/hocks/hooves, and 4-sided stick antlers. | `ChitalPrototype.ts` sculpts a pinched-waist/deep-brisket/rounded-haunch torso, S-curved neck, tapered muzzle, cupped white-lined ears, lyre-shaped 3-tine antlers, 3-segment limbs (thigh, knee/hock joint, cannon bone, cloven hoof), and a 512×512 procedural spotted-pelage + normal map. |
| **2** | **Missing or Unnatural Animal Animation** | `AnimalView.ts` rotates each leg as a rigid stick (`aPart.x * sin(iAnim.x)`) around the hip and rotates the neck+head as a single rigid block around the shoulder. | Feet skate or swing stiffly like pendulums without knee/hock bend; grazing deer plunge their entire rigid neck+head block into the ground at an unnatural angle; ears and tails are frozen. | Multi-joint vertex attributes (`aBone`, `aSubPivot`, `iPoseA`, `iPoseB`) drive independent upper-limb swing + lower-cannon knee/hock flexion, separate neck reach vs. head-scoop angle, ribcage breathing, ear flicks, and white-flag tail raising across 6 ecological poses (`idle`, `walking`, `running`, `grazing`, `drinking`, `alert`). |
| **3** | **Simplistic Vegetation Geometry** | `scatterGeo.ts` builds trees from 1 cylinder + 4–7 displaced `IcosahedronGeometry` ("lollipop blobs"). `GrassView.ts` places sparse 6-blade triangles (`18` verts) on a wide grid. | Trees read as faceted green marshmallows on brown sticks; wide bare gaps between grass tufts expose flat vertex-colored ground. | `buildRiparianCorridorKit()` adds multi-branched riparian trees with 14 layered leaf-cluster canopies, 10-frond overarching riverbank fern rosettes, and dense backlit grass. |
| **4** | **Weak Terrain & Riparian Composition** | `chunkMesh.ts` transitions directly from green vertex color to the flat water plane with no ecotone dressing. | The river looks like a blue tape strip laid across a golf course—no mud/pebble/gravel bank, no riverside boulders, no ferns or reeds hugging the shore. | Procedural bank zoning (`vWp.y - uWaterY`) blends wet alluvial mud and river pebbles within 1.45 m of water level, dressed with mossy shoreline boulders and fern clusters. |
| **5** | **Uniform, Synthetic Materials** | Every mesh in `geo.ts` deletes UVs (`deleteAttribute('uv')`) and uses flat vertex colors with `roughness: 0.9–1.0` and zero normal/bump maps. | Bark, soil, rock, and fur share identical smooth Gouraud/Lambertian shading with no surface micro-relief or specular variation. | Procedural canvas normal maps (`terrainNormalTex` 256×256, `pelageNormalMap` 256×256) and wetness-driven roughness modulation (`0.88 -> 0.22` at the shoreline) add tactile surface grain. |
| **6** | **Water Rendering** | `WaterView.ts` uses a single flat quad with uniform noise normals and uniform opacity (`mix(0.72, 0.97, fres)`), with no awareness of water depth. | Water has the same opaque slate tint 5 cm from the bank as in the middle of the channel; no submerged pebble bed or bank-hugging foam. | `createNaturalWaterMaterial()` bakes a 256×256 analytical river-depth & bank-distance map (`uDepthMap`) for Beer-Lambert optical absorption (`1 - exp(-depth * 3.6)`), revealing warm submerged pebbles in the shallows, emerald channel depth, and shoreline ripple foam. |
| **7** | **Lighting, Shadows & Atmospheric Depth** | Single uniform `FogExp2` without volumetric canopy light cues or fur rim scattering; `PCFShadowMap` has hard edges. | Forest edges look flat and lack the warm dappled depth of morning wildlife cinematography. | Soft `PCFSoftShadowMap`, additive crepuscular morning sun-shaft planes filtering through the western tree line, and velvet rim-scattering (`pow(1 - dot(N, V), 3.2)`) on chital fur. |
| **8** | **Synthetic 1990s Soundscape** | `AudioEngine.ts` loops a 3-second mono noise buffer through 3 static `BiquadFilter`s, runs a continuous 4,300 Hz oscillator chopped by a 31 Hz square wave for crickets, and uses raw `triangle`/`sawtooth`/`square` ramps with `Math.random()` stereo panning for calls. | Sounds like a static white-noise generator plus 8-bit synth bleeps with no spatial localization or proximity change near the river. | `NaturalSoundscape.ts` uses 7.5-second decorrelated stereo noise, HRTF 3D `PannerNode` river positioning with low-body + LFO riffle + near-bank water-lap droplets, wind/canopy leaf-flutter filtering, pulsed dual-carrier insect stridulation, and formant-filtered 3D animal calls. |

### Two Fixed, Reproducible Terrain-Clamped Camera Views (Seed `150`, Time `07:45`)

1. **Shot 1 — `riverbank_vista` (Forest-Riverbank Environment Shot):**
   - Framed along the wooded western river bend (`z = 620`, `x = riverX(620) - 13.5`, `y = ground + 3.4 m`, looking toward `(riverX(628) - 4.5, ground + 1.4 m, 628)`, `FOV = 54°`).
   - Strictly terrain-clamped (`cam.y - ground = +3.40 m`), capturing the overhanging forest canopy, morning sun shafts, fern/boulder shoreline, shallow pebble bed, and chital herd.
2. **Shot 2 — `chital_closeup` (Close Wildlife Documentary Shot, `3.6 m` Standoff):**
   - Framed `3.6 m` from the lead adult chital stag and grazing doe at the water's edge (`cam.y = max(groundAtCam + 1.25 m, lookY + 0.25 m)`, `FOV = 44°`), showcasing the stag's lyre antlers, spotted rufous pelage, white throat bib, and multi-joint limb/neck articulation alongside the grazing doe, walking fawn, and drinking doe.

---

## Assignment B & C — Naturalistic Environment & Wildlife Prototype Architecture

### 1. Asset Provenance, Licensing, Download Size & Runtime Memory Cost

To respect the browser-first `<10 MB` budget and offline capability (`docs/ENGINEERING_RULEBOOK.md`), all textures and meshes in the prototype are **100% original procedural assets generated in-memory at startup** (0 KB network download, CC0 / project-owned):

| Asset ID | Type | Resolution / Geometry | Network Download | GPU Memory Cost | Preset Scaling (`Low` / `Medium` / `High`) |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `chital-pelage-albedo-512` | `CanvasTexture` (sRGB) | `512 × 512` RGBA | `0 KB` | `1.05 MB` | Shared across all chital instances |
| `chital-pelage-normal-256` | `CanvasTexture` (Linear) | `256 × 256` RGBA | `0 KB` | `0.26 MB` | Shared across all chital instances |
| `terrain-micro-normal-256` | `CanvasTexture` (Linear) | `256 × 256` RGBA | `0 KB` | `0.26 MB` | Shared across all terrain chunks |
| `river-depth-lookup-256` | `DataTexture` (Linear) | `256 × 256` RGBA | `0 KB` | `0.26 MB` | 1 lookup texture for river sheet |
| `anatomical-chital-stag-doe` | `BufferGeometry` | Stag `~2,680` verts / Doe `~2,120` verts | `0 KB` | `0.34 MB` | Instanced (`MAX = 180` per sex) |
| `riparian-foliage-kit` | `BufferGeometry` (4 meshes) | Fern, mossy boulder, canopy tree, sun shaft | `0 KB` | `0.22 MB` | Instance count scaled `0.45×` (Low), `0.75×` (Med), `1.0×` (High); sun shafts disabled on Low |
| **Total Added Footprint** | — | — | **`0 KB`** | **`~2.39 MB`** | Compatible with Low, Medium, and High budgets |

### 2. Read-Only Ecological Animation Contract for Claude (`ChitalPrototype.ts`)

`ChitalPrototype.ts` reads `Animal` fields (`id`, `sex`, `age`, `x`, `z`, `heading`, `speed`, `beh`, `fear`, `hunger`, `thirst`, `energy`) and never writes back to `Simulation`:
- `resolveChitalPose(animal)` deterministically maps `B.Idle`, `B.Wander`, `B.Forage`, `B.Drink`, `B.Flee`, `speed`, and `fear` to `'idle' | 'walking' | 'running' | 'grazing' | 'drinking' | 'alert'`.
- **Honest Assessment of Procedural vs. Authored Skeletal Assets:** While the 10-part multi-joint vertex shader (`aBone`, `aSubPivot`, `iPoseA`, `iPoseB`) eliminates the "balloon-dog on stick legs" look and adds real knee/hock flexion, separate neck/head angles, ear flicks, and tail flagging at zero glTF download cost, true documentary close-ups (<2 m) of complex quadruped behaviors (lying down transitions, grooming, antler sparring, swimming) will eventually benefit from a compact (~150–250 KB Draco/Meshopt-compressed) artist-authored glTF skinned mesh with `THREE.InstancedMesh` bone-texture skinning. The `ChitalAnimInputs` and `resolveChitalPose` interface is designed so a glTF clip mixer can plug into the exact same ecological state inputs later.

---

## Assignment D — Isolated Spatial Environmental Soundscape (`NaturalSoundscape.ts`)

- **Browser Audition Demo (`/?soundscape=1`):**
  1. Run `npm run dev` (or `npm run build && npm run preview`) and open `http://localhost:5173/?soundscape=1` (or `:4173/?soundscape=1`).
  2. Click **Start Audio** (satisfies browser user-gesture autoplay policy).
  3. Drag the **River Distance** slider from `1 m` to `140 m` to hear the 3D HRTF `PannerNode` attenuate the low river body (`280 Hz`), LFO-swept riffles (`820–1,000 Hz`), and near-bank water-lap droplets (`<38 m`).
  4. Adjust **Wind & Canopy Rustle**, **Daylight** (`0 = Night Crickets`, `1 = Morning Birds`), and **Rain Intensity**, or trigger 3D spatialized **Chital Alarm Bark**, **Myna Song**, **Crow Caw**, and **Dusk Jackal Howl** calls sourced from actual `Simulation(150)` animal coordinates.
- **Unit Test Verification (`tests/unit/natural-soundscape.test.ts`):**
  - Verified in Node (`4/4` tests passing): monotonic river distance attenuation & droplet cutoff, wind + canopy leaf-rustle coupling, dusk/night insect chorus scaling & storm/fast-forward suppression, and user-gesture gating + bounded simulation-driven call history.

---

## Assignment E — Evidence-Based A/B Methodology & Hardware Benchmark Protocol (HP Victus)

### 1. Why End-to-End Frame Pacing Must Be Measured (`measureEndToEndPacing`)
As documented in `docs/VISUAL_LAB_REVIEW.md`, timing `renderer.render(scene, camera)` on the CPU only measures command-buffer submission (`~0.4–0.8 ms`), missing actual rasterization and display presentation. `NaturalRiverbankApp.measureEndToEndPacing()` records two distinct metrics across every run:
1. **`rafP50Ms` / `rafP95Ms` / `rafFps`:** True end-to-end `requestAnimationFrame` callback-to-callback intervals, capturing full browser frame pacing.
2. **`rasterP50Ms` / `rasterP95Ms`:** Synchronous `renderer.render()` + `gl.finish()` duration, forcing the WebGL pipeline to complete all tile/fragment rasterization before stopping the clock.

### 2. Running the Benchmark on Your HP Victus (Ryzen 7 5800H / Radeon iGPU / RTX 3060 Laptop GPU)

Because CI and this container only have **Google SwiftShader (CPU software rasterizer)**, physical GPU frame pacing must be collected on your HP Victus at both `1280×720` and `1920×1080` (`1080p`):

1. **Automated Playwright A/B Capture & Pacing Suite (SwiftShader or Local GPU):**
   ```bash
   npx playwright test tests/e2e/naturalism-ab.spec.ts
   ```
   This generates 6 side-by-side PNG captures in `test-results/naturalism-slice/`:
   - `riverbank_vista_baseline_720p.png` vs. `riverbank_vista_naturalistic_720p.png`
   - `chital_closeup_baseline_720p.png` vs. `chital_closeup_naturalistic_720p.png`
   - `riverbank_vista_baseline_1080p.png` vs. `riverbank_vista_naturalistic_1080p.png`
   and writes `test-results/naturalism-slice/naturalism-metrics.json`.

2. **Interactive Hardware Benchmark on AMD Radeon iGPU vs. NVIDIA RTX 3060 Laptop GPU:**
   - Start the server: `npm run build && npm run preview`
   - Open `http://localhost:4173/?slice=1` in Chrome/Edge at **1920×1080 (F11 fullscreen)**, first with Windows Graphics Settings / NVIDIA Control Panel set to **Integrated Graphics (AMD Radeon)**, and then set to **High-performance NVIDIA processor (RTX 3060 Laptop GPU)**.
   - Open DevTools Console and run:
     ```js
     const report = {
       gpu: window.__naturalSlice.renderer.getContext().getParameter(
         window.__naturalSlice.renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL
       ),
       vista_baseline: await window.__naturalSlice.measureEndToEndPacing('riverbank_vista', 'baseline', 30, 180),
       vista_naturalistic: await window.__naturalSlice.measureEndToEndPacing('riverbank_vista', 'naturalistic', 30, 180),
       closeup_baseline: await window.__naturalSlice.measureEndToEndPacing('chital_closeup', 'baseline', 30, 180),
       closeup_naturalistic: await window.__naturalSlice.measureEndToEndPacing('chital_closeup', 'naturalistic', 30, 180),
     };
     console.table(report);
     copy(JSON.stringify(report, null, 2));
     ```
   - This copies the complete 180-frame hardware JSON report directly to your clipboard so we can compare true `rafP50Ms`/`rafP95Ms` and `rasterP50Ms`/`rasterP95Ms` against your 144 Hz (`6.94 ms` frame budget) display ceiling.
