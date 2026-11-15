# Documentary scenario (repeatable review start)

Open **`/?scenario=documentary`** and press **Enter the valley**. Add `&qa=1` to start paused.

| Fixed at start | Value |
|---|---|
| Seed | 3 (clear afternoon; seeds 1, 2, 5–7 are raining at this hour) |
| Time | Day 34 of the simulation calendar (shown as Day 35 in the HUD), 16:30, late monsoon |
| Conditions | Whatever seed 3 produces by then: clear, ~30 °C, light wind, river at monsoon stage |
| How the time is reached | Ordinary simulation from tick 0 in fixed 1 s steps (570 ticks); nothing is written into the world |
| Camera | 24 m from the densest cluster of the largest chital herd (group 1, 12 deer; 9 within 15 m of each other), 4 m above ground, on dry ground on the herd's side of the river, chosen by terrain line of sight |

After that **nothing is scripted**: animals, weather and Curiosity Mode run on their own. Code:
`apps/web/src/scenario/documentary.ts` (pure, headless). Tests: `tests/unit/documentary-scenario.test.ts` (same state,
conditions and camera every time; identical to stepping a fresh world by hand) and `tests/e2e/documentary.spec.ts`.

## Walk-through (what the browser test does, and what a reviewer can repeat by hand)
1. Arrive in Observer with deer in front of the camera (the test counts ≥ 4 within 70 m in view; 11 at last run).
2. Press `V`: Curiosity picks a real subject (last run: a golden jackal stalking a hare).
3. Press any movement key: control returns at once.
4. Select a herd member: the inspector shows its simulation record (species, sex, age, behaviour, group, mother).
5. Menu → Save; close the tab; reopen and Continue: the state hash, that deer's identity and its exact state match.

`npm run documentary` runs the walk-through with an **unedited video** recorded by Playwright
(`test-artifacts/playwright/*documentary*/video.webm`, not committed: software-rendered at a few fps). Stage stills:
[`evidence/documentary-scenario-swiftshader.jpg`](evidence/documentary-scenario-swiftshader.jpg).

## What the capture shows honestly
- Rendered with SwiftShader, so it says nothing about frame rate or final look.
- The rendered river surface reads wider than the simulated waterline: deer standing 0–10 cm above water look as if
  they are in it.
- Deer are low-poly placeholders without a lying pose; resting deer stand.
- The opening shot is still weak: the herd is small in frame and the camera spot ignores rocks and trees (only terrain
  line of sight is checked).
