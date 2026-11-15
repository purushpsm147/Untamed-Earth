# Roadmap

Status key: **Done** = implemented and verified (see QA.md) · **Partial** = works but with stated gaps · **Not started**.

## Milestone 1 — The Reclaimed Valley (MVP)

| Area | Status | Notes |
|---|---|---|
| Workspace, strict TypeScript, Vite build | Done | |
| Deterministic valley: forest/river, settlement, dump, meadow/wetland (2.07 km²) | Done | |
| Terrain streaming with distance LOD, off-thread meshing | Done | |
| Environment: day/night, seasons, weather, soil water, river stage, vegetation, nutrients | Done | |
| Six species with utility AI, limited perception, food web, births, deaths | Done | |
| Fixed-timestep simulation, 1×/10×/100×/1000× | Done | 1000× is CPU-bound on slow machines; achieved rate is shown |
| Headless 100-day tests, reproducibility, save round trip | Done | |
| Observer mode (free camera, select, inspect, follow) | Done | Camera collides with terrain and water only, not walls or trees |
| Wildlife mode (spotted deer) | Done | |
| Experiment mode (rain, weather pattern, growth, fertility, add/remove, reset, charts) | Done | |
| Start screen, HUD, pause menu, graphics/audio settings, diagnostics, help | Done | |
| Save/load (IndexedDB), autosave, versioned format | Done | One slot |
| Procedural audio | Partial | Implemented; not audibly verified in the headless test environment |
| Quality presets and adaptive resolution | Partial | Logic implemented; not yet tuned against real GPUs |
| Touch controls, gamepad | Partial | Implemented through the input abstraction; untested on devices |
| Simulation detail tiers | Partial | Decision-rate LOD + abstract pools + grid tier; no individual↔population conversion |
| Performance budgets on reference hardware | Not started | Only software-rendered measurements exist so far |

## Milestone 2 — Depth and polish (next)

- Measure and tune on real desktop and mobile GPUs; set download and memory budgets from data.
- Animal path-finding around walls and along river banks; camera collision with ruins.
- Better animal models and gaits; juveniles with distinct proportions; nests and dens.
- Ecological tuning: jackal food limitation, hare refugia, seasonal breeding peaks for deer.
- More playable species (jackal, crow).
- Multiple save slots, export/import to file.
- Richer weather visuals (wet surfaces, puddles), dawn mist volumes.

## Milestone 3 — Scale

- Multiple regions with streaming between them and floating-origin coordinates.
- Population-level simulation for unloaded regions, with individuals promoted and demoted without losing identity.
- Simulation in a Web Worker once entity counts justify it.
- WebGPU renderer behind the existing rendering boundary.

## Expansion modules (not part of the first releases)

Ocean, desert, larger reclaimed cities and industrial zones; orbital space (with physically plausible century-old orbital remnants and clearly separated cinematic travel); optional mythical regions with their own non-humanoid creatures and ecology. Each is planned as a separate package and region type so it cannot alter the natural simulation's parameters. None of this exists yet.
