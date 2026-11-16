# Documentary scenario (repeatable review start)

Open **`/?scenario=documentary`** and press **Enter the valley**. Add `&qa=1` to start paused.

| Fixed at start | Value |
|---|---|
| Seed | 2 (clear afternoon). Seed 3 was used until weather got its own random stream (2026-11-16): weather used to share the animals' stream, so any behaviour change could alter it, and seed 3 is now stormy at 16:30 |
| Time | Day 34 of the simulation calendar (shown as Day 35 in the HUD), 16:30, late monsoon |
| Conditions | Whatever seed 2 produces by then: clear, ~30 °C, light wind, river at monsoon stage. Weather now depends only on seed and time |
| How the time is reached | Ordinary simulation from tick 0 in fixed 1 s steps (570 ticks); nothing is written into the world |
| Camera | Eye height (1.8 m) on dry, open ground 9–19 m from the densest cluster of the largest chital herd (group 1, 13 deer; 10 within 15 m). Chosen from 96 candidates by the summed on-screen height of deer that are in frame with clear terrain **and object** line of sight (trees, snags, shrubs, rocks, logs from the world's deterministic scatter), minus foreground clutter in the view cone; never inside an object, never across open water if avoidable. The camera moves; animals are never placed |

After that **nothing is scripted**: animals, weather and Curiosity Mode run on their own. Code:
`apps/web/src/scenario/documentary.ts` (pure, headless). Tests: `tests/unit/documentary-scenario.test.ts` (same state,
conditions and camera every time; identical to stepping a fresh world by hand) and `tests/e2e/documentary.spec.ts`.

## Walk-through (what the browser test does, and what a reviewer can repeat by hand)
1. Arrive in Observer with the herd in frame. Measured on the rendered camera at the last run: 9 herd deer in frame, 7 drawn taller than 6% of the frame height (largest 21%); the test requires ≥ 5 in frame and ≥ 3 above 6%.
2. Press `V`: Curiosity picks a real subject (last run: a herd deer moving within its home range).
3. Press any movement key: control returns at once.
4. Select the herd deer drawn largest on screen and Follow it: the inspector shows its simulation record (species, sex, age, behaviour, group, mother).
5. Menu → Save; close the tab; reopen and Continue: the state hash, that deer's identity and its exact state match.

`npm run documentary` runs the walk-through with an **unedited video** recorded by Playwright
(`test-artifacts/playwright/*documentary*/video.webm`, not committed: software-rendered at a few fps). Stage stills:
[`evidence/documentary-scenario-swiftshader.jpg`](evidence/documentary-scenario-swiftshader.jpg).

Before/after of the camera rule on the same seed, tick and world state:
[`evidence/documentary-camera-before-after.jpg`](evidence/documentary-camera-before-after.jpg).

## What the capture shows honestly
- Rendered with SwiftShader, so it says nothing about frame rate or final look.
- "Deer that look submerged" turned out not to be a rendering offset: rendered banks match the simulated waterline (dry
  bank 0–30 cm above water drawn under water at 0.7% of points; terrain mesh error p99 2 cm). The deer really were in
  the water: personal-space steps pushed resting animals into the shallows and deer lay down where they drank. Both were
  fixed in the simulation (animals idling, resting or foraging in > 0.2 m of water: 3.2–5.9% → 0–0.4%).
- Deer are low-poly placeholders; they now lie down with folded legs when resting.
- Occluders are approximated as cylinders; grass blades are ignored, and a shrub can still clip the frame edge.
- The scenario's state is computed in the browser that runs it. Different JavaScript engines can disagree in the last
  bit of `Math.sin`/`atan2`/`pow` (measured: Node 22 vs Chromium), so another browser may place the herd slightly
  differently at 16:30; the camera is derived from that browser's own state, so the shot adapts.
