# Master build prompt — Untamed Earth: After Humanity

## Mission and role
Act as Principal Game Engine Engineer, Graphics Programmer, Simulation Architect, Technical Game Designer and QA Lead. Implement, test, profile, polish and document an actual browser-accessible 3D living-world game — **not** a proposal, static mockup, procedural screensaver or non-interactive tech demo. Use rational trade-offs and keep every milestone runnable. If a coding session ends, preserve working state, evidence, open issues and precise next steps.

Inspiration: https://github.com/Noniv/abyssal-garden — procedural scene generation, adaptive quality, tiny delivery, audio synthesis, benchmarks. Its MIT license must be respected; modular architecture is preferable to copying its one-file model.

## Premise and creative contract
Humanity disappeared approximately **100 years** ago: extinct or departed to Mars (mystery intentionally unresolved). Earth has no living human/humanoid characters. Wildlife inhabits the forests, rivers, abandoned settlements, stations, industrial ruins and landfills; geology, weather, material decay and ecological succession determine the state of infrastructure.

One coherent world can be entered via three gameplay modes:
- **Observer**: free-flying invisible camera; select, inspect and follow wildlife; time controls and natural-history insights.
- **Wildlife**: inhabit an existing animal, starting with a spotted deer, preserving its identity, health, needs, age, group and history when entering/leaving player control.
- **Experiment**: adjust rainfall, food, fertility, selected populations and time; compare observable ecological outcomes to baseline without inventing causal explanations.

Core promise: **the world functions when the player does nothing**. No mandatory missions, score, leveling, conventional combat loop, server, account or paid services. Make the world worth visiting through scenery, behavior and events. Do not add decorative UI for unimplemented functionality.

## Technology and architecture
Prefer strict TypeScript, Vite, Three.js WebGL2 initially with renderer adapter for future WebGPU, Web Workers where beneficial, IndexedDB saves, Web Audio, Vitest and Playwright. Rapier is optional only if real collision requirements justify cost. No mandatory backend. Offline play after appropriate caching. Clean separation:
- `core`: seeded RNG, IDs, time, event interfaces, spatial queries.
- `worlds`: deterministic world→region→biome→chunk generation; landmarks, streaming and stable coordinates.
- `environment`: sun/weather/wind, rainfall, moisture, vegetation, water and nutrient feedback.
- `ecology`: headless finite resources, species configuration, local sensory perception, utility AI/state machines, reproduction, mortality, prey/predator/scavenger interactions, social identity and population metrics.
- `rendering`: consumes simulation state; terrain/materials/lighting/shaders/instancing/LOD/animation/camera, graphics presets; never defines authoritative ecology.
- `persistence`: versioned, validated, recoverable snapshots.
- `gameplay`: explicit input commands, Observer/Follow/Possess/Release/Experiment/HUD.
- `space` and `fantasy`: future independent, lazy-loaded modules, not early empty scaffolds.

Use deterministic seeded procedural geometry and documented simplifications. Do not simulate every animal at full detail everywhere: nearby individuals detailed, nearby distant activity simplified, unloaded regions statistical summaries with consistent individual identities. No animal teleports/respawns when camera or chunks change. No global all-to-all entity scans. Support migration across region boundaries later without resetting state.

## MVP: Reclaimed Valley
Build a connected **~2 km²** playable landscape with forest/river, abandoned settlement, century-old waste dump/scrapyard and meadow/wetland; transitions should feel seamless. Terrain collision, flowing water visuals, naturally placed vegetation/ruins, weather, day/night, atmospheric light and environmental sound. Waste features persistent plastics/metal, scavengers and contaminated soil rather than fresh groceries remaining intact 100 years.

Initial six ecologically suitable species: spotted deer/chital, wild boar, golden jackal, Indian hare, house crow, common myna. Add abstract invertebrates/fungi/microbes where appropriate. Avoid tigers in this tiny valley: true territory is much larger. Animals model hunger, thirst, fatigue, fear, perception, shelter, territory/home range, reproduction, aging, death, and social needs where appropriate. Predators should hunt for food, prey should sense limited threats, plant resources should deplete and regrow, carcasses should feed scavengers and nutrients. No global omniscience.

