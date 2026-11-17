# Multi-species Wildlife Mode: architecture and UX design (issue #32)

Status: **design for review. No implementation.** The playable roster stays chital-only until this design is accepted
and each species passes its own gates.

## 1. Principle
Possession changes only **where intent comes from**: the player instead of the decision layer. It never changes what the
animal is.
- Perception, physiology, stamina, mortality, collisions, food consumption, predation and every ecological consequence
  run through the same code for a possessed animal as for an autonomous one.
- Releasing control hands the same individual (same ID, needs, relationships and memories) back to the decision layer
  in a valid state.

## 2. What the code does today (audit of the current possession path)
Possession is `Simulation.setControlled(id)`. Each tick, `actControlled` turns a `ControlInput`
`{mx, mz, run, action: 'eat' | 'drink' | 'rest' | null}` into behaviour.

**Asymmetries that break the principle.** These must be fixed whether or not more species become playable:

| # | Where | Asymmetry | Consequence |
|---|---|---|---|
| P1 | Hourly background hazard: `if (… && !a.controlled)` | A possessed animal is **exempt from background mortality** | The player's animal is safer than its wild counterpart |
| P2 | `suitablePrey`: `if (o.controlled && osp.id !== 'chital') return false` | Possessed non-chital animals can never be prey | Hard-coded around the current roster |
| P3 | Perception: `hunter = … && !a.controlled` | A possessed predator has no prey perception | A possessed jackal could not be told where prey is |
| P4 | `decide()` returns early for controlled animals, before the flood/water-escape rule | A possessed animal gets no involuntary reflexes | It never scrambles out of rising water. Probably right for intent, but reflexes need an explicit rule (§4.4) |
| P5 | `cull()` skips controlled animals | Experiment culls spare the player | Acceptable (a UI experiment), but should be documented |
| P6 | `actControlled` sets `beh = Flee` when sprinting and `Wander` otherwise | Behaviour labels drive other animals' reactions and the renderer's animation | A sprinting player chital is "fleeing" to every observer, and AI herd-mates may stampede for no reason |
| P7 | `ControlInput.action` is a closed union of chital actions | Eat means grazing (`forageAt`) | A jackal cannot "eat" by grazing |
| P8 | The controlled target is clamped to 8 m from the edge | Consistent with the edge wall (B1 fix) | — |

**Issue #31's observation** ("jackals seem unaware of an approaching player chital") is not a possession bug. Jackals
have no response to approaching non-prey, non-threat animals for *any* chital, possessed or not. It is handled in #31
(jackal awareness), not here.

## 3. Action-capability framework
### 3.1 Capabilities are declared per species, as data
Each `SpeciesDef` gains `capabilities: Capability[]`, plus parameters per capability. A capability is a named verb with:
- **preconditions**, a pure function of world and animal state, such as "on the ground", "water within reach", "carcass
  within 1.5 m" or "stamina above x";
- **an effect**, a call into the **same** simulation routine the decision layer uses: `forageAt`, `drink`, `feedOn`,
  `startChase`, `rest`, a takeoff routine;
- **a behaviour label**, which other animals and the renderer observe;
- **a cost**: energy, stamina, exposure;
- **UI metadata**: label, icon and key hint.

```ts
type CapabilityId =
  | 'walk' | 'run' | 'sprint'            // locomotion (speeds from SpeciesDef, stamina from physiology)
  | 'graze' | 'browse' | 'root'          // herbivore feeding (chital, boar)
  | 'scavenge' | 'stalk' | 'pounce'      // carnivore (jackal)
  | 'drink' | 'rest' | 'wallow'          // shared, species-gated
  | 'alarm' | 'defend' | 'charge'        // social / anti-predator (boar, chital mother: #31)
  | 'freeze' | 'hideInForm'              // hare (depends on the hare-refuge feature)
  | 'takeoff' | 'land' | 'perch' | 'climb' | 'glide'; // birds
```

