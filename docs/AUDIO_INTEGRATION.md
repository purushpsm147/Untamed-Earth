# Ecological audio: the production integration path

Status: **design and review only.** No new sound is in production from this document.

**Update (AUD-01, draft PR #44):** the router, budget, spatialisation, cleanup and determinism described below are
implemented and software-verified in an isolated slice (`apps/web/src/audio/eco/`, lab `/?audiolab=1`). PR #11 was
audited and superseded for the reasons in `docs/handover/AUDIO_HANDOVER.md` §2.2. Listening acceptance is still open.

## What exists today (production)
- One `AudioContext`, created and owned by `apps/web/src/audio/AudioEngine.ts` on the first user gesture, with a master
  gain (volume, mute), a compressor, wind/water noise beds, a cricket voice and a music bus. Hidden tabs suspend it.
- `Game.ts` subscribes to `Simulation.events` and plays `audio.alarm(0.8)` (non-spatial) for a chital `alarm` event near
  the camera. That is the only event-driven sound.

## The path for real ecological calls
```
Simulation.events ──(1:1)──> onAudioEvents(sim, fn)  [packages/ecology/src/observe.ts]
        │                              │
        │                              ▼
        │                 Game: CallRouter (new, presentation only)
        │                   - audible? (distance to listener, species range)
        │                   - dedupe / cooldown per animal and kind
        │                   - time-acceleration gate
        │                   - voice budget (cap, priority)
        │                              │
        ▼                              ▼
  (no feedback)          AudioEngine.playCall(kind, x, y, z, intensity)
                           - the ONE AudioContext and master gain
                           - one PannerNode per voice, disconnected on end
```

1. **Source of truth.** Calls come only from `onAudioEvents(sim, fn)` (`alarm`, `kill`, `birth`, `death`). Never poll
   `fear`, behaviour or timers to invent a call: a frightened animal that did not emit an `alarm` event is silent.
   Ambient beds (wind, water, insects, unspecific distant birdsong) are driven by `ambientConditions()` and
   `localHabitat()` and must not imitate a specific animal's call.
2. **One context.** The router never creates an `AudioContext`. It calls methods on the game's `AudioEngine`, which
   adds voices to its own graph under the master gain, so volume, mute, suspend-on-hidden and the menu settings apply.
   `OfflineAudioContext` rendering (PR #11's WAV exporter) stays in the lab.
3. **Audibility.** Drop an event when the listener (camera) is beyond the call's range: chital alarm bark ~300 m,
   jackal kill commotion ~150 m, births and most deaths silent (`intensity` <= 0.3 is a hint, not a requirement).
   Use the event's `x, z` and terrain height (+1 m) for `y`.
4. **Deduplication.** The simulation emits one `alarm` per fear threshold crossing, but a herd can produce several in
   the same second. Keep `lastPlayed[animalId + kind]` and skip repeats inside a cooldown (alarm 4 s per animal).
   Optionally merge alarms within 0.3 s and 15 m into one louder voice.
5. **Time acceleration.** At 10x and above, events arrive far faster than real calls could. Play at most one call per
   kind per 2 real seconds above 10x, and none above 100x (the soundscape becomes a bed, not a sequence of calls).
6. **Voice budget.** Cap concurrent call voices (8). When full, drop the new event if its `intensity × proximity` is
   lower than the quietest playing voice, else stop that voice with a 50 ms fade.
7. **Spatialisation.** `PannerNode` with `panningModel: 'HRTF'` on High/Ultra and `'equalpower'` elsewhere,
   `distanceModel: 'inverse'`, `refDistance` 8–10 m, `rolloffFactor` ~1.2, `maxDistance` = the call range.
   Update `AudioListener` position/orientation once per rendered frame from the camera with `setTargetAtTime`
   (time constant ~0.03 s) to avoid zipper noise. Positions are world metres.
8. **Cleanup.** Every voice is a small graph (source → filter → gain → panner → master). On `source.onended`:
   disconnect every node of that voice and remove it from the active set (PR #11 keeps them in `activeSources`
   forever). `dispose()` unsubscribes from `onAudioEvents`, stops and disconnects all live voices, and does **not**
   close the shared context (the engine owns it). Restarts must leave no nodes behind.
9. **Determinism.** Audio never writes to the simulation. `Math.random` is fine for variation (pitch, timing jitter
   within a call); the contract test already checks the state hash with observers attached.

## Acceptance for a future integration PR
- Unit: router drops out-of-range events, dedupes within the cooldown, gates by time acceleration, respects the voice
  cap; uses no `AudioContext` of its own (inject a fake engine).
- Browser: with audio started, a scripted `alarm` event near the camera creates exactly one voice that is disconnected
  after it ends; mute and volume apply to it; a restart leaves no live voices; simulation hash unchanged at a fixed tick.
- Human: an owner listening session in Chrome and one other browser, recorded in `docs/QA.md`.
