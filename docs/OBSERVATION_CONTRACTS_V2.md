# Observation contracts v2: proposal for graphics, audio and gameplay (ecology lead)

**Status: proposal. Nothing here is implemented.** Changing shared contracts requires director approval on GitHub.
v1 is `docs/INTEGRATION_CONTRACTS.md` / `packages/ecology/src/observe.ts` (`OBSERVE_CONTRACT_VERSION = 1`), and its
rules stay in force: read-only; no invented ecology; a single event bus; determinism (the simulation hash is identical
with observers attached); per-frame budgets; owned lifecycles.

**Why a v2.** The open boundary (#29/PR #34) and maternal behaviour (#31/PR #35) introduce state that presentation and
gameplay layers will want. Today these layers can only reach it by reading `Animal` internals (`transit`, `origin`,
`young`, `targetId`, `threatX/Z`), which rule 1 forbids and which would couple the renderer to the unaccepted draft
branches. Each item below names its source of truth, its consumers and its acceptance test. Every item is
**additive**: existing fields keep their meaning, and new behaviour ids are appended.

## Principles
1. **Truth first.** Every observable field is derived from authoritative simulation state at query time. It is never
   cached by presentation, and never smoothed in a way that changes its meaning. Smoothing belongs to the pose layer.
2. **Perception, not omniscience.** Fields that describe what an animal *knows* (`attentionTarget`, `threat`) expose
   only what the simulation's own perception produced. A UI must not reveal an off-screen predator unless the
   animal perceived it.
3. **Off-map animals are not observable.** `sim.regional` animals have coarse positions and are never rendered,
   heard or picked. Only animals in `sim.animals` are visible, including those in transit through the 24 m corridor.
4. **Gated by state.** v2 fields return neutral values (`transit: 0`, `residency: 'resident'`, `attentionTarget:
   null`) on builds without the feature. Consumers therefore work on the closed baseline and on the drafts alike.

## 1. `AnimalMotionView` additions (graphics, camera, UI)
| Field | Type | Source | Consumer and use |
|---|---|---|---|
| `transit` | `-1 \| 0 \| 1` | `Animal.transit` | Renderer: use exact terrain height (already done in `AnimalView`). Camera: follow into the corridor (open item on PR #34, entry occlusion). UI: "leaving / arriving" label |
| `residency` | `'resident' \| 'visitor' \| 'settled-immigrant'` | `origin`, `settled` | Inspect panel and Social Lens. Distinguishes a visitor from an immigrant establishing residence (owner comment on #29). Never shown as "spawned" |
| `attentionTarget` | `{ id, x, z } \| null` | `targetId` while in `Alert`, `Stalk`, `Chase`, `Defend`, `Follow`; `threatX/Z` while in `Flee` | Head and ear orientation (#31 acceptance A: "head-turn must reflect authoritative decisions"). The pose layer turns the head toward it within neck limits |
| `dependentYoungId` | `number` (0 = none) | `young` when alive, on-map and below weaning age | Mother-young framing; maternal UI |
| `posture` | `'standing' \| 'lying' \| 'crouched-hidden'` | `beh` ∈ {`Rest`, `Roost`} → `lying`; `Hide` → `crouched-hidden` | One authoritative lie/hide flag so the pose layer does not infer it from the behaviour list (#31 B: a resting fawn must actually lie down) |
| `territoryRole` | `'breeder' \| 'helper' \| 'floater' \| null` | `territories` (jackal) | Social Lens; gameplay goals for a future playable jackal (#32) |

**Acceptance.** `tests/unit/observe-contracts.test.ts` is extended so that:
- every field reads the stated source at four ticks;
- the hash is unchanged with a v2 observer attached;
- v2 runs on the closed baseline with neutral values;
- `animalsNear` never returns a `sim.regional` animal.

## 2. `EcoAudioEvent` additions (audio)
Every new kind is emitted **by the simulation at the moment of the state transition**. There is no polling in audio.
Every kind maps 1:1 to a `SimEvent` that a unit scenario can trigger.

| kind | When | Notes |
|---|---|---|
| `alert` | an animal enters `Alert` (jackal watching an approaching deer) | quiet; distance-attenuated; no call by default (jackals often watch silently) |
| `defend` | a mother enters `Defend` | chital: foot-stamp and alarm bark; boar: grunt and charge onset |
| `contact` | a charge reaches its target (≤ 1.8 m) | `injured: boolean` |
| `abandon-hunt` | a predator gives up a hunt because a guardian closed in | no sound required; useful for documentary and curiosity scoring |
| `young-call` | a hidden or separated dependent is ≥ X m from its mother | **not implemented in either draft**: needs a simulation trigger first; listed so that audio does not invent it |
| `exit` / `entry` | an animal crosses the region edge in the corridor | for the soundscape and documentary, not for UI spam. `kind: excursion \| emigration \| flee \| return \| visit` |

Rule: `alarm` stays the only herd-propagated danger signal. Audio never triggers fear in other animals; the
simulation does that through its own perception.

## 3. Gameplay contracts (Wildlife Mode, #32)
- `youngThreat(motherId) → { distanceM, predatorId } | null` exists on PR #35. Promote it into `observe.ts`, so the
  HUD does not call simulation internals.
- `ControlIntent` validation (design in `docs/MULTI_SPECIES_CONTROL.md` on `design/multi-species-control`): the
  simulation validates player actions and owns the behaviour label. A sprinting player animal must not be labelled
  `flee` unless it has perceived a threat. That asymmetry is listed in the #32 audit.
- **Possession and the boundary.** Possessed animals never cross; already implemented and tested. The UI must explain
  this ("the valley edge: your animal will not leave") rather than show an invisible wall.
- **Same rules for AI and player.** The #32 audit found that a possessed animal is exempt from background mortality.
  That is an ecology asymmetry and must be fixed in ecology. It is not a presentation option.

## 4. Ecology dashboard and experiment observables
These are the metrics the evaluation measures. A dashboard showing them must not present a different definition.
- **Local abundance** (`sim.population(i)`) is distinct from **resident-lineage abundance** (`origin` 0) and from
  **regional abundance** (`sim.regional`, opt-in "landscape" view only).
- **Migration counters** (`MigrationStats`): excursion, emigration, flee exit, aborted exit, return, visit,
  settlement, departure, off-map births and deaths, pursuit captured and escaped. A departure is **never** shown as
  a death.
- **Conservation identity**: on-map + off-map + deaths + departures = founders + births. The dashboard can show it
  as a live integrity check.

## 5. Performance budgets (to be measured, not claimed)
- `motionView` with the v2 fields: no allocation beyond the existing view object. `attentionTarget` reuses a
  per-view object.
- New audio kinds: emission rate per game hour to be measured at 1×/10×/100×/1000× on 3 seeds. Audio caps voices
  regardless.
- Open boundary: peak on-map plus transit actor count, from the 60-seed evaluation (`daily.pops`). Near-camera actor
  count stays bounded by the existing culling path.

## 6. Sequencing
1. The director approves this proposal (GitHub issue).
2. Ecology implements the v2 fields behind `OBSERVE_CONTRACT_VERSION = 2`, with tests, on top of whichever of PR
   #34 and #35 is accepted. Neutral defaults apply on the closed build.
3. Graphics (head orientation, lying and hiding poses, corridor camera) and audio (new kinds) integrate one item at
   a time, with screenshots and listening reviews as in v1.
