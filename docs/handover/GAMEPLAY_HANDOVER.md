# Gameplay and documentary experience — handover (UX-01)

Owner: UX-01 (Claude Code session `session_01MD7GqRcW3ts2MijX2aRYdJ`), director desk: issue #36.
Branch: `claude/living-valley-v1-gameplay-8g1v40` (from `ccr-4783fee0-8wvc41` @ `3a0e7f9`). Draft PR: see #36.
Scope: Observer Mode, Wildlife Mode (chital only), Curiosity Mode, Social Lens, camera behaviour, onboarding,
accessibility and interaction design. Out of scope: ecology behaviour (ECO-01), rendering (VIS-01), audio (AUD-01),
CI/release (QA-01). This document is the continuation checkpoint for this workstream; keep it current.

Status vocabulary (charter): **implemented** (code exists), **software-verified** (automated tests pass in
SwiftShader Chromium / Node), **physically verified** (real device), **creatively accepted** (director/owner).

---

## 1. What existed before this workstream (audit)

### Curiosity director — PR #6 (Gemini) + PR #8 (GPT-6), integrated in `e6310ce`
- `apps/web/src/curiosity/CuriosityDirector.ts`: deterministic, read-only, bounded (event buffer 32, cooldown/novelty
  maps 128, ≤64 strided candidates). Score = significance × decay × proximity × novelty × cooldown × visibility.
  Min hold 8 s, hysteresis 1.25×, max hold 22 s, cooldowns. Scenic fallback anchors.