Observer: WASD/mouse/vertical travel, configurable speed, selection and follow. Wildlife: walking/running/deer eating/drinking/resting/escaping while continuous biology applies. Experiment: rain/resource/population changes, seeded reset, 1×/10×/100× and reliable accelerated days, charts of real data. Clean HUD, start/pause/settings/save, graphics controls, keyboard/mouse, basic supported touch controls, optional gamepad.

## Realism
Three different commitments must be protected:
1. **Visual ambition**: naturalistic, eventually photorealistic atmospheric lighting, believable scale, animation and composition; prototype quality must be honestly labeled.
2. **Behavioral plausibility**: animals perceive only nearby cues and exhibit species-appropriate decisions, not triggered animations.
3. **Ecological causality**: finite resources, environmental forcing, interaction feedback, births/deaths and interesting changes over long simulated time.
A calibrated Earth ecology, exact radiological model, accurate astronomical time/distance, or proven photorealism is **not** implied by a functioning prototype. Document trade-offs and uncertainty.

## Initial performance contract
Same authoritative ecology across graphical presets. Aim for 60 FPS desktop and 30 FPS supported midrange mobile on **identified hardware**, with p95 frame timing reported; ~300 MB mobile footprint where reliably measurable; prefer <10 MB initial compressed download with lazy environment assets. No fabricated GPU metrics or untested physical-device claims.

Initial quality Low/Medium/High/Ultra + Auto. Reduce internal resolution, shadow maps, expensive water/reflections/fog, cosmetic foliage, particles, terrain/animal render LOD, and draw distance. Keep ecological state unchanged. Runtime adaptation uses measured smoothed frame time, cooldown/hysteresis, device hints only for initial guess. No unnecessary uncapped 140 FPS if user targets 60. Proper ownership, disposal, bounded resource caches, context-loss handling.

## Persistence and security
IndexedDB world seed, simulation time, authoritative animal/ecology/water/weather state, player camera/mode, experiments and preferences. Validate save schema/version; handle unsupported, blocked, corrupted or too-new saves gracefully. No mandatory network services. Use original or appropriately licensed assets/audio. Preserve repository work; avoid destructive operations.

## Development milestones and gates
- **M0 Foundation**: install/typecheck/build, renderer camera, input, error handling, diagnostics; actual navigable browser 3D scene.
- **M1 World**: streamed connected valley with four biomes, terrain/collision, LOD, vegetation/settlement/waste; no blocking reloads/leaks.
- **M2 Environment**: daylight/weather/moisture/wind/water/vegetation feedback; reproducible causal environment variation.
- **M3 Living ecosystem**: six species, resource-limited biology, sensor-based AI, feeding/predation/carcasses/breeding/mortality and abstract populations; deterministic 100-day headless run and scientific caveats.
- **M4 Hybrid play**: follow, control/release deer, Experiment and time acceleration, meaningful population/resource dashboard; identity persists.
- **M5 Beta proof**: saves/migrations, adaptive graphics, mobile controls, natural audio, offline caching where supported, automated browser tests and physical-hardware performance evidence. No P0/P1 defect.
- **M6+ Expansions**: Curiosity Mode, Social Lens and world registry; ocean, desert, large post-human cities/UNESCO landmarks, seasonal, prehistoric, space, optional mythic Eden/dragons/unicorns, alien encounters only when appropriate.

**Original implementation sequence:** inspect working directory, establish reproducible baseline, build first visible 3D scene, implement each milestone incrementally, run real tests and visually inspect when tools exist. Do not stop at writing plans. When resource/session limits occur, leave working code and honest documentation. The existing repository has progressed beyond M1; resume from actual code, not from scratch.

## Definition of first playable
A player opens a supported desktop browser, explores the four areas, watches autonomous wildlife, takes over the same deer then releases it, changes weather, advances days and sees ecological consequences, saves and restores, changes quality, and encounters no known critical failure. The ecosystem persists independently of camera presence. Build/test results, device evidence and limitations are mandatory.

## Final engineering report
For every verified milestone report actual code paths, runnable commands, unit/headless/browser test results, measured hardware specs if relevant, known bugs, deferred goals, before/after visuals and next step. See `docs/QUALITY_GATES.md`.
