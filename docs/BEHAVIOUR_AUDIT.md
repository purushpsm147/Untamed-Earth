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

---

# Mission 2: physical capabilities and movement (implemented on `fix/physical-locomotion`)

## What changed
| Area | Change | Replaces |
|---|---|---|
| `SpeciesDef.locomotion` | `wadeDepth`, `swim` (none / escape / capable / strong), `swimSpeed`, `waterAversion`, `wallows`, `evidence`. Deep wading lies between `wadeDepth` and `swimDepth` = 2 × `wadeDepth`; swimming is deeper than that. | `mass < 5` (small mammals), the jackal-only water cost, the global 0.45 m / 0.4× rule |
| `Animal.mode` | walk / wade / swim / fly / perch, computed by the simulation each tick and saved. The renderer draws swimming only when the simulation says so. | The renderer guessing from terrain geometry |
| Water entry | No walking deeper than `wadeDepth` unless the species may swim (escape-only species while fleeing). Retreat to shallower water is always allowed. | |
| Swimming | Effortful: hunger as for sprinting, energy −0.15/h, no recovery. Speed × `swimSpeed`; deep wading × 0.6. | Free 0.4× movement |
| Feeding | "Forage where I stand" passes the same depth test as other patches. Feeding depth ≤ min(0.15 m, `wadeDepth`): shallow-water feeding stays allowed. | Unchecked "here" candidate |
| Resting | Dry-spot search out to 35 m with a shallowest-spot fallback. Wallowing species (boar) may rest in water up to `wadeDepth`. | 10 m search, else rest in place |
| Flooding | Any grounded animal in water it may not be in heads for the shallowest ground. Birds tolerate up to 2 × `wadeDepth` so small rises at the edge don't flush them. | Small mammals only |
| Birds and water | Water-seeking birds target the first standable point on the way to the water. No flyer touches down on water deeper than it can stand in. A flyer with no standable landing point within 60 m gives the destination up rather than hovering. | Landing at the channel centre |
| Reachability | Animals don't choose a carcass lying in water they may not enter. | |
| Swept movement | **Continuous sweep (after review):** each ground step is walked in samples of ≤ 1 m, at most 32 per tick, each checked for walls, region edge and forbidden water, using the slower of the depth speed factors at its start and end. The longest step at any current speed is ~25 m, so every step is checked at 1 m resolution; only a step over 32 m (none today) would be sampled more coarsely. *(The first version used ≤ 8 sub-steps that lengthened at extreme ticks; see below.)* | End-point-only check |
| Steering | Never samples ground beyond the destination, so a target at the water's edge isn't judged blocked by the water behind it. | |
| Flight arrival | Inside twice its turning radius a flyer slows (radius halves) and turns harder, then snaps to a target within one step. | Constant-speed orbiting |

**Deviation from the approved proposal (sub-step length) — superseded by the continuous sweep.** The proposal said that
if a step needs more than 8 × 1 m, the remainder is lost.
- Implemented instead: always ≤ 8 sub-steps, but at extreme ticks each sub-step is longer, up to ~3 m for a running
  jackal at 1000×.
- Reason: discarding the remainder caps every runner at 4 m/s at 1000× (jackal 11.5 → 4, hare 12 → 4). That would
  change chase outcomes and all 1000× ecology evidence through an integration artefact, not a mechanism.
- Cost: features narrower than ~3 m can still be clipped at 1000×. The final audit found 0.19 chital shoreline skips
  per 100 chital-days at 1000× (from 0.64; jackal 9.4 → 0, boar 2.2 → 0, hare 0.6 → 0) and no wall passes.
- The strict rule is a one-line change if you prefer it.

