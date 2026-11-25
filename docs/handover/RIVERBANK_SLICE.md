# VIS-01 — Naturalistic riverbank slice: build, evaluation and integration proposal

**Workstream:** VIS-01 (Graphics and Animation). **PR:** #42 (draft, not for merge). **Branch:** `claude/reclaimed-valley-naturalism-erqqqu`.
**Status (charter categories):** implemented · software-verified (SwiftShader) · **not** physically verified (no GPU, phone or human viewer available) · **not** creatively accepted.
Nothing here claims photorealism or lifelike animation. Automated gates prove geometry, contact and lifecycle properties only; whether the result *looks* like a chital moving through its habitat is for human review of the stills and videos below.

## 1. What was built (Phase 2)

An **alternative presentation layer over the production `Engine`**, not a second engine. It renders the same `Simulation`, `Valley`, terrain streaming, sky, lighting and quality preset, and swaps or patches only the views the handover audit found deficient. It is lazily loaded behind URL flags (default path: zero bytes; slice chunk 18.7 KB gzip, studio 1.4 KB gzip).

| Route | Purpose |
|---|---|
| `/?slice=riverbank&scene=evening\|morning\|midday&shot=hero\|vista\|side&mode=baseline\|natural&quality=high` | A/B harness: identical seed, tick, weather, time of day and camera in both modes |
| `/?slice=studio&pose=stand\|walk\|trot\|gallop\|graze\|lie\|alert\|bind&view=side\|front\|three\|rear&stag=1&clay=1` | Anatomy studio: one chital on flat ground for silhouette, proportion and joint review |

### 1.1 Chital (`apps/web/src/experiments/riverbank/chital*.ts`, `NaturalChitalView.ts`)
- **Skeleton (25 bones):** pelvis, chest, neck, head, tail, two ears; forelimbs scapula → humerus → radius → cannon → pastern/hoof; hind limbs femur → tibia → cannon → pastern/hoof. Adult female proportions (withers ≈ 0.82 m; stags scaled ×1.12 as in production). The standing pose is flexed at shoulder and hock, as in real cervids: this is where stance reach comes from (see §3.1).
- **Locomotion:** lateral-sequence walk (duty 0.62), diagonal trot (0.45), transverse gallop (0.22), blended by speed. Gait phase advances with **distance actually drawn** (no skating). Stride length is capped by what the forelimb can sweep; beyond that cadence rises (Froude-scaled for juveniles). Terrain IK places every hoof; body pitch and roll follow the ground; shorter steps and a crouch on steep banks; hoof breakover at the end of stance; vertical bob, hip roll, lateral sway and head nod phased to the footfalls (weight transfer).
- **Behaviour layers** from the read-only contract (`behaviorFamily`, fear, measured movement): grazing and drinking solve the neck so the muzzle reaches the ground ahead of the forefeet (poll flexes to keep the face down); alert raises head and turns ears forward; resting lies down in ~1.6 s and rises in ~0.5 s via IK-folded limbs; tail hangs and swishes, flags white in alarm and flight; ears flick independently.
- **Mesh:** lofted torso (rump to brisket), neck emerging from inside the chest (no coincident surfaces), wedge head with deep cranium and fine muzzle, cupped ears, eyes, limbs from elbow/stifle down with joint blends and flattened hoof soles, tail, lyre antlers with brow tine and terminal fork (stags). Near LOD ≈ 9.5 k triangles (doe) / 10.8 k (stag); far LOD ≈ 2.6 k / 3.4 k.
- **Rendering:** linear-blend skinning in the vertex shader from a float bone texture, **one row per instance**, so every chital of one sex and LOD is still a single instanced draw call (4 draws total), with a matching shadow-depth material. Coat computed per pixel in bind space: rufous coat, rows of white spots, dark dorsal stripe, white belly/throat patch/rump patch/tail underside, paler inner legs, dark muzzle band, white chin, eye ring, preorbital gland, ear rims, dark hooves, ivory antler tips; sheen for short fur.

