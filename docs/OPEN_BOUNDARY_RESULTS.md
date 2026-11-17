# Open valley boundary: implementation evidence and evaluation (issue #29)

Branch `feat/open-boundary`. Design and pre-registration: `docs/OPEN_BOUNDARY_DESIGN.md` (revision 3).
**The 60-seed evaluation is still running; this file records what is verified so far.**

## Verified
**Closed configuration is unchanged.**
- With the boundary closed, the code reproduces `baseline/territories-b1` (configuration C) hash for hash: seeds 1–2,
  days 5 and 20, at dt 2.
- `tests/unit/open-boundary.test.ts` checks the same property against a plain simulation.

**Unit tests (`tests/unit/open-boundary.test.ts`, 17 cases):**
- **Conservation.** on-map + off-map + deaths + departures = founders + all births. Checked every 500 ticks at the
  0.25 s and 2 s ticks.
- **No duplicates.** Every id is either on-map or off-map, never both, and the id map matches.
- **Save/load** (structured clone, as IndexedDB does) continues with an identical hash.
- **No rescue rule.** Over 72 hours of the off-map model, the arrival sequence is identical whether or not the valley
  has been emptied of every animal.
- **Controls.**
  - Zero inflow: nobody enters.
  - No flee exit: the fleeing animal stops at the wall.
  - Possessed animals never cross.
- **Exit and entry.**
  - A visitor exits through the corridor and keeps its identity, at four ticks.
  - A regional animal ranging into the valley enters in transit with its own id.
- **Departure.** Leaving the landscape counts as a departure, not a death.
- **Pursuit.** A pursuit past the outer line is resolved and counted.

**Corridor (`tests/unit/boundary-corridor.test.ts`, 11 cases).**
- Simulation terrain inside the corridor matches the rendered terrain to within 0.61 m with the 4 m lattice.
- Animals in transit now use the exact terrain height:
  - in the simulation, for water depth (`passable`);
  - in the renderer, at any distance (`AnimalView`).
- Continuous walk in and out at four ticks.
- Save/load mid-transit.
- Animals not in transit never enter the corridor.

**Mechanics bug found by smoke runs and fixed before any evaluation run** (design, revision 3). Exit detection at large
ticks: at the 1,000× tick a fleeing hare covers about 24 m per tick and was never seen near the wall, so no flee exit
happened. Detection now uses the distance the animal can cover in the current tick.

## Browser captures (owner decision 4)
Opt-in project: `npx playwright test --project=boundary-capture --trace off`, seed 3, `?boundary=open`, medium quality,
SwiftShader in this container. Both tests pass. Screenshots and numbers are in `docs/evidence/boundary/capture/`. The
videos (85 MB) were not committed; the spec regenerates them.

| Capture | What the simulation state shows |
|---|---|
| Entry (`entry-*.png`, `entry.json`) | Jackal #242, a resident of a straddling territory, is 17 m beyond the north edge in transit +1. While paused, two readings 90 frames apart are identical (same tick, same position). After resuming, it walked in, transit ended, and it was resting 7 m inside |
| Exit (`exit-*.png`) | The same jackal later leaves through the corridor (transit −1). It is visible beside a rock in the corridor |
| Pursuit (`pursuit-*.png`, `pursuit.json`) | Starting positions are staged from real animals (a fleeing hare at x = 22 m, a chasing jackal at 36 m); everything after is the simulation. Both enter the corridor (hare at x = −3.5, jackal following in transit). The chase continued past the outer line and ended in a capture: off-map predation, and the prey's id is gone |

**Grounding.** The rendered body centre is 0.47 m above the exact terrain in every corridor reading, the same offset as
on open ground.

**Outstanding visual issue.** In the entry frame the jackal's body is hidden. Its selection ring, which is drawn without
a depth test, marks the spot.
- The simulation height is exact, and the terrain mesh near the camera samples exact heights every 2 m.
- The likely cause is occlusion by nearer terrain: the observer camera is clamped inside the region (4 m from the edge)
  and looks up the border ridge at an animal 17 m beyond the edge.
- This is **not verified**. The capture did not record the camera position.
- **Proposed fix:** let the observer camera follow into the corridor, with its clamp moved out to −24 m. That is a
  renderer and UX change and is not made here.

## Evaluation status
Configurations A–F, 60 paired seeds × 365 days, run from pinned code. The pre-registration is committed before any
open-boundary run:
- A: `baseline/m2-b1`;
- B: `baseline/memory-b1`;
- C: `baseline/territories-b1`;
- D, E and F: `feat/open-boundary` at `e2246ff`.

Results will be added here with `benchmarks/open-boundary-analysis.py`, followed by the sensitivity runs.