## Evidence grades of the capability values
| Species | wade / swim depth | swim | aversion | wallows | Evidence |
|---|---|---|---|---|---|
| Chital | 0.45 / 0.9 m | capable | 0.6 | no | wade: body size; swimming: **assumption** |
| Boar | 0.35 / 0.7 m | strong | 0.5 | yes | wade: body size; strong swimmer, wallower: secondary sources |
| Jackal | 0.22 / 0.44 m | capable | 1.4 | no | wade: body size; swimming: **assumption**; aversion: existing value |
| Hare | 0.15 / 0.3 m | escape | 3 (last resort) | no | wade: body size; escape swimming: non-authoritative sources |
| Crow | 0.05 m | none | — | no | drinks at the edge or in shallows |
| Myna | 0.04 m | none | — | no | drinks at the edge or in shallows |

## Tests
- `tests/unit/locomotion.test.ts` (9 cases):
  - capability table present;
  - a bird stops at its wade depth;
  - a thirsty bird drinks at the edge;
  - a hare won't enter deep water unless fleeing;
  - no grazing in deep water;
  - rest heads for dry ground, while a wallowing boar rests in shallows;
  - modes (swim, fly) survive save/load, and swimming is effortful;
  - flight arrival reaches a 6 m perch at 1× instead of orbiting;
  - the audit over 10 days shows no shoreline skipping at 1000×, no wall passing at 100×, and birds in water < 0.02% of
    time.
- `tests/unit/behaviour.test.ts`: the hare invariant now reads "no hare in deep water *except while escaping*", the
  intended rule change (every deep-water hare in 10 days was fleeing).

## Results (final build `cb80568`)
Evidence lives in `docs/evidence/behaviour/`: `mission2-audit-10d-seeds1-3.json`, `mission2-audit-compare.txt`,
`mission2-ecology-15-seeds.json` and `mission2-perf.txt`.

### Audit, before → after (seeds 1–3, 10 game days; % of time, or episodes per 100 animal-days for step events)
| Finding | 1× | 10× | 100× | 1000× |
|---|---|---|---|---|
| Crows standing in water | 1.11 → 0 | 1.59 → 0 | 2.28 → 0 | 2.01 → 0 |
| Mynas standing in water | 1.50 → 0 | 1.61 → 0 | 1.68 → 0 | 2.68 → 0 |
| Birds feeding in deep water (myna) | 0.93 → 0 | 0.82 → 0 | 0.71 → 0 | 0.88 → 0 |
| Chital feeding in deep water | 0.37 → 0.10 | 0.43 → 0.04 | 0.59 → 0.07 | 0.42 → 0.07 |
| Jackals resting in water | 0.37 → 0.002 | 0.91 → 0.02 | 1.43 → 0.02 | 0.80 → 0.04 |
| Chital resting in water | 0.15 → 0.02 | 0.40 → 0.03 | 0.57 → 0.02 | 0.62 → 0.03 |
| Boar resting in water (wallowing, intended) | 0.36 → 1.17 | 0.23 → 1.39 | 0.34 → 2.06 | 0.23 → 2.53 |
| Shoreline skips (jackal / boar / hare / chital) | 0 | 0 | 0 | 9.4 / 2.2 / 0.6 / 0.64 → 0 / 0 / 0 / 0.19 |
| Passing through walls (all species) | 0 | 0 | 3.0 → 0 | 0.05 → 0 |
| Birds orbiting / stuck (crow) | 2.56 → 0.08 | 4.06 → 0.05 | 0.54 → 0.05 | 0.14 → 0.12 |
| Diurnal birds travelling in darkness (crow) | 10.4 → 3.8 | 10.8 → 4.0 | 2.9 → 3.7 | 4.0 → 2.8 |

Residuals, for Mission 3 rather than for this PR:
- **Retry loops** (re-choosing an abandoned destination):
  - Hares 0.2 → 28 per 100 hare-days at 1×. Their 15 cm wade limit now blocks routes they used to wade, and nothing
    remembers that the target is unreachable.
  - Chital 10 → 45 at 1×, with similar values at other speeds.
  - Jackal carcass loops improved at 1× (3,244 → 935) but rose at 10–1000× (about 1,600 → 2,170). Deep wading now
    costs jackals from 22 cm.
  - Jackal stuck time rose at 10–1000× (1.2 → 2.2% at 10×).
  - All of these are the failed-target-memory problem (finding 9). The fix belongs in Mission 3, not in water rules.
