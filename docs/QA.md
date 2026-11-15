# QA report

Last updated: 2026-11-15, integration session (PRs #2, #3, #4, #6, #8 merged; #7 reviewed, not merged).
Environment: Linux container, Node 22, headless Chromium 153 with **SwiftShader (software rasteriser), no GPU**.
Every result below comes from that environment. Frame times are not representative of real hardware and support no
performance claims.

## Gate run

| Check | Command | Result |
|---|---|---|
| Clean install | `npm ci` | Pass |
| Strict typecheck | `npm run typecheck` | Pass |
| Unit + headless simulation (8 files) | `npm test` | **60/60 pass** (≈108 s) |
| Production build | `npm run build` | Pass — JS 705 kB (192 kB gzip) + 11 kB terrain worker + 7 kB CSS |
| Browser suites (smoke, reliability, gameplay) | `npm run test:e2e` | **17/18** on the full run. The failure was a timing-dependent precondition in the terrain flight test (the Worker kept up, so nothing went stale). Test made deterministic, then passed 2/2 with `--repeat-each 2`. Full suite not re-run after that change. |

## What the tests cover

**Unit / headless** (`tests/unit/`)
- Core: RNG determinism and resumability, noise bounds, spatial hash vs brute force.
- World: same seed gives the same world; all four areas present; trees never in water or buildings; chunk seams match across LODs.
- Environment: drought vs monsoon diverge; fields stay in range; day/night cycle.
- Ecology: 1/3/10/100-day runs; exact population accounting; identity stable across detail-focus changes; daily intake within 35–170% of species requirement; thirsty animals find water and drink at the edge; tired animals rest; prey flee perceived predators (fearless adults don't); jackals hunt and kills feed them; nobody inside buildings; vegetation recovers after drought; save/load continues bit-identically.
- Render lifecycle (PR #2) and terrain stale-response handling (PR #4).
- Quality governor (PR #3 + integration): downgrade order, recovery to ceiling, hysteresis at a performance cliff, exponential backoff and relaxation, sub-4 fps devices, start-up calibration, 30/60 fps targets, frame pacing on 60–240 Hz displays, hardware assessment.
- Curiosity director (PR #6/#8 + integration): determinism, bounded buffers, hold/hysteresis, death handling, skip exclusion, building clearance with the game's real rotated footprints, speed cap, event-animal tracking.

**Browser** (`tests/e2e/`)
- Smoke: boot, render, time acceleration (exactly 1 game-minute per tick at 100×), mode switches, save and reload; resource disposal on restart; Auto overrides a saved manual setting.
- Gameplay: camera in every direction and all four areas; deer walk/run speeds, grazing that removes forage, drinking only at water, rest, perceived predator and escape, release with identity intact; click-select, follow, Social Lens matches simulation state; experiment levers, pause, exact reset; save–close–reopen restores the same state hash; runtime quality changes leave the ecosystem untouched; repeated chunk traversal; every panel by mouse and keyboard; Curiosity Mode (subjects, hold, skip, pause, captions, instant hand-back, Become); 80 seeded random actions with invariants after each.
- Reliability: live WebGL objects identical after 4 restarts; terrain converges after violent travel with stale results discarded; world loads on the main thread if the Worker dies; Auto detects the software renderer and lowers resolution under real overload while manual settings are respected and persisted; governor decisions drive real renderer settings up to the ceiling, and the simulation hash at tick 300 matches a fixed-quality control.

## Measurements (software renderer)
| What | Value |
|---|---|
| Frame time, Low, 480×270, idle | ≈150–180 ms (governor drops to 50% resolution on Low) |
| WebGL objects after each of 4 restarts | buffers 291, VAOs 65, programs 11, framebuffers 3, textures 5 (identical every time) |
| Before the lifecycle fixes | +3 framebuffers and +4 textures per restart (three.js renderer); instanced buffers also leaked |
| Simulation tick, ~250 animals | 0.3–0.5 ms (Node, one core) |
| Curiosity, 90 s from settlement | 0 samples inside ruins below roof, 0 below terrain, max 53 m/s over 2 s windows |

## Defects found and fixed this session
| Defect | Severity | Fix |
|---|---|---|
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
- Dawn and golden-hour scenes are very dark.
- Curiosity frames small birds from too far away.
- Grass and rain buffers sized for Ultra on every preset.
- Animals steer locally (no path-finding); the camera passes through trees.
- Jackal/hare dynamics are seed-sensitive (see SIMULATION.md).
