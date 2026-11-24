# Roadmap

Status key: **Done** = implemented and verified in software-rendered Chromium (see QA.md) · **Partial** = works with stated gaps · **Not started**.
"Verified" here means software-verified unless a row names a physical device. Physical-hardware evidence so far: one laptop
(HP Victus 16, Radeon Vega 8 iGPU + RTX 3060 Laptop, Edge 157, 2026-11-15, `docs/evidence/profile-hp-victus16-*.json`), on a
build that predates `c86a691`. No phone, Firefox or Safari has been tested. Milestone ledger: issue #9. Release checklist:
`docs/handover/RELEASE_READINESS.md` (reconciled 2026-11-24 by QA-01).

## Milestone 1 — The Reclaimed Valley (MVP)

| Area | Status | Notes |
|---|---|---|
| Workspace, strict TypeScript, Vite build, CI workflow | Done | CI runs typecheck, unit/headless, build and all browser suites |
| Deterministic valley: forest/river, settlement, dump, meadow/wetland (2.07 km²) | Done | |
| Terrain streaming with distance LOD, off-thread meshing | Done | Stale Worker results rejected; main-thread fallback if the Worker dies (browser-tested) |
| Environment: day/night, seasons, weather, soil water, river stage, vegetation, nutrients | Done | |
| Six species with utility AI, limited perception, food web, births, deaths | Done | Animals kept out of building footprints; small mammals escape floods |
| Fixed-timestep simulation, 1×/10×/100×/1000× | Done | 1000× is CPU-bound on slow machines; achieved rate shown |
| Headless 1/3/10/100-day tests, reproducibility, save round trip | Done | |
| Observer mode (free camera, select, inspect, follow) | Done | Camera slides along ruins; trees are not solid |
| Wildlife mode (spotted deer) | Done | Walk/run/graze/drink/rest/escape verified in browser |
| Experiment mode | Done | |
| Start screen, HUD, pause menu, settings, diagnostics, help | Done | |
| Save/load (IndexedDB), autosave, versioned format | Done | One slot; also saves when the tab is hidden |
| Renderer resource lifecycle across restarts | Done | Live WebGL object counts identical after 4 restarts (software); stable over restarts 1–5 on the Victus. Not tested: > 20 restarts, context restore (context loss shows a reload message) |
| Adaptive quality (Addendum IV) | Partial | Governor with recovery, ceiling, FPS target, pacing, start-up calibration, hardware assessment and measured downgrade trials (`c86a691`). Downgrade **and recovery physically verified** on the Victus (both GPUs) before `c86a691`; the CPU-only-load behaviour after `c86a691` is software-verified only (hardware re-run pending). Not measured: Ultra, 1080p full screen, phones, thermal |
| Procedural audio, optional music | Partial | Not listened to |
| Touch controls, gamepad | Partial | Implemented; untested on devices |
| Simulation detail tiers | Partial | Decision-rate LOD + abstract pools + grid; no individual↔population conversion |
| Performance budgets on reference hardware | Partial | Desktop: Victus 16 holds the 144 Hz cap on Low/Medium/High at 1490×706 (p95 7.0–7.3 ms), so presets cannot be ranked. Mobile 30 fps budget: no device measured. Procedure: `docs/handover/HARDWARE_VALIDATION.md` |
| Instance-buffer memory | Done | Sized to need; Low 10.82 → 0.72 MB |
| Dawn/dusk lighting | Done (software-rendered review) | Twilight ambient curve and exposure adaptation; before/after evidence |

## Milestone 2 — Living-world features (Addendum III), early

| Area | Status | Notes |
|---|---|---|
| Curiosity Mode (documentary autopilot) | Partial | Gemini's director (PR #6) + GPT-6 fixes (PR #8) + integration fixes; browser-verified for selection, hold, skip, interruption, ruin clearance, speed cap, size-based framing. One general profile only |
| Social Lens (group, mother, offspring, pressures) | Partial | Shows only simulation state; no persistent social history beyond the session |
| World Library registry | Partial | Data-driven registry with one world; no other worlds exist |
| Animal navigation and herd behaviour (Living Valley V1) | Done (headless + software-rendered review) | Acceleration, speed-dependent turning, look-ahead steering with wall following, give-up on unreachable goals, many-eyes vigilance, coordinated flight, regroup, personal space. Measured by `npm run movement`; no path-finding |
| Documentary scenario | Done (software-rendered) | `/?scenario=documentary` (seed 2 since `46e5e80`; seed 3 before); camera chosen by drawn subject size and terrain + object line of sight; nothing scripted after; browser walk-through with video |
| Resting and pose transitions | Done (software-rendered review) | Folded-leg lying pose, blended graze/drink/walk/run/alert/lying from the observation contract; personal-space steps face their direction; resting on dry ground |
| Ecological audio events | Design only | Path documented in `AUDIO_INTEGRATION.md`; PR #11 reviewed, not merged |
| Visual quality improvements | Not started | Visual Lab (PR #7) reviewed, not merged: see VISUAL_LAB_REVIEW.md |

## Release blockers (M5 beta)
M5 is **not** complete. Green CI is necessary but not sufficient. See `docs/handover/PLATFORM_HANDOVER.md` §8 (B1–B9) and
`docs/handover/RELEASE_READINESS.md`. Integration CI on `3a0e7f9` is red (run 322, a test-synchronisation defect); the fix is in PR #43.

## Next

1. Measure on a midrange phone, and re-measure the desktop GPU after `c86a691`: frame times, governor under CPU-only load, memory, download (`docs/handover/HARDWARE_VALIDATION.md`).
2. Social Lens history that survives save/load.
3. Midday grass tone (reads pale).
4. Re-run `/?profile=1` on the Victus to confirm Auto keeps High under CPU-only load (fix in `c86a691`). Reports now record `build.sha`.
5. Call router for real ecological audio events through the single AudioContext (`AUDIO_INTEGRATION.md`).
5a. Deterministic math for the simulation if cross-browser replay becomes a requirement (see SIMULATION.md).
6. Path-finding for long detours (river bends, ruin courtyards); tree collision for the camera.
7. Ecological tuning: jackal food limitation, hare refugia, seasonal deer breeding.

## Expansion modules (not started, documentation only)

Ocean, desert, larger cities and industrial zones, nuclear sites, deep-time worlds, orbital space, mythical regions and
the Simulation Inspectors encounter (Addendum V, gated on a working Space Expansion). Each is planned as a separate,
lazily loaded package that cannot alter the natural simulation. None of this exists.