- Integration fixes already in the branch: rotated building footprints used the inverse rotation (and #8's own test
  shared the bug); no speed limit (now 55 m/s, 40 % with reduced motion); runtime reduced motion; events follow their
  animal; Skip excludes the current target (#8); framing by body size with 3.5 m minimum.
- `apps/web/src/game/Curiosity.ts`: adapter, captions with "Simulated:" facts.
- Weaknesses found by this audit (all addressed in §2 unless marked):
  1. Selection re-ran every rendered frame (spec: low frequency).
  2. A strided global sample (every k-th animal of the array) with no neighbourhood priority: most animals were never
     considered in a given frame; choice depended on array order.
  3. No group subjects; no narrative relation between successive subjects.
  4. Distant subjects reached by flying across the valley at up to 55 m/s (several seconds of fast motion).
  5. A constant 0.08 rad/s orbit regardless of subject; no line-of-sight planning beyond one midpoint terrain sample.
  6. `fadeAlpha` was computed but never drawn by the game.
  7. Hysteresis compared a fresh candidate score against the *adoption-time* score of the current subject.
  8. Captions: "Wildlife #123 (wandering)" reasons, no explanation of why a shot was chosen.

### Observer six-DOF controls — PR #23 (GPT-6)
- J/L yaw, I/K pitch, U/O roll, Alt+wheel FOV 24–85°, B level/reset; roll/fov saved optionally. Tested in a paused game.
- Audit: works; free flight has no easing (velocity jumps), follow orbit snaps to the subject when engaged; no
  double-click follow; controls only discoverable in the menu.

### Wildlife Mode / issue #32
- Only chital `playable`. `actControlled()` maps input to walk/run, eat (forage), drink, rest.
- Asymmetries found in #32's design audit (ecology-owned, **not changed here**): sprint labelled `Flee` to observers;
  a possessed animal is exempt from background mortality; possessed non-chital can never be prey; `eat` always grazes.
- Player feedback: need bars, a prompt line, a red fear/health vignette. No sense of where a threat, the herd, or water is.

### Social Lens
- `Game.socialLens()`: group size, mother (alive/same group), offspring, pressures — read from state. Notable events
  came from a session-only array (lost on save/load and on tab close). HANDOFF listed this as a known gap.

### Documentary scenario
- `/?scenario=documentary` (seed 2, day 34, 16:30, camera chosen from the herd; nothing scripted afterwards).
  `docs/DOCUMENTARY.md`, `tests/e2e/documentary.spec.ts`. Kept as the start of the guided journey (§4).

### Abandoned / not merged experiments relevant to UX
- PR #7 Visual Lab (Gemini): not merged (camera underground, invalid timings) — VIS-01 owns.
- PR #12 riverbank/articulated chital, PR #11 soundscape: unmerged, owned by VIS-01 / AUD-01.
- PR #13 skinned chital (V4): rejected, preserved for research.
- `design/multi-species-control` branch (`docs/MULTI_SPECIES_CONTROL.md`): design only, no implementation; species
  expansion remains blocked on ecology capabilities (#31, #29) and is **not** part of V1.

---

## 2. Implemented in this workstream

### 2.1 Documentary director (V1) — `apps/web/src/curiosity/CuriosityDirector.ts`
Public API unchanged (start/interrupt/update/skip/focus/pushEvent/framing/getPose); additive fields only.
- **Cadence:** decisions every 0.5 s (`decisionIntervalSec`), immediately on subject loss or a significant event;
  the camera moves every frame.
- **Candidates:** a cheap score for every living animal (rotating deterministic stride only above 600), groups
  aggregated in one pass (centre, spread, activity, fleeing count, representative member), buffered events. Only a
  short list (≤8) gets line-of-sight evaluation. Bounded: groups ≤256, events 32, maps 128.
- **Group subjects:** `group:<id>` for ≥3 living members; calm herd members are slightly down-weighted as individuals
  so the herd is shown as a herd; a herd with ≥2 animals fleeing gets a large bonus. Group shots frame the measured
  spread (54° FOV) and expose a real representative member for Follow / Become.
- **Continuity:** candidates related to the current subject get a bonus — the prey it is hunting / the predator
  hunting it (1.55×), mother/offspring (1.45×), same group (1.3×), events in the same scene (1.25×). The link is
  recorded (`why: 'continuity'`, `link`) and shown in the caption ("Continuing the story: the animal it was hunting").
- **Ongoing stories** (chase, stalk, flight, feeding, courting; a herd in flight) may be held to 1.6× max hold.
- **Hysteresis** now compares against the current subject's *fresh* score at each decision.
- **Shot planning:** moving animals get a side-on profile shot 25° ahead of perpendicular with leading room in the
  direction of travel; the camera keeps to the side it is already on (180° rule); still subjects keep the current
  viewing angle with a slow drift. Up to 8 azimuths are tested against terrain (6 samples) and ruin footprints for a
  clear line of sight; if none is clear the camera rises.
- **Transitions:** subjects within 160 m (45 m with reduced motion) are reached by the existing speed-capped glide;
  further ones by a cut: fade out 0.45 s → black 0.15 s → relocate (safe: above terrain/water/roofs) → fade in 0.6 s
  (×1.6 with reduced motion). A new cut during a fade-in continues from the current opacity (no flash).
- All existing safety logic (path vs rotated footprints, floor clamps, vertical escape) is unchanged.

### 2.2 Curiosity adapter and captions — `apps/web/src/game/Curiosity.ts`
- Passes an O(1) `find` (the simulation's id map).
- Captions: line 1 names the subject (species, stage, sex, id; or "Spotted deer: herd of 13"); line 2 "Simulated:" facts
  (group behaviour tally and spread, chase target and distance, event age); line 3 "Why this shot" / "Continuing the
  story" plus the subject's latest Social Lens history entry ("Earlier (Day 31 06:10): gave birth to one young").
- Captions are hidden during a cut; the black fade overlay (`#fade`, under the HUD) is drawn from `fadeAlpha`.

### 2.3 Persistent Social Lens history — `apps/web/src/game/SocialChronicle.ts`
- Sources: `Simulation.events` (birth with the young's ids, kill both sides, non-predation deaths, alarms,
  loss of mother for dependent young); a 1 s low-frequency scan for group changes and weaning/maturity crossings
  (labelled "(noticed)"); player possession and release (labelled as the player's).
- Bounded: 12 entries per animal (birth entry kept as anchor), 800 animals (dead evicted first, then least recently
  updated); alarm repeats collapsed.
- Saved as optional `SaveData.chronicle`; restore validates every row and entry and ignores damaged data. The ecology
  `SAVE_VERSION` is unchanged; older saves load with an empty history.
- The Social Lens shows the latest 5 entries with simulation time, and how a dead mother died.

### 2.4 Observer — `apps/web/src/game/Game.ts`, `apps/web/src/input/Input.ts`
- Free-flight velocity eases toward the command (exponential, rate 12/s: ~90 % in 0.2 s, frame-rate independent).
  `debugCamera().speed` still reports the *commanded* speed (existing tests compare it).
- Follow and possession glide from the current camera into the orbit (smoothstep ~0.8 s) instead of snapping.
- Double-click an animal: select and follow (native `dblclick`, so two clicks inside one slow frame still count).
- One context hint line per mode (bottom centre; hidden in Curiosity; menu option "Show control hints").

### 2.5 Wildlife (chital only)
- Status: the simulation's behaviour name plus whether the action can work here ("nothing left to graze here",
  "no water within reach").
- Perception-derived cues, all from the possessed deer's own fields (no omniscient radar): sensed threat direction and
  distance (`threatX/Z`, only while fear > 0.3), own group size / nearest / centre direction, remembered drinking site
  (`waterX/Z`). Directions are relative to the camera (ahead, behind-left, ... with arrows).
- Need meters show ▲/▼ when a value moved by > 1.5 % over the last ~2 s.
- Option: E / F toggle instead of hold (accessibility; off by default).

### 2.6 Onboarding and accessibility
- Field guide: five tips shown on the first visit, in Observer only; each is marked done when the player does it
  (move+look, select, follow/Curiosity, become a deer); "Hide tips" persists (`localStorage untamed.coach`); "Show the
  field guide again" in the menu. Information only: no goals, rewards, scores or unlocks. `?qa=1` starts without it.
- `aria-pressed` on mode, speed and Follow buttons; captions, ticker and toasts are polite live regions; the menu is a
  `role=dialog` with focus moved to Resume; Pause has an `aria-label`; "Larger interface text" option.
- Black cut overlay sits beneath the HUD (`z-index:-1` inside `#hud`) so controls stay visible during a fade.

### 2.7 Guided journey — `docs/JOURNEY.md`, `tests/e2e/journey.spec.ts`
Seven stages from the documentary start: arrival, Social Lens, Curiosity, living as a chital, time and charts,
drought experiment, save/close/Continue with the lived-as deer's history intact. `npm run journey` (compressed) or
`JOURNEY_FULL=1 npm run journey` (~14 min), unedited video + stage screenshots + JSON stage log.

---

## 3. Tests

| Area | Test | Status |
|---|---|---|
| Director (existing 15, Gemini/GPT-6/integration) | `tests/unit/curiosity.test.ts` | pass; the glide-cap test now runs with cuts disabled (`cutDistanceM: Infinity`) so the original assertion is unchanged |
| Director V1 (11 new) | same file: cut only on black + visible speed cap, glide when near, cadence, group shot, herd flight hold, continuity, side-on + LOS avoidance, no fade flash, determinism, pause does not trigger a switch, scattered herds are not group shots | pass |
| Social Lens history (8 new) | `tests/unit/social-chronicle.test.ts`: real participants, hash unchanged, save/load round trip via structured clone, bounds, damaged data, noticed transitions, alarm flood cannot evict notable entries, save between scans is complete | pass |
| Browser: experience (5 new) | `tests/e2e/experience.spec.ts` (in `npm run test:e2e`): history survives save/close/Continue (exact snapshot and lines); documentary Curiosity jumps only with a relocation on black, no caption over black, fade cleared on exit, no internal labels; observer coast-and-settle, double-click follow, follow glide by per-frame sampling; chital cues equal the deer's own state, toggle actions; field guide, hints, ARIA, dialog focus, persisted preferences | pass locally and in CI run 45399663928 |
| Browser: existing Curiosity comfort test | `gameplay.spec.ts:498`: the 25 m per-100 ms step limit now exempts only an interval in which a relocation-on-black happened (limit unchanged) | pass (CI 45399663928) |
| Browser: journey | `tests/e2e/journey.spec.ts` (opt-in, video) | see review package |

Baseline before changes on `3a0e7f9`: typecheck OK, unit 132/132, build OK, browser 19/20 — the failing one is
`gameplay.spec.ts:378` (GPU geometry count varies by 13 > 6 across quality changes at the same place). It is
pre-existing and in QA-01's area; not caused by UX-01.

---

CI on PR #45 (`40f8371`, run 45399663928): 24/25 browser tests; the failure is the pre-existing
`gameplay.spec.ts:378` (also red on the base, reported to QA-01).

Shared-file coordination (DIRECTOR TASK OPS-02: QA owns shared e2e helpers): UX-01 made two additive edits to
`tests/e2e/helpers.ts` (field-guide flag in `enter()`, `debugCuriosity` type); recorded with QA-01 and on PR #45.

### Context loss (DIRECTOR TASK UX-02)
On `webglcontextlost` the game sets `contextLost`: from that frame nothing is simulated or rendered; automatic saves
(120 s autosave, `pagehide`, hidden tab) are refused; the chosen speed is left unchanged and nothing resumes on its own
(including on `webglcontextrestored`). The error card offers an explicit **Save world** (the frozen moment of loss)
and Reload. Regression: `experience.spec.ts` "WebGL context loss stops the world": on the previous code the tick ran
on after the loss (344 -> 647 in 3 s at 100x); now it holds, no autosave is written, the explicit save holds the tick
of the loss and Continue restores it. Limitation: SwiftShader's `WEBGL_lose_context` stands in for a real driver
reset; no physical GPU reset tested.

## 4. Outstanding / next
- Director review of PR #45 and the decisions listed there (cut thresholds, "why this shot" captions default on).
- Human review on real hardware: motion comfort of glides/cuts, readability of HUD at 1080p and on a phone, screen
  reader pass, touch and gamepad (none possible in this container).
- Ecology-owned items surfaced by UX (not changed here, for ECO-01): sprinting is labelled `Flee`; possessed animals
  are exempt from background mortality (#32 audit); jackals ignore an approaching non-prey chital (#31).
- Possible next UX steps (need approval): Curiosity "watch this one" (focus on the selected animal), per-profile
  director tuning (Addendum III profiles), caption verbosity setting, keybinding remap.

## 5. Known limitations
- All evidence is software-rendered (SwiftShader); no GPU, phone, touch, gamepad or screen-reader testing.
- Composition is computed from simulation positions, not the rendered image; foliage occlusion is ignored.
- Group membership is the simulation's `group` id; species with group size < 3 (jackal pairs) are never group subjects.
- History starts when a world is first observed in a build with the chronicle; earlier events are not reconstructed.
