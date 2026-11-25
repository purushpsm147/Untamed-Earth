# AUD-01 audio handover: ecological spatial soundscape

Owner: AUD-01 (Claude session `session_01MD7GqQnvbKmagdfGEfBYd1`). Branch `ccr-ac77381d-jc0jh8`, draft PR #44 (not for
merge). Director desk: issue #36. Director tasks handled: **AUD-02** (comment 7131976786), AUD part of **OPS-02**.
This file is the continuation checkpoint: a restarted worker should read it first (section 12).

## 1. Status in the charter's four categories

| Category | State |
|---|---|
| **Implemented** | Isolated slice `apps/web/src/audio/eco/*`, lab `/?audiolab=1` (`apps/web/src/lab/audio/*`), six listening scenarios, offline recorder, evidence pipeline |
| **Software-verified** | Unit 28 tests (`tests/unit/eco-audio.test.ts`), browser 7 gates (`tests/e2e/audio-lab.spec.ts`, project `audio`), headless Chromium 158 on Linux with SwiftShader, no audio device |
| **Physically verified** | **Nothing.** No speakers, headphones, phone or human listener were available to this session |
| **Creatively accepted** | **Nothing.** Authenticity, naturalness and localisation need the human listening review in section 8 |

No synthesised call is claimed to sound like the real species.

## 2. Audit of previous audio work

### 2.1 Production `AudioEngine.ts` (on the integration branch)
- One `AudioContext`, created by `start()` on a user gesture: master gain (volume, mute), then a compressor, then the destination. `setSuspended()` runs on tab visibility. These are sound foundations.
- Beds: one 3 s mono noise buffer, looped through three fixed filters (wind, rain, river), plus a continuous 4.3 kHz cricket tone chopped at 31 Hz.
- Calls: `update()` rolls `Math.random()` every 0.5 s against **counts** of crows, mynas and jackals near the camera, then plays a myna, crow or howl with **random stereo pan**, not at the bird's position. `Game.ts` plays `audio.alarm(0.8)`, which is **not spatial**, for a chital `alarm` event near the camera.
- Findings that matter for integration:
  - The count-driven calls are invented events by the rule in `INTEGRATION_CONTRACTS.md` §2. The sound claims "a crow called here", but no crow did anything.
  - Directions are random.
  - The 3 s loop repeats audibly (by design inspection; not listened to).
  - Not changed by AUD-01. Production is untouched apart from one additive getter (section 6).

### 2.2 PR #11: Gemini `NaturalSoundscape` experiment (open, not merged)
Recoverable: branch `experiment/gemini-natural-soundscape`, head `e2b3012a0282199ed03d6b0bd19850f3fcdb013b` (fetched and read in full). Files:
- `apps/web/src/lab/NaturalSoundscape.ts` (671 lines)
- `NaturalSoundscapeDemo.ts` (264)
- `SoundscapeAuditionExporter.ts` (398)
- `docs/NATURAL_SOUNDSCAPE.md`
- `tests/unit/natural-soundscape.test.ts`
- `tests/e2e/natural-soundscape.spec.ts`
- a CI step that uploads the 48 s WAV as an artifact (7-day retention; the run was on 2026-11-16, so the artifact has presumably expired; not checked)

| Aspect | What it does | Assessment |
|---|---|---|
| AudioContext | `start()` creates **its own** `AudioContext`; `dispose()` closes it | Violates the single-context rule (AUDIO_INTEGRATION.md §2). Not reusable as is |
| Animal calls | Every 1.6 s: if any nearby chital has `fear > 0.3`, play `chital_alarm`; otherwise play a myna or crow call from a bird chosen by `elapsedSec * 3 % n` | **Invents calls.** It polls fear instead of using `alarm` events, and runs a timer instead of behaviour. A frightened deer that emitted no event is voiced, against contract §2 |
| Spatialisation | HRTF `PannerNode` per call at world position; listener position and forward set | Listener `up` never set; positions set with `setValueAtTime` (zipper risk); no occlusion |
| Lifecycle | One-shot oscillators and filters are created per call and **never disconnected**; `activeSources` holds only the bed sources | Leaks nodes over time (rulebook 12/13) |
| Beds | 7.5 s stereo noise, separate river body and riffle (LFO-swept band-pass), wind plus leaf rustle, rain, 2-carrier cricket tone with 24 Hz LFO | Good layering ideas: separate body/riffle, leaf band. Fixed LFO rates are periodic |
| Pure targets | `computeLayerTargets(input)` returns layer gains and is unit-tested | Good pattern; reused as an idea (the planner is pure and unit-tested) |
| Exporter | `encodeAudioBufferToWavBlob`; a 48 s scripted reel through `OfflineAudioContext` with `StereoPannerNode` | The WAV writer is reusable in principle (rewritten in `render.ts`). The reel is **not** a capture of the simulation. Its doc says so, correctly |
| Tests | Gain-target arithmetic; browser start, mute and attenuation | No routing, leak, determinism or event-provenance gate |