### 1.2 Environment (`naturalEnvironment.ts`)
- **Terrain:** production biome colours kept (ecological truth), muted palette shift, ground-cover mottling near the camera, wet silt band above the waterline, riverbed below it.
- **Water:** depth-aware turbidity from a time-sliced local heightfield bake (192², 160 m window), shoreline fade (no hard edge), far-bank band in low-angle reflections, capped glints; output in linear HDR.
- **Grass:** 15-blade curved tufts with per-instance colour variation and thin-leaf translucency toward the sun; **1.5× the preset's tuft count** (recorded in stats).
- **Foliage/rocks:** palette harmonised, leaf-scale breakup on canopies. Tree *geometry* is unchanged (production lollipops) — the largest remaining visual deficit.
- **Shadows:** PCF radius 3.5 (softer penumbrae).
- **Post pass (Medium+):** height-falloff aerial perspective with in-scatter toward the sun, restrained grade, then **production's own ACES tone mapping and sRGB conversion**. Production's sky dome writes display-referred colour; the post pass bypasses tone mapping for sky pixels so the sky matches production exactly (a real bug found and fixed during evaluation, §3.3).

## 2. Evidence

See §6 for the commands. Images are SwiftShader renders: valid for composition, anatomy and colour; **not** for performance or final shading quality on a GPU.

All captures: build `27f6003`, headless Chromium 153, SwiftShader, quality preset **High** fixed (no adaptation), unpaused
simulation frozen at the scene tick. Scenes: **evening** = seed 2 at 17:30, clear, golden hour, two chital drinking
(the documentary seed); **morning** = seed 6 at 08:00, clear. Both reached by ordinary 1 s simulation steps from tick 0;
the camera is derived from where the hero chital is (animals are never placed). Baseline and natural share seed, tick,
weather, time of day and camera exactly.

### 2.1 Side-by-side stills (`docs/evidence/riverbank/`)
| Shot | 720p | 1080p (composite downscaled ×0.5; full PNGs in `test-artifacts/riverbank/`) |
|---|---|---|
| Evening hero (drinking chital, 26° lens) | `evening-hero-720p-ab.jpg` | `evening-hero-1080p-ab.jpg` |
| Evening vista (river reach) | `evening-vista-720p-ab.jpg` | `evening-vista-1080p-ab.jpg` |
| Evening side (anatomy, 6.5 m) | `evening-side-720p-ab.jpg` | `evening-side-1080p-ab.jpg` |
| Morning hero (grazing doe) | `morning-hero-720p-ab.jpg` | `morning-hero-1080p-ab.jpg` |
| Morning vista | `morning-vista-720p-ab.jpg` | `morning-vista-1080p-ab.jpg` |

Anatomy studio stills: `studio-stand-three-00.jpg`, `studio-walk-side-10.jpg` (stag), `studio-graze-side-00.jpg`,
`studio-lie-three-10.jpg` (stag), `studio-bind-three-01.jpg` (clay, bind pose).
Superseded first pass (skyline halo, flat bank) archived in `pass1-3e5f5b3/`.

### 2.2 Video
- `gameplay-morning-hero-ab.mp4` — 8 s, baseline | natural side by side, **live simulation** at game speed 1 with the
  camera following the hero; frame-stepped at 24 fps (offline capture, so smoothness says nothing about frame rate).
  Honest limitation: the hero is grazing slowly, so this clip shows little locomotion.
- `studio-gaits.mp4` — 13 s, rig only (no simulation): walk (stag), trot, gallop (stag), walk three-quarter, graze, lie.

### 2.3 Measurements (SwiftShader — **not GPU performance**)
| Capture | Draw calls (B → N) | Triangles (B → N) | Chital drawn (near/far) | Rig solve ms | Submit p50 ms (B → N) | Complete p50 / p95 ms (B → N) |
|---|---|---|---|---|---|---|
| evening-hero-720p | 89 → 93 | 0.96 M → 2.51 M | 43 (8/35) | 2.0 | 2.1 → 4.2 | 755 / 890 → 1526 / 1641 |
| evening-vista-720p | 110 → 114 | 1.04 M → 2.58 M | 43 (8/35) | 1.8 | 2.1 → 4.9 | 734 / 820 → 1549 / 1665 |
| evening-side-720p | 83 → 87 | 1.02 M → 2.57 M | 43 (8/35) | 1.3 | 2.3 → 4.9 | 521 / 583 → 1218 / 1266 |
| morning-hero-720p | 99 → 103 | 0.86 M → 2.19 M | 17 (6/11) | 0.6 | 2.2 → 3.5 | 622 / 641 → 1292 / 1344 |
| morning-vista-720p | 92 → 96 | 0.98 M → 2.36 M | 17 (6/11) | 0.7 | 2.1 → 3.0 | 662 / 720 → 1492 / 1570 |
| evening-hero-1080p | 89 → 93 | 0.96 M → 2.51 M | 43 (8/35) | 1.2 | 1.9 → 4.4 | 974 / 1030 → 1997 / 2122 |
| evening-vista-1080p | 110 → 114 | 1.04 M → 2.58 M | 43 (8/35) | 1.6 | 2.2 → 4.1 | 899 / 958 → 1988 / 2088 |
| evening-side-1080p | 83 → 87 | 1.02 M → 2.57 M | 43 (8/35) | 1.3 | 1.9 → 4.2 | 666 / 692 → 1665 / 1716 |
| morning-hero-1080p | 99 → 103 | 0.86 M → 2.19 M | 17 (6/11) | 0.6 | 2.3 → 3.3 | 818 / 865 → 1769 / 1866 |
| morning-vista-1080p | 92 → 96 | 0.98 M → 2.36 M | 17 (6/11) | 0.5 | 2.2 → 3.5 | 909 / 951 → 1917 / 2061 |