**Example: the jackal.**
- Its eat-type capability is `scavenge`, which needs a carcass within reach and calls the same `feedOn` routine.
- It also has `stalk` (slower and quieter, which lowers prey detection by the existing perception rules) and `pounce`
  (a short burst that resolves by the same capture roll AI jackals use).
- There is no `graze`.

**Example: a bird.** It gets `takeoff`, `land` and `perch`, and its movement axes include altitude (§4.2).

### 3.2 Intent, not behaviour, crosses the boundary
`ControlInput` becomes:

```ts
interface ControlIntent {
  move: { x: number; z: number; y?: number }; // y only for species with a flight capability
  gait: 'walk' | 'run' | 'sprint';
  verb: CapabilityId | null;                  // held or triggered
  target?: number;                            // entity id, when the verb needs one (pounce, scavenge, defend)
}
```

**Validation.** The simulation, not the UI, checks every intent against the species' capabilities and preconditions.
- An invalid intent is ignored, with a reason the UI can show ("no carcass in reach").
- The UI can never invoke an effect that the species or its state does not allow.

**Behaviour labels.** They come from what the animal is physically doing. A sprinting possessed chital is `Run`, not
`Flee`, unless a threat is actually perceived. This fixes P6 and keeps observer reactions honest.

### 3.3 One rule set (fixes P1–P3)
- **P1:** the background hazard applies to possessed animals. A UI-level "documentary safety" option, if ever wanted,
  would be a declared experiment mode, recorded in saves and excluded from ecological metrics. It is not proposed now.
- **P2:** prey suitability depends only on the prey animal's state (#31's prey-selection model), never on `controlled`.
- **P3:** a possessed predator perceives prey as usual. The UI shows what it perceives.

## 4. Species designs (in the proposed order)
Each species becomes playable only when its capabilities, tests and UX pass review. `playable` stays the single roster
switch, but it may be set only for a species whose capability list is complete.

### 4.1 Wild boar (first)
- **Capabilities:** walk, run, sprint, `root` (forage at the existing boar intake, with a visible ground-disturbance
  event), drink, `wallow` (uses `locomotion.wallows`; cools and costs time), rest, `alarm`, `defend` and `charge`.
- **`defend` and `charge`** depend on #31's sow-defence model, so the possessed sow uses the same mechanics as an AI
  sow:
  - `defend` is a stand-and-face posture that raises deterrence of approaching predators through the perception path,
    not through a probability discount;
  - `charge` is a short directed burst at a perceived threat. It costs stamina, and can injure or deter, using the same
    contact rule as AI charges.