### 2.3 `docs/AUDIO_INTEGRATION.md` and observation contracts
- `AUDIO_INTEGRATION.md` (design only) specified a `CallRouter` with the following, and acceptance gates. The slice implements all of them (section 4):
  - audibility
  - dedupe and cooldown
  - time-acceleration gate
  - voice budget of 8 with a 50 ms steal fade
  - HRTF/equal-power `PannerNode`, inverse model, ref 8–10 m
  - listener smoothing
  - per-voice disconnect
  - determinism
- `observe.ts` v1 contracts are used unchanged: `onAudioEvents`, `ambientConditions`, `localHabitat`, `motionView`. Terrain is read through `valley.heightFast` and the `env.forest` grid, which presentation already does (INTEGRATION_CONTRACTS.md §1). The slice never sets `sim.focus`.

### 2.4 Licensing
Every sound in the slice is **original procedural synthesis**: oscillators, filtered seeded noise, generated chorus buffers. There are **no samples, recordings or third-party audio assets**, and no new dependencies. PR #11's code is project code; its ideas (river riffle layer, leaf band, pure target function) are credited here, and no code was copied verbatim. The Abyssal Garden project was not used.

## 3. Reusable components (now in the slice)

| Component | File | Purpose |
|---|---|---|
| `CallRouter` | `audio/eco/callRouter.ts` | Real events only. Range per species, per-animal cooldown, merging (0.3 s / 15 m), throttle above 10× and mute above 100×, an explicit drop reason for each event |
| Repertoire | `audio/eco/repertoire.ts` | Per species: documented behaviour basis, or **explicit silence** with a reason |
| `SoundscapePlanner` | `audio/eco/planner.ts` | Pure: beds from weather, time and habitat; day part; lulls; movement from gait; state-derived calls (lab only); provenance |
| Acoustics | `audio/eco/acoustics.ts` | Inverse distance (mirrors Web Audio), azimuth, air absorption, terrain and foliage occlusion |
| `VoicePool` | `audio/eco/voicePool.ts` | Per-category caps plus a total cap, decided on the audio clock (correct for scheduled-ahead frames) |
| Synth | `audio/eco/synth.ts` | Two-phase voices (`plan` then `build`), every node registered for disposal; chorus buffers (cricket, cicada, frog) |
| `EcoSoundscape` | `audio/eco/EcoSoundscape.ts` | Web Audio runtime on a **host** context (the game's, or offline); listener, beds, voices, cues, `dispose()` |
| Observation | `audio/eco/observation.ts` | `FrameBuilder` (contracts only) and `EcoAudioObserver` (subscribe/unsubscribe) |
| Scenarios | `audio/eco/scenarios.ts` | Six deterministic listening scenarios; event look-ahead on a snapshot clone |
| Recorder | `lab/audio/render.ts` | Offline render with just-in-time scheduling at suspend points; WAV writer; HRTF calibration |

## 4. Design and evidence policy

- **Sources of sound, by provenance** (AUD-02; every cue carries one):
  - `sim-event`: alarm or kill from `Simulation.events`, routed by `CallRouter`.
  - `animal-state`: movement (footfalls, splashes, take-offs, wingbeats from gait, speed and altitude) and, in the lab only, state-derived calls. These carry `vocalEventSimulated: false`, and the cue text says "not a simulated vocal event".
  - `environment`: beds and thunder.
  - `test-harness`: synthetic gate input only.
  - A runtime invariant throws if an event call lacks event provenance, or a state call lacks animal-state provenance.
- **State-derived calls are off by default** (`PLANNER_DEFAULTS.stateCalls = false`) and lab-only with a separate switch. Examples: crow and myna roost choruses at twilight, daytime contact calls, jackal group choruses at night, foraging boar grunts. The primary recordings have them off; a labelled A/B pair has them on.
- **Silence is a decision.** Hare alarm is silent: no known alarm vocalisation. Births and non-predation deaths are silent. Prey distress is voiced only for hares (screams are documented for the genus *Lepus*); other prey get the scuffle only. See `SILENT` in `repertoire.ts`.
- **Day parts** come from sun elevation and hour, measured in each recording's octave bands:
  - Night: cricket chorus at a temperature-dependent chirp rate (Dolbear's relation used for shape only, not species data); frogs only in Monsoon/Post-monsoon near water.
  - Hot forest days: cicadas.
  - Dawn: bird activity scaled up (lab state calls only).
- **Variation and silence:**
  - Long seeded noise buffers with non-commensurate lengths.
  - Chorus layers in pairs of different lengths (combined repeat after lcm, several minutes).
  - Wind gusts and lulls on mean-reverting random processes.
  - Every call re-randomises its syllables and timing from a seeded presentation RNG, separate from the simulation.
- **Propagation:**
  - Inverse distance on the `PannerNode`.
  - Low-pass for air absorption.
  - About −6 dB per 100 m of full forest, plus a lower cutoff.
  - Up to −14 dB and a ~700 Hz cutoff behind terrain.
  - River occlusion updated twice per second.
  - These are perceptual approximations, not calibrated (ISO 9613 is referenced qualitatively only).

## 5. Verification (commands actually run, this container)

| Command | Result |
|---|---|
| `npm ci`, `npm run typecheck` | OK |
| `npm test` | 23 files, **160/160** passed (28 of them in `eco-audio`) |
| `npm run build` | OK. Main bundle +0.9 kB gzip in total (hook and getter, plus a slightly larger shared ecology chunk); lab is a lazy chunk of 21 kB gzip |
| `npx playwright test --project=audio` | **7/7** passed (headless Chromium 158, `--autoplay-policy=user-gesture-required`) |
| `npm run audio:render` then `python3 benchmarks/audio-evidence.py` | 8 recordings + calibration, then `docs/evidence/audio/` |
| CI on PR #44 | Green on `3eb6f27` and `34f1b36` (check suites completed). Later heads pending at the time of writing |

Not run this session: `npm run test:e2e` across all projects (smoke, reliability, gameplay, documentary are other workstreams' gates; CI runs them). The `audio` project was added to `test:e2e`.

### Browser gates and measured values (copied to `docs/evidence/audio/gates.json`)
1. **Autoplay:**
   - 0 AudioContexts before the gesture.
   - Exactly 1, `running`, after clicking "Start sound".
   - Still 1 after three restarts.
   - Stop leaves the shared context running and nothing of the soundscape connected.
2. **Routing:**
   - One alarm (gate input, `test-harness` provenance) produced one voice: nodes went 42 → 66 → 42 after the voice ended plus the 0.3 s tail.
   - A hare alarm was dropped as `unsupported`.
3. **Voice budget:** 40 simultaneous alarms gave peak 8 active voices (cap 8), 30 rejected, 2 stolen voices in their 50 ms fade at the sample. Fading voices are gone within 1 s, and nodes return to the bed baseline.
4. **Observe only:** simulation hash after 300 ticks with the full soundscape running equals the no-audio reference (2580346954).
5. **Direction** (HRTF calibration, listener at a non-axis yaw):
   - At +90° the right channel is +11.9 dB over the left, and at −90° the mirror image.
   - At 0° and 180° the channels are equal.
   - Equal-power panning is hard-panned at ±90°.
6. **Recording:**
   - Two offline renders of `predator-alarm` (60 s) differ by at most 1e-8 to 5e-7 (−126 to −159 dBFS across runs), and the cue lists are identical.
   - The target real chital alarm sounds at 41.45 s (look-ahead: 41.5 s), 45 m away, at azimuth +45°, with `sim-event` provenance.
   - Every event call matches a real event.
   - No state calls by default.
   - Render speed 15× real time.
7. **Cost (live, worst case):** dawn riverbank with every layer on, including lab state calls:
   - Frame cost EWMA **0.47–0.50 ms** over two runs (budget 2 ms) in the software container.
   - Peak 15 voices; about 300 movement sounds and 14 event calls in 8 s; 10–12 rejected by the budget.

### Unit gates (`tests/unit/eco-audio.test.ts`, 28)
- **Router:** range, cooldown, unsupported silence, kill to scuffle plus hare scream, merging, throttle, mute.
- **Pool:** caps, stealing, expiry.
- **Acoustics:** inverse model, azimuth convention, air absorption, ridge and forest occlusion.
- **Repertoire:** every species with predators is either voiced or explicitly silent.
- **Planner:**
  - night vs day beds, dawn/dusk detection, monsoon frogs, rain suppression, chirp rate;
  - silence with no animals;
  - state calls only from real animals in matching states, and none above 10×;
  - jackal chorus joined only by awake members of the same group;
  - footfalls follow distance travelled;
  - one take-off sound; bounded memory; seeded reproducibility.
- **Observe only:** simulation hash unchanged over 1500 steps with the pipeline attached.
- **AUD-02:**
  - production default plays no state calls;
  - state calls and movement carry animal-state provenance;
  - **deterministic replay** of the full decision log from a snapshot, and across a **mid-run save/restore**.

## 6. Shared-interface change (recorded on #36 before use)
`AudioEngine.host`: an additive, read-only getter returning `{ ctx, destination: master }` (null before `start()`).
- The director accepted it for isolated prototype review, **not as production merge approval** (AUD-02).
- `main.ts` has one dynamic-import line for `?audiolab=1`. VIS-01 adds a similar hook for `?slice=riverbank`; the two must be coordinated before integration (OPS-02).
- No other production file is changed.

## 7. Defects found and fixed during the slice (each reproduced by a gate or a measurement first)

| Defect | Evidence | Fix |
|---|---|---|
| Voices stolen by the budget were counted as live (10 > cap 8) | Browser gate 3 | Report active and fading separately. The cap holds for active voices; fading must clear within 1 s |
| Releasing nodes at `ended` cut the filter/HRTF tail at non-reproducible render positions (clicks when live) | Two offline renders differed | Live: release 0.3 s after the last source ends. Offline: release at suspend points |
| Offline renders still differed by ~1e-7 | Measured max \|diff\| −123 dBFS; each bed alone was deterministic | Chromium sums a node's inputs in a run-dependent order (float rounding). The gate is max \|diff\| < 1e-5 (below 16-bit resolution), plus identical cue lists |
| Offline render cost grew with the square of the total voice count (a walking herd rendered at **0.8×** real time) | Movement on/off A/B: about 25 ms of render per footfall voice | Scheduling the whole recording up front kept every future voice connected from t=0. Now frames are scheduled just in time at sample-accurate suspend points and finished voices are released: **11–19×** |
| Event-scan scenario advanced a game hour per retry; the comment said a minute | Scenario conditions showed 21:00 instead of 17:00 | 10 game minutes per retry, 60 retries |
| The look-ahead window was shorter than the recording, so a real kill was missing from the expected list | The gate's "no invented call" assertion caught it | Look-ahead covers the whole recording; the target event must be ≥ 15 s before the end |
| Yaw sign for placing a target at an azimuth was wrong (river came out at −135° instead of +90°) | Headless placement check | `yawToward` = target yaw + azimuth; checked numerically |
| 63–250 Hz within 5 dB of the total in **every** scene (low wind rumble and a constant distant bed) | Octave-band measurement | Ear-level light wind is heard through vegetation; the low wind layer now grows only above ~3 m/s, and the constant bed is halved. Scenes now differ in balance by day part and habitat |
| Save/restore replay test failed | Log diff; the simulation's own save/restore was verified exact | Test bug: float time `i*0.1` vs `100+i*0.1` shifted cooldown edges; the harness now uses integer frame time |

**Archived unsuccessful approach.** A bright band near 1–2 kHz in log-frequency spectrograms was taken for a river-texture problem. A river change was made, did not move the band, and was **reverted**. Measured octave levels showed no peak there: it was a display artefact (`showspectrumpic` with `fscale=log` repeats the same FFT bins in the low rows). Evidence spectrograms now use a linear axis, and every cue sheet includes measured octave bands.

## 8. Recordings and listening protocol (for the owner or another human reviewer)

Files are in `docs/evidence/audio/`: `<scenario>.mp3` (128 kbps listening copy), `<scenario>.jpg` (linear spectrogram), `<scenario>.md` (cue sheet: every sound with time, distance, azimuth, occlusion, level, provenance and cause; real events in range; octave bands), and `index.json` (SHA-256 of the source WAVs, loudness, counts).
- Regenerate them with `npm run build && npm run audio:render && python3 benchmarks/audio-evidence.py`. Same build, same samples to within −120 dBFS, same cues.
- Copies are not normalised: −29 to −43 LUFS at the game's default volume of 0.7. Raise playback volume, and keep it the same across files.

| File | Scene (real seeded world, seed 2, day 34, Monsoon) |
|---|---|
| `calibration.mp3` | Not ecology: noise bursts at 0°, +90° (right), 180°, −90° (left). **Check headphone orientation first** |
| `dawn-riverbank` | 06:06, 12 m from the river (on the right); a real chital herd flees with alarm barks |
| `day-meadow-herd` | 13:00, 18 m from 13 chital; walking footfalls, grass and wind |
| `dusk-roost` | 18:18 near 10 crows/mynas; crickets entering; no event calls in this window |
| `night-wetland` | 22:00 at the wetland; cricket and frog choruses only (no discrete events happened) |
| `predator-alarm` | 20:39; real alarms and a jackal kill of a hare; target chital alarm at 41.5 s, +45° |
| `rain-forest-edge` | 13:27 in rain at the forest edge; real chital alarms |
| `*.lab-state-calls` | **Lab only** A/B of dawn and dusk with state-derived calls on (not simulated vocal events) |

**Listening protocol** (record the results in `docs/QA.md` or on #44):
1. Use headphones in a quiet room with fixed volume. Play `calibration.mp3`: does each burst come from the stated direction?
2. For each scene, read its "listen for" items in `scenarios.ts` and follow the cue sheet. For every event call, note whether you heard it at the stated time and direction (yes/no/unsure).
3. Rate 1–5:
   - (a) believable as a South Asian valley at that time of day;
   - (b) natural variation, with no audible loop;
   - (c) distance and direction plausible;
   - (d) nothing sounds synthetic enough to break immersion.

   List the worst sound per scene.
4. With reference recordings (for example, licensed field recordings the reviewer already has access to; do not add them to the repository), compare the chital alarm, crow, myna, jackal chorus and hare scream. Each call stays `procedural-unverified` until this step passes.
5. Repeat one scene on speakers and in a second browser (Firefox or Safari) in the live lab (`/?audiolab=1`, "Start sound", arrow keys to turn and walk).

Open listening questions (not decided by the agent):
- Is the river at 10 m (dawn) too dominant?
- Is −40 LUFS too quiet at default volume?
- Does the cricket chorus sound like one machine or many insects?
- Are footfalls of a walking herd too dense?

## 9. Limitations and risks
- **No physical or creative verification.** Synthesis parameters are design guesses (`synth.ts` header). The repertoire's behaviour notes are qualitative and field-guide level, not cited measurements.
- **Determinism is per JS engine.** Scenario look-ahead picks different events in Node and Chromium (known: last-bit Math differences). Gates compare within one engine.
- **Simulation coverage limits what can be heard.**
  - Events are only alarm, kill, birth and death.
  - No rut, contact, territorial or roost vocal events.
  - No insects, frogs or other small fauna as entities (abstract grids only).
  - Rich communication soundscapes need simulation events: a decision for ECO-01 and the director.
- **Extended sources.** The river is one point source at the nearest channel point, not a line. Wind has no direction.
- **Live lab only tested headless.** Real devices may differ in HRTF cost and autoplay handling, and Safari's older listener API path is untested.
- **Integration risks:**
  - Production `AudioEngine.update()` still plays count-driven random crow, myna and howl calls with random pan. Integrating the slice means replacing those, not layering on top: double ambience plus an invented-call violation.
  - The `main.ts` hook needs coordinating with VIS-01.
  - Time-acceleration and menu states in `Game.ts` must feed `simRate`.
  - The `sim.focus` camera input must stay owned by `Game`.

## 10. Decisions requested from the director
1. After the human listening review, approve or reject production integration of the **event-driven** layer, beds and movement, with state-derived calls compiled in but default off. This replaces `AudioEngine`'s count-driven calls.
2. Whether ECO-01 should add simulation vocal events (for example contact, roost or jackal chorus), so that state-derived calls can be retired instead of approved.
3. Acceptance thresholds for the human review (proposed: calibration correct; ≥ 80 % of event calls localised to the right side or front; mean rating ≥ 3.5 on (a)–(c); no scene with an audible loop).

## 11. Next steps
1. Owner or human listening review of `docs/evidence/audio/` per section 8, recorded on #44.
2. Fix what the review finds, starting with any call rated below 3.
3. Integration proposal (separate PR after approval):
   - a `Game.ts` adapter feeding `FrameBuilder` with the camera pose and `simRate`;
   - remove count-driven calls from `AudioEngine.update()`;
   - quality hook: HRTF on High/Ultra, equal-power elsewhere;
   - QA-01 e2e helpers for audio gates.

## 12. Restart checklist (task state)
- **Branch** `ccr-ac77381d-jc0jh8`, draft PR #44, subscribed for PR events.
- **Scheduled check** of #36 every 4 h at minute 17 (`trig_01N5ohknmTsGbATog7rM3SiK`). Act only on `DIRECTOR TASK AUD-…:` comments.
- **Handled task IDs:** AUD-02 and OPS-02 (acknowledged on #36 in comment 7148390654).
- **On resume:**
  1. `git status` and `git log`; commit anything uncommitted.
  2. `npm ci`, `npm run typecheck`, `npx vitest run tests/unit/eco-audio.test.ts`, `npm run build && npx playwright test --project=audio`.
- **Don't** touch PR #34, other workstreams' branches, the CI workflow or `TerrainView.ts`. No merges, no paid compute.
