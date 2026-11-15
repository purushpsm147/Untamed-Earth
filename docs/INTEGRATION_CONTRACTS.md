# Integration contracts for visuals and audio (v1)

Owner: Claude (integration). Consumers: Gemini's animal visuals and soundscape, and any future presentation module.
Source: [`packages/ecology/src/observe.ts`](../packages/ecology/src/observe.ts) (exported from `@untamed/ecology`);
tests: `tests/unit/observe-contracts.test.ts`.

## Rules
1. **Read-only.** Presentation code reads through these functions only. It never writes animal fields, never calls
   `Simulation.step`, never positions or poses simulation entities, never emits `Simulation.events`.
2. **No invented ecology.** A sound or animation that claims an animal did something must come from that animal's
   state or a real event. Ambient beds (wind, insects, water, unspecific distant birdsong) come from
   `AmbientConditions`/`LocalHabitat` and must not be presented as specific events.
3. **No second event system.** Audio subscribes with `onAudioEvents(sim, fn)`, a 1:1 adapter over `Simulation.events`,
   and calls the returned unsubscribe in `dispose()`.
4. **Determinism.** Observers may use `Math.random` for presentation (noise buffers, call variation) but must never feed
   anything back. The test suite checks the simulation hash is identical with observers attached.
5. **Budgets.** Query per frame only what is on screen or audible: `animalsNear(sim, x, z, r, out)` reuses `out`.
   Audio should cap concurrent voices and disconnect nodes `onended`.
6. **Lifecycle.** Production uses the game's single `AudioContext` and master gain (mute/volume settings) and the shared
   `WebGLRenderer`. Every geometry, material, texture, render target, audio node and subscription has an owner and an
   idempotent `dispose()`; restarts are covered by `tests/e2e/reliability.spec.ts` (live WebGL object counts).

## 1. Animal motion and animation: `AnimalMotionView`
`motionView(sim, animal)`, `animalsNear(sim, x, z, radius, out?)`

| Field | Meaning |
|---|---|
| `id`, `species`, `sex`, `lifeStage`, `group`, `mother` | Stable identity and relationships |
| `x`, `z`, `alt`, `prevX`, `prevZ`, `prevAlt` | Current and previous-tick position (interpolate with the renderer's alpha); sample terrain for y |
| `heading`, `speed` | Radians (0 = +z toward +x), m/s |
| `behavior` | `idle, wander, graze, travel-to-water, drink, rest, flee, court, stalk, chase, travel-to-carrion, feed, roost, follow-mother` |
| `gait` | `still, walk, trot, run, fly, swim`, from speed relative to the species' own walk/run speeds |
| `fear` | 0..1 perceived danger, for alert posture only |
| `size`, `speciesLength` | Growth fraction and adult body length (m), for scale and camera framing |
| `controlledByPlayer` | Wildlife Mode |

Animation guidance: drive leg phase by **distance travelled**, not time, so feet don't skate. Blend between poses over
0.2–0.4 s. `rest` needs a lying pose (deer spend a large share of the day resting).

## 2. Ecological audio events: `EcoAudioEvent`
`onAudioEvents(sim, fn) → unsubscribe`

| kind | emitted when | animalId | notes |
|---|---|---|---|
| `alarm` | an animal's fear crosses the alarm threshold on perceiving a predator (once per crossing) | the caller | chital alarm bark; herd mates react through the simulation, not through audio |
| `kill` | a predator kills prey | predator | `preyId`, `preySpecies` |
| `birth` | young are born | mother | |
| `death` | any death | the deceased | `cause`; use sparingly (most deaths are silent) |

Fields: `species, x, z, timeH` (game hours), `intensity` 0..1 (suggested loudness from what happened, not measured).

## 3. Ambient conditions: `AmbientConditions`, `LocalHabitat`
`ambientConditions(sim)`: hour, daylight, sun elevation, season, weather, rain, cloud, wind and direction, temperature,
river stage.
`localHabitat(sim, x, z, radius?)`: forest/meadow/wetland/settlement/dump weights, distance to river, water depth,
abstract invertebrate and small-fauna abundance (insect and frog bed intensity), and per-species counts of nearby and
active animals (density of ambient birdsong from real birds).

## Integration path
1. Experimental modules stay behind their opt-in routes (`?soundscape=1`, `?slice=1`) and switch to these functions.
2. Claude integrates one validated component at a time into `Game.ts`/`Engine.ts` with measured acceptance criteria:
   browser screenshots at a fixed pose, live WebGL object counts across restarts, frame time on the profiler, and for
   audio a human listening review.
