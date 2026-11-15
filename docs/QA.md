# QA report

Last updated: 2026-11-15, follow-up session (quality and verification). Environment for every result below: Linux
container, Node 22, headless Chromium 153 with **SwiftShader (software rasteriser), no GPU**, plus GitHub Actions
(ubuntu-latest, same software renderer). **No physical GPU or phone has been tested.** Frame times support no
performance claims; see PERFORMANCE.md for the profiling procedure to run on real hardware.

## Gate status
| Check | Where | Result |
|---|---|---|
| Typecheck, build | local | Pass. JS 710 kB (194 kB gzip) + 11 kB worker + lazily loaded profiler (4 kB) |
| Unit + headless simulation (12 files) | local | **69/69 pass** |
| Browser suites (smoke, reliability, gameplay; 18 tests) | local | Last full run 16/18: both failures were input-timing races (below), fixed; affected scenarios then passed 6/6 with `--repeat-each 2` |
| GitHub Actions | CI | **Run 51 on `c93468d`: success** (typecheck, 69 unit/headless, build, all 18 browser tests; ~10 min). Earlier failures diagnosed and fixed below |

## CI record
| Run | Commit | Result | Cause | Fix |
|---|---|---|---|---|
| 44 | `21c3aba` | Fail | Wildlife: deer was resting when the jackal appeared; resting halves detection per check by design, so an 8 s window missed 6–25% of the time | Deer stands up first (`1695c09`) |
| 46 | `dcd446c` | Fail | Click-select: the followed deer walked off the screen centre before the click | Pause, click the deer's projected position (`6c1a3e4`) |
| 48 | `d7423cd` | Fail | (a) walk-speed check diluted by ticks before the key was first sampled (1.12 m/s measured for a 2.08 m/s walk); (b) chunk traversal timed out: the scripted path advanced at most 0.1 s per frame, so slow CI frames stretched it past 4 min | Measure only while moving; path advances by real time (`c93468d`) |
| local | `6c1a3e4` | 2 fails | Short key holds fell between frames 250–1000 ms apart, so they did nothing | Input latches taps between frames (product fix, unit-tested); tests poll for effects (`6b8261e`) |
| 45, 47, 49, 50 | — | Cancelled | Superseded by a newer push | — |
| **51** | **`c93468d`** | **Success** | — | [run](https://github.com/purushpsm147/Untamed-Earth/actions/runs/43732212471) |

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

**Browser** (`tests/e2e/`)
- Smoke: boot, render, time acceleration (exactly 1 game-minute per tick at 100×), mode switches, save and reload; resource disposal on restart; Auto overrides a saved manual setting.
- Gameplay: camera in every direction and all four areas; deer walk/run speeds, grazing that removes forage, drinking only at water, rest, perceived predator and escape, release with identity intact; click-select, follow, Social Lens matches simulation state; experiment levers, pause, exact reset; save–close–reopen restores the same state hash; runtime quality changes leave the ecosystem untouched; repeated chunk traversal; every panel by mouse and keyboard; Curiosity Mode (subjects, hold, skip, pause, captions, instant hand-back, Become); 80 seeded random actions with invariants after each.
- Reliability: live WebGL objects identical after 4 restarts; terrain converges after violent travel with stale results discarded; world loads on the main thread if the Worker dies; Auto detects the software renderer and lowers resolution under real overload while manual settings are respected and persisted; governor decisions drive real renderer settings up to the ceiling, and the simulation hash at tick 300 matches a fixed-quality control.

## Measurements (software renderer)
| What | Value |
|---|---|
| Frame time p50 / p95, fixed route, 1280×720 | Low 250 / 983 ms; Medium 517 / 1517 ms; High 850 / 1767 ms (`?profile=1`) |
| Draw calls / triangles on the route | Low 62 / 284 k; Medium 115 / 736 k; High 158 / 1.17 M |
| Simulation per tick | 0.3–0.5 ms |
| WebGL objects across restarts 1–5 | identical (299 buffers, 5 textures, 17 programs, 67 VAOs, 3 framebuffers) |
| JS heap across restarts 1–5 | 50.5, 71.6, 71.3, 67.2, 66.9 MB (plateau) |
| Instance buffers on Low | 10.82 MB before, 0.72 MB after (same drawn counts); High 1.57 MB |
| Dawn/dusk mean luma (seed 1, fixed pose, clear, frozen time, Medium) | 05:24 0.203 → 0.258; 18:36 0.192 → 0.248; 06:24 0.379 → 0.360; noon 0.599 → 0.562; night 0.063 → 0.066 |
| Curiosity framing | crow 10 m → 3.5 m, perched myna 3.8 m, chital 9 m |
| Auto recovery after removing load | **Not verifiable here** (no headroom on a software rasteriser) |

Evidence images: `docs/evidence/dawn-dusk-before-after.jpg`, `docs/evidence/curiosity-framing-before-after.jpg`;
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
Real GPUs, phones, Firefox and WebKit; the governor's upgrade path under real headroom; audio output; touch and
gamepad on devices; long (30 min+) browser soak; memory budgets; visual quality judged against photorealism goals.

## Known issues
- At the 3.5 m safety minimum a myna is still only ~6% of frame height.
- Midday meadow grass still reads pale.
- Animals steer locally (no path-finding); the camera passes through trees.
- Jackal/hare dynamics are seed-sensitive (see SIMULATION.md).
