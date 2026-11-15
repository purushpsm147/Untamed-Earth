# Natural Soundscape — experimental audio audition

This is **isolated experimental code**; it does not replace `apps/web/src/audio/AudioEngine.ts` or alter authoritative ecology.

Open `/?soundscape=1`, press **Start Audio** to grant browser audio permission, then adjust the river distance, wind, daylight and rain controls. The buttons demonstrate spatial animal-call synthesis. They are explicitly audition controls, **not proof that each call was triggered by an ecological event**.

Source modules: `apps/web/src/lab/NaturalSoundscape.ts`, `NaturalSoundscapeDemo.ts`. Pure audio gain/target calculations are covered by `tests/unit/natural-soundscape.test.ts`. This implementation synthesizes audio using Web Audio API nodes and requires actual listening to judge naturalness.

**Verification not yet complete:** browser audio start/mute/resume/restart behavior, meaningful spatial stereo imaging, actual fauna-call authenticity, different browsers, physical speakers/headphones, memory and AudioContext lifecycle. No external sampled audio assets are included. The soundscape experiment is not integrated in production.

See the companion visual report in the other proposed branch for artistic context, or GitHub issue #9 for Living Valley V1 milestone status.
