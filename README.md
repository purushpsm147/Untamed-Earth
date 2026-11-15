# Untamed Earth: After Humanity

A browser-based 3D ecosystem simulation set a century after people vanished. A two-square-kilometre valley — forest and river, a ruined settlement, a waste dump, meadow and wetland — runs continuously whether or not you are watching. Deer graze the meadow down, jackals stalk hares at dusk, droughts thin the herds, and carcasses feed crows and soil.

Everything is generated in the browser from a seed: no art assets, no audio files, no backend, no account.

**Status: playable MVP (milestone 1), with early Curiosity Mode and adaptive graphics.** Tested only in software-rendered Chromium so far; no real-GPU or phone measurements yet. See [docs/ROADMAP.md](docs/ROADMAP.md) for what is and is not built, and [docs/QA.md](docs/QA.md) for what has actually been verified.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production build into apps/web/dist
npm run preview    # serve the build on http://localhost:4173
npm test           # unit + 100-day headless simulation tests (about 100 s)
npm run test:e2e   # Playwright smoke, reliability, gameplay and documentary suites (needs a prior build; ~12 min)
npm run test:smoke # just the smoke tests
npm run sim -- 150 7   # headless population report: 150 days, seed 7
npm run bench      # simulation throughput
# open /?profile=1 on any device for a ~5 min self-running performance report (docs/PERFORMANCE.md)
# open /?scenario=documentary for a fixed, repeatable review start (docs/DOCUMENTARY.md)
npm run movement   # movement-quality report: snaps, jolts, cliffs, wading, pinned animals, herd spread
npm run documentary # browser walk-through of the documentary scenario with video
```

A modern desktop browser with WebGL2 is required. If graphics or storage cannot be initialised, the game says why instead of failing silently.

## Ways to play

| Mode | What you do |
|---|---|
| **Observer** | Fly an invisible camera anywhere. Click an animal to inspect its needs and behaviour; follow it. |
| **Wildlife** | Live as a spotted deer. The animal you take over keeps its age, hunger and identity, and goes back to its own decisions when you release it. |
| **Experiment** | Change rainfall, weather pattern, plant growth, a species' fertility or numbers, and watch the population and forage charts respond. Reset from any seed. |
| **Curiosity** (`V`) | A documentary autopilot finds what the ecosystem is doing (hunts, births, herds at water, scenery) and frames it, with optional captions drawn from simulation state. Any input hands the camera back; `N` skips. |

**Graphics:** Auto (default) starts from what the browser reports about the device and then adapts to measured frame times, lowering resolution first and restoring quality, up to the preset you choose, when there is headroom. Pick a 30 fps, 60 fps or uncapped target in the menu. Rendering settings never change the ecosystem.

### Controls

| Input | Action |
|---|---|
| `W A S D`, `Space` / `Q` | Move, rise / descend |
| Drag mouse (or `C` to capture the pointer) | Look |
| `Shift`, mouse wheel | Faster; adjust fly speed / zoom |
| Click | Select an animal |
| `G`, `P`, `X` | Follow, take control (deer), release |
| `E`, `F`, `R` | As a deer: graze, drink, rest |
| `[` `]` | Slower / faster time (pause, 1×, 10×, 100×, 1000×) |
| `T`, `F3`, `M`, `Esc` | Ecosystem panel, diagnostics, mute, menu |
| `V`, `N` | Curiosity Mode (documentary autopilot), skip to another subject |

Touch (left thumb moves, right thumb looks, tap selects) and standard gamepads are wired through the same input abstraction; see QA for their test status.

## How it is put together

```
packages/core         seeded RNG, noise, spatial hash, events      (no dependencies)
packages/worlds       the valley: terrain, zones, landmarks, scatter, chunk meshes
packages/environment  weather, hydrology, vegetation, nutrient cycle on a 24 m grid
packages/ecology      species data, animal state, perception, utility AI, food web
packages/persistence  IndexedDB store, versioned save envelopes
apps/web              Three.js renderer, input, audio, UI, game modes
tests/                Vitest unit + headless simulation tests, Playwright smoke test
benchmarks/           headless population report and throughput benchmark
```

The simulation packages never import rendering code and run headless in Node; the renderer only reads simulation state. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Model equations, time compression and species parameters: [docs/SIMULATION.md](docs/SIMULATION.md).

## Credits and licences

- [three.js](https://threejs.org) (MIT) is the only runtime dependency.
- The procedural, asset-free approach and resolution-first quality adaptation were inspired by [Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden). No code from that project is used.