- **Grade:** marginal sub-metre exceedances for hares (0.5 → 1.3 per 100 hare-days at 10×). Interpolation noise.
- **Darkness travel** remains 2–4% of crow and myna time (carrion trips). Activity gating is Mission 3.

### Ecology: 15 seeds × 365 game days (≈ 7.6 life-years), identical weather, against integration `5cf7b4a`
| Measure | baseline | this PR |
|---|---|---|
| Extinct: chital / jackal / hare | 3 / 8 / 4 of 15 | 3 / 5 / 5 of 15 (Fisher p 1.0 / 0.46 / 1.0) |
| All six persist | 3/15 | 5/15 |
| Median day-365 chital / boar / jackal / hare / crow / myna | 6 / 11 / 0 / 9 / 67 / 64 | 5 / 14 / 1 / 36 / 68 / 62 |
| Hare: median minimum after day 30 / CV days 183–365 | 5 / 0.79 | 14 / 0.44 |
| Chases / kills (total) | 31,767 / 4,072 | 42,723 / 5,032 |
| Kills per chase | 0.128 | 0.118 |
| Kills per jackal-day | 0.125 | **0.149** |
| Predation: hare / chital / boar | 2,651 / 534 / 887 | 3,317 / 629 / 1,086 |
| Starvation: hare / chital / boar / myna | 3,098 / 877 / 1,473 / 142 | 2,335 / 826 / 1,592 / 181 |
| Dehydration: chital / hare / crow / myna | 9 / 16 / 9 / 5 | 19 / 18 / 12 / 14 |

**Interpretation.**
- **Predator access rose.** Kills per jackal-day are up 19% and chases up 34%, even though kills per chase fell.
  Plausible contributors:
  - Prey can no longer escape by jumping the river at 1000×.
  - Steering no longer refuses destinations at the water's edge, so jackals can now approach prey there.

  This is a mechanism change, not tuning, but it moves the predator–prey balance and is reported as such.
- **Hares are better off despite more predation.** Less starvation and much less boom-and-bust.
- **Extinction differences are not significant at n = 15.**
- **Dehydration rose modestly for chital and mynas** (small absolute numbers). An intermediate build showed crow 76 and
  myna 42 dehydration deaths from birds hovering over water with nowhere to land. That was fixed before this
  measurement (commit `cb80568`).

### Performance (single runs on one container; same machine, sequential)
`node --import tsx benchmarks/locomotion-bench.ts`, ms per tick:

| Animals | 1× before → after | 1000× before → after |
|---|---|---|
| 250 | 0.66 → 0.85 | 1.14 → 1.12 |
| 1,000 | 1.66 → 1.53 | 2.91 → 3.34 |
| 5,000 | 6.21 → 6.67 | 33.4 → 34.0 |
| 10,000 | 18.9 → 21.4 | 151 → 154 |

- The sub-step loop and landing checks cost about 0–15% at large populations.
- The 1000× cost at 10k animals is dominated by existing per-tick work, not movement.
- No new per-tick allocations: sub-steps use locals; the landing search allocates a small result object only on
  landing decisions.


---

# Review response (PR #25, November 17)
Owner review on #25: keep the longer steps rather than a speed cap, but provide a real boundary check for the residual
1000× crossings, quantify the navigation loops, evaluate ecology with paired seeds, and capture visual evidence.

## 1. Residual high-speed crossings: bounded continuous sweep and a regression
- **The residual cases were** fleeing chital crossing a band only 0.45–0.47 m deep. With ~3 m sub-steps, the
  deep-wading slowdown was applied only from the start of each sub-step, so part of the crossing ran at full speed.
