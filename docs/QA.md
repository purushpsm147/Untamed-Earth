# QA report

Last updated for milestone 1. Environment: Linux container, Node 22, headless Chromium with a **software rasteriser** (no GPU). Frame rates below are therefore not representative of real hardware and are not used to claim performance targets.

## Automated checks

| Check | Command | Result |
|---|---|---|
| Strict typecheck | `npm run typecheck` | Pass |
| Unit + headless simulation tests (15) | `npm test` | Pass (≈100 s) |
| Browser smoke test | `npm run test:e2e` | Pass (≈45 s) |
| Production build | `npm run build` | Pass |

What the tests assert:

- **Core**: RNG determinism and resumability; noise bounds and continuity; spatial hash equals brute force.
- **World**: same seed → identical terrain, scatter and buildings; all four areas present; trees never in water or buildings; chunk meshes share edge heights across LODs.
- **Environment**: monsoon vs drought diverge in soil moisture, river stage and vegetation; all fields stay in range; day/night occurs.
- **100-day run**: no NaN or out-of-range state, unique ids, exact population accounting (start + births − deaths), predation occurs, nothing preys on jackals, no runaway growth.
- **Reproducibility**: identical state hash for identical seed; different for a different seed.
- **Persistence**: a saved and reloaded world continues bit-identically; foreign and too-new saves are rejected with a readable error.
- **Experiments**: drought reduces forage and raises herbivore stress relative to an identical control.
- **Wildlife control**: the possessed deer keeps id, keeps ageing and getting hungry, moves where steered, and grazing draws down the cell's forage.
- **Smoke test**: start screen → world loads → simulation advances under 100× → wildlife mode possesses and releases a deer → experiment panel adds animals → save → reload offers Continue; no console errors.

## Measured

| Metric | Value |
|---|---|
| Simulation tick, ~250 animals | 0.31 ms (1×), 0.37 ms (100×), 0.51 ms (1000×) on one container core |
| 100 game days headless | ≈30 s |
| JS bundle | 669 kB (180 kB gzip) + 11 kB terrain worker; no other assets |

Example 100-day trajectory (seed 1, from `npm run sim`): deer 52→50, boar 20→45, jackal 6→15, hare 64→122, crow 30→48, myna 44→109; forage biomass 75%→60% of capacity. Other seeds differ, sometimes sharply (see known issues).

## Manually verified (screenshots in headless Chromium)

Forest, settlement ruins, waste dump with leachate pool, river and wetland, aerial view, animal selection and inspector, follow camera, wildlife mode HUD with herd, experiment and ecosystem panels, thunderstorm with rain, night.

## Not verified

- Frame rate, memory and adaptive-quality behaviour on real GPUs (desktop or mobile).
- Audio output (the audio graph is built without errors, but nothing was listened to).
- Touch and gamepad input on physical devices.
- Browsers other than Chromium.
- Sessions longer than a few minutes of wall-clock time in the browser (long runs were headless only).

## Known issues

- The observer camera passes through buildings and trees.
- Animals use local steering; they can stall briefly against walls.
- The ecosystem chart is empty for the first two game hours (it needs two samples).
- 1000× may run below the requested rate on slow CPUs; the HUD reports the achieved rate.
- Jackal and hare dynamics are sensitive to seed (see SIMULATION.md, "Known model limits").
