# Architecture

## Boundaries

| Concern | Lives in | Depends on |
|---|---|---|
| Simulation core (seeded RNG, noise, spatial hash, events) | `packages/core` | — |
| World management (region, zones, terrain, landmarks, scatter, chunk meshes) | `packages/worlds` | core |
| Environment (calendar, sun, weather, soil water, vegetation, nutrients, abstract consumer pools) | `packages/environment` | core, worlds |
| Ecology (species data, animal state, perception, decisions, food web, demography, experiment levers, snapshots) | `packages/ecology` | core, worlds, environment |
| Persistence (IndexedDB, versioned envelopes, migrations) | `packages/persistence` | — |
| Rendering, input, audio, UI, game modes | `apps/web` | all of the above, three.js |

Rules that are enforced by the dependency direction and exercised by the tests:

- **The simulation is authoritative and headless.** `Simulation` has no DOM, timing or renderer dependency; `npm test` and `npm run sim` run it in Node.
- **Rendering consumes state.** Views read `sim.animals`, `sim.env` and `sim.valley`. The only things the app writes into the simulation are explicit inputs: `step(dt)`, the detail `focus`, the player `control` intent, and the experiment levers.
- **World generation is a pure function of the seed.** `Valley` answers `height(x,z)`, zone weights, landmarks and per-chunk scatter analytically, so the main thread, the terrain worker and the tests always agree, and nothing is relocated when chunks stream in or out.

## Time

Rendering runs on `requestAnimationFrame`; the simulation advances in fixed steps from an accumulator. The step size depends on the time multiplier (0.1 s at 1×, 0.25 s at 10×, 1 s at 100×, 2 s at 1000×), so acceleration means more and coarser *simulation* steps, not faster animation. Simulation work is capped at about 9 ms per frame; if the CPU cannot hold the requested rate the backlog is dropped and the HUD shows the achieved rate. At 1× and 10× the renderer interpolates between the last two simulation states.

## Simulation detail tiers

| Tier | What it is in this build |
|---|---|
| Individuals near the focus | Full perception/decision cadence (every 2–4 s of simulated motion), per-tick movement |
| Individuals far from the focus (>300 m) | Same state and movement, decisions 2.5× less often |
| Abstract populations | Invertebrates and small fauna (rodents, lizards, frogs) are per-cell biomass pools with logistic growth, eaten by individuals |
| Grid tier | Vegetation, soil moisture, nutrients, detritus and contamination for the whole valley on a 24 m grid, always running |

Not built yet: converting individuals to and from population-level summaries, and unloaded regions (the MVP is one always-loaded region). See the roadmap.

## Rendering

- **Terrain**: 96 m chunks, meshed in a Web Worker at 48/24/12/6 quads per side by distance, with skirts to hide LOD seams. Chunks out of range are disposed. Falls back to main-thread meshing if the worker fails.
- **Vegetation and debris**: one `InstancedMesh` per kind (plus a low-poly variant for trees), refilled from the deterministic scatter lists when the camera moves or turns; chunks outside the view cone are skipped.
- **Grass**: instanced tufts near the camera whose size follows the simulated forage biomass of the cell, so grazing and drought are visible.
- **Animals**: one instanced mesh per species; legs, head and wings are animated in the vertex shader from per-instance parameters.
- **Sky, light, fog, water, rain**: driven by the environment's sun position, cloud cover, rain rate, wind and river stage.
- **Quality**: Low/Medium/High/Ultra presets. The adaptive controller smooths frame time, lowers render resolution first, drops a preset only when resolution is at its floor, and backs off exponentially after a failed upgrade.

The renderer is confined to `apps/web/src/render`. A WebGPU backend would replace that folder's internals; nothing outside it touches three.js except the camera and picking ray in `Game.ts`.

## Deliberate deviations from the suggested stack

- **No Rapier.** Animals and cameras move on an analytic heightfield with footprint tests for buildings; a rigid-body engine would add ~1 MB for nothing the MVP uses.
- **The ecosystem runs on the main thread.** A tick costs 0.3–0.5 ms for ~250 animals (see QA), so a worker would add state-transfer complexity without a measurable gain. The worker budget went to terrain meshing, where the hitches were.
- **No empty `space/` or `fantasy/` packages.** Extension points are described in the roadmap instead.

## Extending

- **New species**: add a `SpeciesDef` entry and a model in `animalGeo.ts`. Behaviour is driven by the data (diet, prey, predators, activity, flight).
- **New playable species**: set `playable: true`; the control path is species-agnostic.
- **New region or biome**: implement the `Valley` surface (height, zones, scatter, landmarks) for it; `Environment` and `Simulation` take the world as a constructor argument.
- **Fantasy / space modules**: separate packages with their own species tables and world definitions, loaded as separate regions so natural-world parameters are never shared or altered.