- **Movement now uses a continuous sweep:** ≤ 1 m samples, at most 32 per tick, with each sample's speed set by the
  slower of its start and end depth. No distance is lost and work stays bounded.
- **The audit detector is now physical and species-aware.** `shorelineSkip` flags:
  - a step that went more than 1 m (the sweep's resolution) beyond what the species could cover through that depth
    profile in one tick at full running speed;
  - more than 1 m of water the species may not enter.

  The Mission 1 fixed-0.45 m definition is kept as `shorelineSkipLegacy`.
- **Regression** (`tests/unit/locomotion.test.ts`, seed 3 at 1000× for 10 days, the residual case):

  | Build | Violations |
  |---|---|
  | 8-sub-step build | **37** (hares, chital and jackals entering or leaving the river faster than their wading or swimming speed allows) |
  | Continuous sweep | **0** |

- **Final audit** (seeds 1–3, 10 days, all four speeds): species-aware violations are **0** at every speed.
  `shorelineSkipLegacy` still counts 0.19 per 100 chital-days at 1000×. Those are chital deep-wading 0.45–0.47 m water
  at the correct 0.6× speed, which their capabilities allow.
- **Remaining limitation (stated, not claimed away):**
  - Resolution is 1 m, so a band of forbidden or swimming-depth water narrower than 1 m can still be crossed within one
    sample.
  - A step longer than 32 m would be sampled more coarsely. No current speed produces one.

## 2. Navigation loops
This PR's stricter water rules raised retry loops: hares 0.2 → 28 per 100 hare-days at 1×, chital 10 → 45, jackal carcass
loops at 10–1000×. These are addressed by the Mission 3 PR (failed-target memory, stacked on this one), not by
loosening the rules. See that PR for the numbers.

## 3. Ecology with paired seeds
`benchmarks/ecology-paired.ts` compares per seed (same seeds, identical weather) and uses sign tests. Final build
(`eea57e1`) against integration `5cf7b4a`, 15 seeds × 365 days:

| Measure | baseline → this PR (median) | seeds higher / lower / tied | sign test p |
|---|---|---|---|
| Hare end population | 9 → 5 (paired median diff 0) | 7 / 7 / 1 | 1.0 |
| Hare minimum after day 30 | 5 → 3 | 6 / 8 / 1 | 0.79 |
| Kills per jackal-day | 0.149 → 0.157 | 10 / 5 / 0 | 0.30 |
| Jackal-days | 1,943 → 1,390 | 6 / 9 / 0 | 0.61 |
| Crow end population | 67 → 80 | 10 / 5 / 0 | 0.30 |
| Myna dehydration deaths | 0 → 1 | 7 / 1 / 7 | 0.07 |

Extinction, as newly extinct / rescued seeds:
- **Chital:** 3 → 2 of 15 (newly extinct [7], rescued [3, 14]).
- **Jackal:** 8 → 9 (newly extinct [1, 6, 14], rescued [13, 15]).
- **Hare:** 4 → 4 (newly extinct [11, 14, 15], rescued [6, 9, 13]).

**Correction to the earlier Results section.**
- The first report said hares were "better off" (median end 9 → 36). That came from an earlier build, and comparing
  medians of independent samples hid seed-to-seed swings.
- With the final build and paired seeds, no ecological measure changes significantly at n = 15.
- Kills per jackal-day are higher in 10 of 15 seeds. That is a tendency toward more predator access, not an established
  effect.

## 4. Visual evidence (normal game route, real simulation state)
`tests/e2e/locomotion-capture.spec.ts` (opt-in project `locomotion-capture`, not in `test:e2e`):
- advances the real simulation until it finds an animal swimming, wading in 0.15–0.4 m of water, or climbing after
  take-off, in daylight;
- pauses the simulation at that moment so the camera reaches the animal in exactly that state;
- takes a screenshot, and records the simulation mode against rendered height, water surface and ground.

Images: `docs/evidence/behaviour/screens/`.

| Capture | Simulation state | Rendered | Assessment |
|---|---|---|---|
| `swim.png` | chital, mode swim, 1.31 m deep | body centre 0.18 m below the surface; head and back above | Plausible. Behaviour label "Foraging" (crossing to a patch) may read oddly to players |
| `wade.png` | chital, mode wade, 0.25 m deep | standing on the bed, body 0.4 m above the water, legs in it | Plausible |
| `takeoff.png` | myna, mode fly, climbing 0.5 → 1.0 m by the bank | correct height | State correct, but the follow camera frames a 25 cm bird too far away to judge take-off motion. A close-up framing would be needed |

Not verified: animation continuity across mode changes (wade → swim → wade), which needs a video review by the owner.
The project records video, but nobody has reviewed it.

## 5. Integration
- Integration (including #19's geometry-accounting fix) was merged into #24's branch and then into this one, by merge
  rather than force-push.
- #24 is still undecided by the owner, so this PR still targets it.

## 6. Performance after the continuous sweep
`node --import tsx benchmarks/locomotion-bench.ts`, ms per tick; single runs, same container, run one after another,
so differences under ~10% are noise:

| Animals | baseline `5cf7b4a` 1× / 1000× | first #25 build (8 sub-steps) 1× / 1000× | final (1 m sweep, ≤ 32 samples) 1× / 1000× |
|---|---|---|---|
| 250 | 0.66 / 1.14 | 0.85 / 1.12 | 0.68 / 0.99 |
| 1,000 | 1.66 / 2.91 | 1.53 / 3.34 | 1.22 / 3.08 |
| 5,000 | 6.21 / 33.4 | 6.67 / 34.0 | 6.46 / 31.0 |
| 10,000 | 18.9 / 151 | 21.4 / 154 | 19.3 / 144 |

The 1 m sweep costs no more than the 8-sub-step version did. Most animals move far less than 1 m per tick, and terrain
samples are bilinear lookups.

## 7. Edge wall correction (B1, issue #29 audit)
The valley boundary audit (`docs/OPEN_BOUNDARY_AUDIT.md`, branch `audit/valley-boundary`) found that flight was clamped
to 4 m from the edge while ground movement refused anything within 6 m. A bird that landed in the 4–6 m strip could not
take a single ground step. In seed 21 of the #28 code, 24 mynas died of dehydration and 12 of starvation there.

**Fix.**
- `EDGE_WALL = 6` now governs every movement mode: `passable`, `terrainCost`, `drinkable` and the flight clamps.
- Anything on the ground inside the strip walks straight inward. This also covers old saves.
- Movement destinations are clamped to the wall.
  - The first commit exposed a second trap: a roost perch at z = 4 m lay beyond the new wall. The bird stopped 2 m
    short, and `Roost` keeps flying while the remaining distance is over 1 m.
  - In seed 18, 9 mynas starved hovering there. The destination clamp makes arrival reachable.

**Tests.** `tests/unit/edge-wall.test.ts` has 12 cases: strip escape, flight clamp and roost arrival, each at the 1×,
10×, 100× and 1000× ticks. Every case fails on the code before its fix.

**Paired check** (8 seeds × 365 days at the 1000× tick, integration before and after; `docs/evidence/b1/`):

| Measure | Before | After |
|---|---|---|
| Edge pinning, myna + crow | 265 h | 0 h |
| Bird deaths within 8 m of the edge | 26 | 8 |
| Animals outside the region | 0 | 0 |

**What 8 seeds cannot show.**
- Abundance changes cannot be read from this run. Any bird near an edge now follows a different path, so every
  seed's trajectory diverges (the hash checkpoints changed; see `hashes-after.txt`).
- Species totals over 8 seeds moved in both directions. Bird animal-days were higher in 5/8 seeds for myna and 4/8 for
  crow. Hare and jackal sums also moved, but the seed-level signs were mixed.
- No population parameter was changed.
