# Guided player journey — Living Valley V1 (10–15 minutes)

A reproducible walk through what the valley already does. Start: **`/?scenario=documentary`** (seed 2, day 34 of the
simulation calendar, 16:30, late monsoon, camera on the largest chital herd; see `docs/DOCUMENTARY.md`). After the
start **nothing is scripted**: animals, weather, events, Curiosity's choices and every caption come from the running
simulation, so details (which animal, which event) differ between browsers and runs; the stages do not.

Automated and recorded: `npm run build && npm run journey` (compressed, ~5 min wall time) or
`JOURNEY_FULL=1 npm run journey` (each stage held for the durations below, ~14 min). Output: an unedited video in
`test-artifacts/playwright/*journey*/video.webm`, one screenshot per stage in `test-artifacts/journey/`, and a JSON
stage log (stdout and the test annotation) with the simulation tick, day, mode and the text the player saw.
Software-rendered (SwiftShader) runs say nothing about frame rate or final visual quality.

| # | Time | Stage | What the player does | What it demonstrates (all real state) |
|---|---|---|---|---|
| 1 | 0:00–1:30 | Arrival | Enter the valley; read the field guide; look around (drag / J L), fly a little (W) | Herd grazing in late afternoon light; first-run guide that advances as you act; context hint line |
| 2 | 1:30–3:00 | Look closer | Double-click the nearest deer; read the Social Lens; press **Show group** | Inspector values = simulation record (age, sex, behaviour, needs); group size and mother from state; persistent history (empty at first) |
| 3 | 3:00–6:00 | Curiosity | Press **V** and watch | Documentary director: herd/group shots, side-on shots of moving animals, fade cuts to distant subjects, captions with "Simulated:" facts and "Why this shot / Continuing the story" |
| 4 | 6:00–9:00 | Become a chital | Back to Observer (V), select the deer, **P**; walk (W), graze (hold **E**), run (Shift), rest (**R**), release (**X**) | Same animal and needs before/after; perception cues from the deer's own state (herd, remembered water, sensed threat); need trends ▲▼ |
| 5 | 9:00–11:00 | Time | **X** (stop following); 100× time; **T** charts | Evening and night arrive; population, forage and moisture charts from simulation history |
| 6 | 11:00–13:00 | Experiment | Experiment mode; weather pattern **Drought**; 1000×; then back to Natural | Levers change simulation inputs only; charts and the births/deaths table show what the ecosystem does with them |
| 7 | 13:00–14:30 | Persistence | Menu → Save; close; reopen; **Continue**; select the deer you lived as | World restored exactly; the deer's Social Lens history still lists "you began living as this animal" and "you released it" |

## Honesty rules this journey follows
- No event is staged for the camera. If no kill or birth happens while you watch, Curiosity shows herds, foraging,
  drinking or a quiet scenic view, and says so.
- Captions only state values the simulation holds; "Why this shot" states the director's own reason.
- The deer you live as keeps its own physiology; it can be hungry, tired or afraid for real reasons. If it dies (it can)
  the journey continues in Observer.
- Stage 6 is a counterfactual lever, labelled as such; it is not a forecast.

## Known variability
- The documentary start is computed in the browser running it; JavaScript engines can differ in the last bit of some
  Math functions, so another browser may place the herd slightly differently (the camera adapts).
- The deer lived as in stage 4 may die before stage 7 (predation, thirst); the script then records that instead.
