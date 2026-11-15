# Roadmap

Status key: **Done** = implemented and verified in software-rendered Chromium (see QA.md) · **Partial** = works with stated gaps · **Not started**.
"Verified" here never means verified on a real GPU or phone: no physical-hardware testing has happened yet.

## Milestone 1 — The Reclaimed Valley (MVP)

| Area | Status | Notes |
|---|---|---|
| Workspace, strict TypeScript, Vite build, CI workflow | Done | CI runs typecheck, unit/headless, build and all browser suites |
| Deterministic valley: forest/river, settlement, dump, meadow/wetland (2.07 km²) | Done | |
| Terrain streaming with distance LOD, off-thread meshing | Done | Stale Worker results rejected; main-thread fallback if the Worker dies (browser-tested) |
| Environment: day/night, seasons, weather, soil water, river stage, vegetation, nutrients | Done | |
| Six species with utility AI, limited perception, food web, births, deaths | Done | Animals kept out of building footprints; small mammals escape floods |
| Fixed-timestep simulation, 1×/10×/100×/1000× | Done | 1000× is CPU-bound on slow machines; achieved rate shown |
| Headless 1/3/10/100-day tests, reproducibility, save round trip | Done | |
| Observer mode (free camera, select, inspect, follow) | Done | Camera slides along ruins; trees are not solid |
| Wildlife mode (spotted deer) | Done | Walk/run/graze/drink/rest/escape verified in browser |
| Experiment mode | Done | |
| Start screen, HUD, pause menu, settings, diagnostics, help | Done | |
| Save/load (IndexedDB), autosave, versioned format | Done | One slot; also saves when the tab is hidden |
| Renderer resource lifecycle across restarts | Done | Live WebGL object counts identical after 4 restarts |
| Adaptive quality (Addendum IV) | Partial | Governor with recovery, ceiling, FPS target, pacing, start-up calibration and hardware assessment; downgrade verified in browser; **upgrade under real headroom unverified (needs a GPU)**. Self-running profiler at `/?profile=1` |
| Procedural audio, optional music | Partial | Not listened to |
| Touch controls, gamepad | Partial | Implemented; untested on devices |
| Simulation detail tiers | Partial | Decision-rate LOD + abstract pools + grid; no individual↔population conversion |
| Performance budgets on reference hardware | Not started | Only software-rendered measurements exist; the profiler to collect hardware data is ready |
| Instance-buffer memory | Done | Sized to need; Low 10.82 → 0.72 MB |
| Dawn/dusk lighting | Done (software-rendered review) | Twilight ambient curve and exposure adaptation; before/after evidence |

## Milestone 2 — Living-world features (Addendum III), early

| Area | Status | Notes |
|---|---|---|
| Curiosity Mode (documentary autopilot) | Partial | Gemini's director (PR #6) + GPT-6 fixes (PR #8) + integration fixes; browser-verified for selection, hold, skip, interruption, ruin clearance, speed cap, size-based framing. One general profile only |
| Social Lens (group, mother, offspring, pressures) | Partial | Shows only simulation state; no persistent social history beyond the session |
| World Library registry | Partial | Data-driven registry with one world; no other worlds exist |
| Visual quality improvements | Not started | Visual Lab (PR #7) reviewed, not merged: see VISUAL_LAB_REVIEW.md |

## Next

1. Measure on a real desktop GPU and a midrange phone: frame times, governor upgrade path, memory, download.
2. Social Lens history that survives save/load.
3. Midday grass tone (reads pale).
4. Animal path-finding around walls and along river banks; tree collision for the camera.
5. Ecological tuning: jackal food limitation, hare refugia, seasonal deer breeding.

## Expansion modules (not started, documentation only)

Ocean, desert, larger cities and industrial zones, nuclear sites, deep-time worlds, orbital space, mythical regions and
the Simulation Inspectors encounter (Addendum V, gated on a working Space Expansion). Each is planned as a separate,
lazily loaded package that cannot alter the natural simulation. None of this exists.
