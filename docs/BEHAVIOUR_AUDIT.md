# Common-sense behaviour audit (Mission 1, read-only)

Branch `audit/common-sense-behavior`, based on integration `5cf7b4a` (PR #20 merged). **No simulation behaviour was
changed.**
- Instrument: `benchmarks/ecology/plausibility.ts`, a read-only observer. `tests/unit/plausibility-audit.test.ts`
  proves the state hash and both RNG streams are identical with it attached.
- Runner: `benchmarks/behaviour-audit.ts`.
- Evidence: `docs/evidence/behaviour/audit-10d-seeds1-3.json` (per run) and `…-aggregate.txt`.

Run: seeds 1–3, 10 game days from the initial state, at the four fixed ticks the game uses: 1× (0.1 s), 10× (0.25 s),
100× (1 s) and 1000× (2 s). That is about 7,600–7,750 animal-days per speed.

Rates are per 100 animal-days (episodes) or as a share of the species' time (exposure). An episode is one entry into a
state. At 1×, an animal on a boundary (e.g. a shoreline) can flicker in and out, which inflates episode counts. For
state categories, **time share is the reliable measure**; episode counts matter for step events.

## How the current code produces the behaviour (inspection)
| Area | What the code does | Consequence |
|---|---|---|
| Ground step (`move`) | Moves `speed × dt` along the heading and checks only the **end point** with `passable()`. There is no sweep along the step. Steering looks ahead at 3 sample distances. | At 1000× ground steps are mostly 2–10 m, with 2–4% over 10 m, so a step can jump over a shoreline or a wall corner. |
| Water | `passable()` stops only animals under 5 kg at depth > 0.3 m. Everything else may enter water of any depth at 40% speed (`depth > 0.45`). Steering adds a deep-water cost (jackal 1.4, others 0.6). | Chital, boar and jackals swim without a swimming state, effort or risk. Hares cannot even escape into water. |
| Forage target | Candidate patches exclude water deeper than 0.15 m, but "stay where I am" is always a candidate and is not checked for depth. | An animal that ends up in the river (after fleeing or crossing) can graze there. |
| Rest | From a wet spot, searches for dry ground within 3/6/10 m, else rests in place. | Resting in water when no dry ground lies within 10 m. |
| Birds and water | Water-seeking birds fly to the **centre** of a wet cell (`findWater` returns the cell's water point) and land there. The drink probe triggers at once because the bird is standing in water. | Crows and mynas stand in 0.7–1.35 m of river water: the "walking on water" case. |
| Flight | Constant speed, turn rate limited to `2.2 × dt` rad. It descends when within 9 m of the target. | At small ticks a bird whose target is close and slow-moving (a perched mother, a roost) **orbits it indefinitely**. |
| Activity cycle | Vision drops at night, and behaviours with an activity term (forage, rest, stalk) follow the day. Carrion, following the mother and the critical-thirst trip have no activity term. | Diurnal birds fly to carcasses in darkness. |
| Renderer (`AnimalView`) | Picks the swimming pose from geometry (`waterSurface − exact terrain height > 0.45 × scale`), not from simulation state. Near the camera it uses exact terrain height, while the simulation uses a 4 m grid. | Birds standing in the river render as swimming crows. Wade/swim can disagree between simulation and screen. |

## Findings by category (seeds 1–3, 10 game days)
Each row is a mechanism; the verdict says whether it is a genuine violation, legitimate behaviour, or a detector
artefact.

### 1. Birds standing in deep water: **genuine, all speeds**
- Crows spend 1.1–2.0% of their time on the ground in water deeper than 0.1 m, mynas 1.5–2.7%. Much of this is in
  water over 1 m deep.
- Behaviour at entry:
  - water-seeking (landing at the cell centre);
  - fledglings following their mother into the river;
  - foraging in place;
  - wandering.
- Crows and mynas do not swim or stand in deep water; they drink at the edge or in the shallows.

### 2. Ground animals in deep water (> 0.45 m): **partly legitimate, mechanism implausible**
- Time share by species:

  | Species | Share of time in deep water |
  |---|---|
  | Chital | 0.9–1.6% |
  | Boar | 1.3–2.7% |
  | Jackal | 0.07–0.13% (strong avoidance) |
  | Hare | ~0% (blocked) |

- Entries split roughly in half:
  - fleeing or crossing, which could be legitimate for swimmers;
  - foraging, wandering or rejoining the herd, i.e. casual travel through a 1.4 m deep river with no effort.
- Evidence on swimming ability (this session's searches; secondary sources only):
  - **Wild boar:** widely described as strong swimmers that cross rivers.
  - **Hares:** can swim but avoid water, entering it mainly to escape (non-authoritative sources).
  - **Chital and golden jackal:** no direct evidence found.
- Capabilities for those two must therefore be marked as assumptions until sourced.

### 3. Feeding in deep water: **genuine, all speeds**
- Chital 0.4–0.6% of time, boar 0.3–0.7%, crows 0.4–0.6%, mynas 0.7–0.9%.
- Cause: the unchecked "forage where I stand" candidate.
- Grazing in more than 0.45 m of water is not plausible for these species. This does not cover feeding in shallow
  water, which is legitimate and is not flagged.

### 4. Resting or idling in water (> 0.1 m)
- **Jackal 0.4–1.4% of time:** questionable. These are shallow-water rests at the river margin (0.1–0.45 m),
  typically right after drinking, where the 10 m dry-spot search failed.
- **Boar 0.2–0.4%:** legitimate. Boar wallow, so this should be an explicit behaviour rather than an accident.
- **Chital 0.15–0.6%:** questionable.
- **Birds < 0.12%:** genuine, standing idle in the river after landing there.

### 5. Shoreline skipping: **genuine, 1000× only**
- Zero at 1×, 10× and 100×.
- At 1000×:

  | Species | Skips per 100 animal-days |
  |---|---|
  | Jackal | 9.4 |
  | Boar | 2.2 |
  | Chital | 0.6 |
  | Hare | 0.6 |

- These are single 23–25 m steps across 1.4–1.6 m deep river while fleeing or chasing. They include a hare, which
  cannot enter that water at all: it **jumped the river**.
- This changes predator–prey access at high speed: chases and escapes cross the river without paying its cost.

### 6. Passing through buildings: **genuine, rare, 100× only**
- 0.15–1.4 per 100 animal-days. These are 7–12 m steps through a wall corner (fledglings following their mother, a
  fleeing hare).
- None at 1× or 10×. At 1000× the larger steering look-ahead catches walls.

### 7. Slopes: **artefact, negligible**
- A handful of sub-metre steps at grade 0.96–1.00 against the 0.95 limit.
- Bilinear interpolation noise; no action needed.

### 8. Birds orbiting targets: **genuine, low speeds**
- "Stuck hours" for crows and mynas: 2.6–2.9% of their time at 1× and up to 4.1% at 10×, falling to 0.03–0.14% at
  100–1000×.
- These are not stuck animals. They are flying in circles at 4–8 m altitude: a 480 m path for 1 m of net displacement
  in an hour.
- They are mostly fledglings following a perched mother, plus some fleeing or wandering birds.
- This is the classic seek-with-limited-turning orbit. Visually, it reads as the "aimless" movement.

### 9. Unreachable carcass loop (jackals): **genuine, all speeds**
- **10–32 times per jackal per day**, a jackal re-chooses a carcass it abandoned unreached within the previous two
  hours (e.g. jackal 75 re-targeting 598,395 every ~8 minutes).
- At 1× jackals also spend 4.3% of their time "stuck" approaching carrion.
- The carcass lies across or in water the jackal avoids. The progress check abandons the approach, and nothing stops
  the next decision choosing it again.
- This is the secondary mechanism behind Mission 4's thirst deaths. Since PR #20 it no longer kills, but it wastes
  time and reads as pacing back and forth.
- Crows show a smaller water-seeking retry loop at 1–10×.

### 10. Diurnal birds travelling in darkness: **partly genuine**
- Crows fly in darkness (daylight < 0.1) 3–10% of their time, mynas 2–9%.
- Roost flights at dusk are legitimate.
- Carcass trips at night (the largest share), fledglings following, and some water trips are not.
- Cause: carrion and following have no activity term.

### 11. Unsafe roosting: **none found**
- No bird settled to roost on the ground (`findPerch` always found a perch).
- At 1× birds briefly sit at 0.5 m below their perch while climbing vertically onto it. That is a visual quirk (a
  helicopter-like final ascent), not a safety issue.

### 12. Aimless time
- Wander is 4–14% of time and Idle under 4%, similar across speeds.
- The impression of aimlessness comes less from Wander itself than from orbiting birds (8), pacing jackals (9) and
  casual river crossings (2).

## Speed dependence summary
| Artefact | 1× | 10× | 100× | 1000× |
|---|---|---|---|---|
| Ground step length (mode) | ≤ 0.5 m | ≤ 1 m | 1–2 m (≤ 3% > 10 m) | 2–10 m (2–4% > 10 m) |
| Shoreline skipping | 0 | 0 | 0 | jackal 9.4 / 100 animal-days |
| Wall passing | 0 | 0 | rare | 0 |
| Bird orbiting | high | high | low | low |
| Jackal carrion loop | high | high | high | high |
| Birds in water, feeding in deep water | present | present | present | present |

Two problems depend on tick size and need integration fixes (sweeping at large ticks, arrival steering for flight at
small ticks). The rest depend on rules and occur at every speed.

## Mission 2 proposal: physical capabilities and movement modes (for approval; not implemented)
One data-driven layer for every species, replacing scattered special cases (`mass < 5`, `sp.id === 'jackal' ? 1.4`).

1. **`SpeciesDef.locomotion`** with:
   - `wadeDepth` (default from body size: about belly height ≈ 0.45 × shoulder height, shoulder height from mass where
     unsourced);
   - `swim`: `none | escape | capable | strong`;
   - `swimSpeedFactor`;
   - `swimCostPerHour` (stamina and energy drain);
   - `waterAversion` (route cost);
   - slope limits.

   Each value records its evidence grade. Starting values:

   | Species | Swim | Evidence |
   |---|---|---|
   | Boar | strong | secondary sources |
   | Hare | escape (only while fleeing) | non-authoritative |
   | Chital | capable | **assumption** |
   | Jackal | capable, high aversion | **assumption**; current avoidance kept |
   | Crow, myna | none, shallow edge only | |

2. **Movement mode per animal** (`walk | wade | swim | fly | perched`), computed by the simulation every tick from
   depth, capability and altitude, saved with the animal, and read by the renderer. The renderer stops deciding from
   its own geometry.
3. **Generic water rules:**
   - no entry beyond `wadeDepth` without swim capability (escape-only species may enter while fleeing);
   - swimming costs effort and is chosen only when the route benefit exceeds the aversion cost;
   - no Rest, Forage or Idle while swimming (the "forage here" candidate gets the same depth test as other candidates;
     the rest search ends on dry ground or on the nearest shore);
   - legitimate wallowing for boar as an explicit rest variant in shallow water.
4. **Birds and water:** a water-seeking bird targets the nearest shallow edge point (≤ its wade depth) on the way to
   the water, never the channel centre. Fledglings on the ground do not follow into water.
5. **Bounded swept movement:**
   - Each ground step is split into at most K sub-steps of at most L metres (proposal L = 1 m, K = 8).
   - Each sub-step is checked for walls, grade and water entry.
   - If `step / L > K`, the animal moves at most K × L and loses the remainder, a deterministic speed cap at extreme
     ticks.
   - No unbounded loops. The cost is benchmarked at 250 / 1k / 10k animals before and after.
6. **Flight arrival steering:** within the turning radius, slow down and allow tighter turns ("arrive"), so birds land
   or perch instead of orbiting.

Validation plan for Mission 2:
- this audit's categories before and after at all four speeds;
- 15 seeds × 365 days for ecological consequences (predator access, water access, starvation, thirst, extinctions);
- population-scaling benchmarks;
- save/load and determinism tests;
- browser screenshots of wade, swim and fly states.

## Mission 3: behavioural foundations (design direction; separate later PRs)
All of these should cost per group or per small fixed slot, not per-animal planning.
- **Failed-target memory:** two decaying slots per animal (position plus expiry) so an abandoned destination is not
  re-chosen for a while. This removes the jackal carrion loop (finding 9) and is the smallest first step.
- **Remembered places:** a few sites per group (water, safe rest, food patch, danger) with decay, shared within a
  herd, pair or flock and saved. Purposeful travel to these sites replaces random wandering.
- **Activity gating:** behaviours without an activity term (carrion, following, travel) respect the species' activity
  pattern unless there is an emergency. This is the generic version of PR #20's darkness deferral (finding 10).
- **Condition-dependent risk:** one risk-tolerance value from hunger, thirst and health scales flight distance,
  deep-water aversion and willingness to cross open ground. This follows the asset-protection idea that animals with
  more to lose take fewer risks.
- **Group decisions:** herd movement starts when a quorum of members want to go, instead of each member regrouping
  independently.

None of this is implemented here. The audit changes no simulation behaviour.
