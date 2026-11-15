# Continuation handoff — 2026-11-15 (integration session, Claude)

## Branch and state
Integration branch `ccr-4783fee0-8wvc41`. Start of session: local HEAD `14e5732` plus uncommitted QA/Curiosity work;
remote at `cdc5343` (docs + CI from PR #1). That local work was committed (`cf2b750`) and rebased onto `cdc5343`,
then the agent PRs were merged one at a time. Check `git log` for the current HEAD; the latest commits are listed in the
PR table below.

## What was integrated
| PR | Author | Outcome | Integration changes |
|---|---|---|---|
| #2 renderer lifecycle | GPT-6 | Merged (`a16b98f`) | Every InstancedMesh disposed; one WebGLRenderer per canvas (three.js leaked 3 framebuffers + 4 textures per renderer instance) |
| #4 terrain streaming | GPT-6 | Merged (`c50d1b7`) | Main-thread fallback budgeted per frame (it used to trip the 30 s loading guard); loading watchdog now stall-based |
| #3 adaptive quality | GPT-6 | Merged (`21c3aba`) | Replaced the local controller. Fixed: devices under 4 fps never adapted. Added FPS target, frame pacing, start-up calibration, hardware assessment, hidden-tab policy |
| #8 → #6 Curiosity director | Gemini + GPT-6 | Merged (`e6310ce`) | Single director in the game via a read-only adapter. Fixed: rotated footprints used the inverse rotation (PR test shared the bug); no camera speed limit; runtime reduced motion; events follow their animal |
| #7 Visual Lab | Gemini + GPT-6 | **Not merged** | Reviewed and run locally: `forest_herd` camera is 12 m underground; enhancements barely visible; frame timings invalid. See `docs/VISUAL_LAB_REVIEW.md` |

PRs #2, #3, #4, #6 and #8 are contained in the integration branch; GitHub should show #2–#4 as merged automatically.
#6/#8 target `feat/gemini-curiosity-director`, so they may need closing by hand. #7 should stay open as an experiment.

## Evidence (all software-rendered Chromium / SwiftShader, Linux container; no GPU)
See `docs/QA.md` for commands and results. Key browser measurements:
- WebGL objects after 4 world restarts: identical to the first load (buffers 291, VAOs 65, programs 11, framebuffers 3, textures 5).
- Simulation state hash at tick 300 identical whether quality stayed on Low or was changed by the governor mid-run.
- Curiosity, 90 s from the settlement: 0 samples inside a ruin below its roof, 0 below terrain, max 53 m/s over 2 s windows.

## Known defects and unsupported claims
- No real-GPU, phone, Firefox or WebKit testing. No FPS, memory or download-budget claims are made.
- Governor *upgrade* has only been exercised with synthetic frame traces (software rendering never has headroom).
- Curiosity frames small birds from too far away (fixed 10 m standoff).
- Low-sun scenes (dawn, golden hour) are very dark.
- Grass and rain buffers are preallocated at Ultra capacity on every preset (P2 from the independent review).
- Audio never listened to; touch and gamepad never used on a device.
- Social Lens history is session-only.

## Next engineering task
Run the game on a real desktop GPU (and a midrange phone if available) with F3 diagnostics open:
record p50/p95 frame time per preset, watch the governor climb back after load is removed, and record JS heap after
repeated restarts. Then fix dawn/dusk exposure in `apps/web/src/render/Sky.ts` (`update()`: hemisphere intensity and
fog colour at low sun elevation) with before/after screenshots at a fixed seed, pose and frozen time.

## Commands
```bash
npm ci
npm run typecheck
npm test               # ~2 min (includes 100-day runs)
npm run build
npm run test:e2e       # ~12 min: smoke, reliability, gameplay (needs build; Playwright Chromium)
npm run sim -- 150 7
npm run bench
```