Console/shader errors in any capture: none. GPU string: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`.

Readings:
- **Draw calls +4** (four instanced chital meshes; post pass adds one more not counted in scene stats).
- **Triangles ×2.4–2.6, dominated by grass**: 120-triangle tufts × 1.5 count ≈ 1.4 M vs baseline 18 × 1 ≈ 0.14 M. All chital
  together add ≈ 0.17 M (8 near × ~9.5 k + 35 far × ~2.6 k). Integration must use a lower-poly tuft at unchanged counts (I4).
- **Rig CPU: 0.5–2.0 ms per frame for 17–43 chital** (≈ 0.035–0.05 ms per animal including terrain sampling) — CPU time, valid
  as an order of magnitude; to be re-measured on real hardware.
- **Software completion time ≈ 2× baseline** at both resolutions. On a CPU rasteriser this tracks triangles and fill; it does
  not predict GPU cost. The real-GPU profile on the owner's Victus (Radeon Vega 8 and RTX 3060) is required before any
  default-on decision.
- **GPU lifecycle**: 3 restarts of the natural slice on the shared renderer → live geometries 83, textures 7, programs 20 on
  every cycle; no console or shader errors (`lifecycle.json`).
- **Unit gates** (`tests/unit/chital-rig.test.ts`, 11): stance toe ≤ 2 mm and heel ≤ 2 mm (before breakover), slip ≤ 5 mm on
  flat ground at walk; trot/gallop toe ≤ 4 mm, slip ≤ 2 cm, IK never clamped; 15 % slope with cross-fall toe ≤ 5 mm; real
  seed-2 riverbank toe ≤ 1 cm; juvenile scale; cadence in field ranges (walk 1.63 Hz, trot 2.52 Hz, gallop 3.22 Hz at 9 m/s);
  lying, grazing reach, determinism.
- **Live scene contact** (reported, not gated): max stance toe error among near chital 1.3 cm, for animals standing on the
  steep evening bank beyond the rig's pitch limit.


## 3. Defects found and fixed while building (archived, including failed approaches)

### 3.1 Rig
| Symptom (measured) | Root cause | Fix |
|---|---|---|
| Stance hooves 3–6 cm above ground at walk | Forelimb in bind pose at full extension (pivot height ≈ chain length) | Separate scapula bone; flexed standing posture; scapula/humerus solve only as far as needed |
| All gates passed but cadence 2.2 Hz walk, 7.5 Hz gallop | Stride capped by a limb with too little slack | Anatomical shoulder/elbow flexion; **added a cadence gate** so a passing contact test can never again hide unrealistic motion |
| 15–22 cm stance error descending a ~26° riverbank | Pitch clamp, fixed stride on steep ground | Shorter steps with slope, crouch, pitch limit 0.45 rad |
| Grazing muzzle stuck 37–44 cm above ground | Neck pivot too high; fixed head angle rotated the muzzle back up past vertical | Neck exits the chest lower and further forward; head flexes at the poll to keep the face down |

### 3.2 Mesh (found in clay studio views, not by tests)
Superellipse sections made boxy panels; limb tubes started at shoulder/hip and protruded as boxes; neck base coincided with the torso surface (z-fighting chevrons); a kink in the neck axis produced a pipe-like brisket; neck carried at 23° (llama posture) and a horse-like head; oversized white bib; hocks above the back when lying. All fixed; each fix is visible in the commit history.

### 3.3 Colour pipeline
First slice renders had a pale sky and milky water. Cause: production's sky and water shaders write display-referred colour without tone mapping; routing them through a post pass applied ACES + sRGB a second time. Fixed (sky bypass; slice water writes linear HDR). **Lesson for integration:** any production post pass must handle these two shaders explicitly.

## 4. Remaining limitations and risks
- Trees, shrubs and ruins keep production geometry; distant canopies still read as lollipops (most visible in the morning shots).
- A 1-pixel bright edge remains along the skyline where MSAA blends the display-referred sky with linear terrain (fix: I1).
- The bank ground still reads flatter than real grassland; grass tufts are sparse at mid distance.
- Lying pose is acceptable at mid distance but not anatomically detailed (limb fold order, head resting not modelled); no get-up/lie-down transition animation beyond the blend.
- Gallop cadence reaches ~4.4 Hz at the 12.5 m/s top sprint (field ~3 Hz); suspension phase is approximated.
- Turning: feet can slip during sharp turns (gates cover straight paths and slopes only).
- Live scene stance error is reported (not gated) for animals standing on banks steeper than the rig's design limit.
- Coat is procedural, not photographic; no fur cards or translucency at the ear rims.
- Grass at 1.5× density raises cost; the preset counts are unchanged in production.
- Every timing is SwiftShader; real GPU cost unknown until profiled on the owner's hardware.
- Determinism of the rig is per JS engine (same caveat as the simulation).

## 5. Proposed incremental production integration (Phase 4) — **awaiting director review**

No engine replacement. Each step is its own PR with matching A/B captures, unit gates, the restart leak test and real-GPU numbers before it is enabled by default. Every new cost is tied to a `QualityPreset` field so `QualityGovernor` can shed it; nothing about which animals exist or where depends on quality.

| Step | Change | Touches | Quality hook | Risk |
|---|---|---|---|---|
| I1 | Colour-pipeline guard: document and test that sky/water are display-referred (prerequisite for any post pass) | `Sky.ts`, `WaterView.ts` comments + unit test | — | Very low |
| I2 | Water depth turbidity, shoreline fade, far-bank reflection band | `WaterView.ts` (+ time-sliced bake) | `waterDetail` | Low |
| I3 | Terrain wet bank, riverbed, ground mottling, palette | `TerrainView` material (coordinate with QA-01, which owns `debugState`) | none (shader only) | Low |
| I4 | Grass tuft geometry and translucency at **unchanged** preset counts; density increase as a separate preset decision | `GrassView.ts` | `grassCount` | Low |
| I5 | Chital renderer: an additive `AnimalView` hook to delegate one species to a specialised renderer (replaces the slice's private-field access), then the skinned chital with near/far LOD; picking, selection ring and `maxGroundError` QA hook read the rig's feet | `AnimalView.ts`, new `render/chital/*` | new `rigDist` / LOD distance per preset; far animals update the rig at reduced rate | Medium (CPU per animal, shared `pos` map) |
| I6 | Optional post pass (aerial perspective + grade), off on Low | `Engine.ts` | new `post: boolean` | Medium (full-screen pass, MSAA target memory) |
| I7 | Foliage palette and leaf breakup; then a separate design for real riparian trees | `ScatterView` materials | `vegDist` | Low → Medium |

Interfaces: no ecology or save-format change in any step. The only shared-code change requested is the additive `AnimalView` species-delegation hook (I5); it should be recorded in `docs/INTEGRATION_CONTRACTS.md` first. `main.ts` hooks: VIS-01 (`?slice=`) and AUD-01 (`?audiolab=`) are independent additive lines.

## 6. Reproduce
```bash
npm ci && npm run typecheck && npx vitest run tests/unit/chital-rig.test.ts && npm run build
npx playwright test --project=riverbank-slice -g lifecycle            # GPU lifecycle (3 restarts)
npx playwright test --project=riverbank-slice -g "capture matrix"     # 20 captures + metrics.json
RIVERBANK_VIDEO=1 npx playwright test --project=riverbank-slice -g video   # frame-stepped videos (ffmpeg)
python3 benchmarks/riverbank-composite.py test-artifacts/riverbank docs/evidence/riverbank
```