- **Piglets** follow the possessed sow autonomously (#31).
- **Risk:** charging can injure the sow. Consequences are real.

### 4.2 Hare (second)
- **Capabilities:** walk, run, sprint (zig-zag is emergent from steering at speed), `freeze`, `hideInForm`, rest,
  graze and drink.
- **`freeze`** lowers the hare's detectability by the existing perception model (stationary and cryptic) but does not
  shield it from a predator already tracking it. That matches the owner's rule for refuges.
- **`hideInForm`** requires the hare-refuge feature (cover and forms). It stays disabled until that PR lands.
- **UX:** an "exposure" indicator derived from current detectability (cover, motion, light). It is not a stealth meter
  invented for the UI.

### 4.3 Jackal (third)
- **Capabilities:** walk, run, sprint, `stalk`, `pounce`, `scavenge`, drink, rest, and `mark`, a territorial scent
  event visible to the territory model, which has no effect beyond what #28 defines.
- **Hunting:**
  - Pounce success uses the same capture computation as AI chases (prey state, distance, stamina).
  - A failed pounce costs stamina, and prey that was alerted stays alert.
  - Prey that are dangerous (healthy adult boar) can injure the jackal, using #31's risk model.
- **Territory:** a possessed resident keeps its territory slot. A possessed floater can claim or join only through the
  #28 rules, triggered by where the player takes it.
- **Pack mate:** follows autonomously.
- **Open boundary (#29):** possessed animals never exit. For the player the edge stays a wall.

### 4.4 Birds (fourth)
- **Capabilities:** `takeoff`, `land`, `perch`, `glide`, and walk on the ground.
- **Controls:** flight is controlled by heading plus climb and descend. Altitude is bounded by the existing flight
  model.
- **Landing:** uses the existing safe-landing logic (`nearestStandable`, never over deep water). `land` near a perch
  snaps to the perch through `findPerch`, as AI birds do.
- **Edge:** the B1 fix applies; one wall for all modes.
- **Camera:** needs a flight-follow mode, which belongs to the renderer and GPT-6's camera work. The interface is only
  the bird's authoritative pose.

### 4.5 Reflexes while possessed (fixes P4)
Some responses are involuntary for any animal: scrambling out of deep water it cannot swim in, and the startle at a
very close predator.
- The proposal is a small explicit **reflex layer** that runs for possessed animals too, and overrides input briefly.
- It is limited to physical safety rules already in the decision layer, and the UI says why control was overridden.
- Everything else stays the player's choice, including bad choices.

## 5. UX
- **Selection.** Any animal can be inspected. A "Become" prompt appears only for playable species and adults (as
  today), plus juveniles past weaning for hare and boar if the owner wants.
- **Action bar.** Generated from the species' capabilities. Each button shows its precondition state (enabled, or
  disabled with a reason). Keys map to slots, not to fixed verbs: `E` is the primary feeding verb (graze, root or
  scavenge), `F` drink, `R` rest, `Q` the species' anti-predator verb, `Space` takeoff or land for birds.
- **Awareness cues.** Diegetic where possible:
  - the possessed animal's head turns toward perceived threats (the renderer reads the perceived-threat ID);
  - a subtle edge indicator shows the threat direction;
  - offspring status appears for mothers (#31 D).
  - Cues only show what the animal perceives, never omniscient information.
- **Release.** `setControlled(null)` hands the animal back mid-state. The decision layer re-plans on the next tick from
  current needs and perception: no teleport, no reset of needs, behaviour continuity where valid. For example, a resting
  animal keeps resting until its timer or needs say otherwise.

## 6. Tests required for each enabled species
1. **Select and control:** the same ID before and after; needs and relationships unchanged by possession.
2. **Movement:** gaits at four tick sizes. Edge wall, water and building rules identical to AI movement (reuse the
   locomotion tests with `controlled = true`).
3. **Each capability:** preconditions honoured; the effect uses the shared routine (intake and drink amounts equal to
   the AI path for the same state); invalid intents rejected with a reason.
4. **Same consequences:** a possessed animal can be killed by predators and by the background hazard, and can starve.
   It is prey or not according to its state only.
5. **Release:** autonomous decision on the next tick, identical state hash between a possess-and-release and a direct
   assignment of the same intents.
6. **Save/load while possessed:** possession is not saved as an ecological state. On load the animal is autonomous, or
   re-possessed by the UI, without drift.
7. **Playwright:** select, become, move, use one species-specific verb, release, and verify continued autonomous
   behaviour, for each enabled species.

## 7. Implementation phases (after review)
1. **Framework, chital only:**
   - capability data and the `ControlIntent` validator;
   - map chital's existing eat, drink and rest onto `graze`, `drink` and `rest`;
   - fix P1–P3 and P6;
   - tests.
   - Behaviour must stay equivalent, except for the declared P1 and P6 changes, which are measured with paired seeds
     because they change outcomes.
2. Boar, after #31's sow defence exists.
3. Hare, after the hare-refuge PR, for `hideInForm`.
4. Jackal, after #29 and #31 settle the territory and risk model.
5. Birds, after a flight camera contract with the rendering owner.

## 8. Ownership
- **Claude:** the capability framework, the simulation effects, the reflex layer, the tests.
- **Rendering and animation (GPT-6):** animation states driven by the authoritative behaviour label and pose; the camera
  modes.
- The shared contract is the published read-only animation contract, extended with new labels (`Run`, `Root`,
  `Wallow`, `Defend`, `Charge`, `Freeze`, `Takeoff`, `Land`, `Perch`). No animation is inferred independently in the
  renderer.
