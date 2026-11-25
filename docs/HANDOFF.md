# Continuation handoff — 2026-11-15 (latest: Living Valley V1 session, Claude)

> **2026-11-24: multi-workstream operation.** The director desk is issue #36. Each workstream keeps its own handover under
> `docs/handover/`. Platform/QA/release state (integration CI, failure history, hardware evidence, branch ownership, merge
> protocol, release blockers) lives in `docs/handover/PLATFORM_HANDOVER.md`. Integration HEAD `3a0e7f9` is red in CI (run 322,
> a test-synchronisation defect); the fix is in PR #43. The physical-GPU profiles **are** archived (`eb92959`), contrary to the #9 ledger.
> The sections below are history from earlier single-session work.

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

## Follow-up session (quality and verification)
| Commit | Change | Evidence |
|---|---|---|
| `1695c09` | Natural dawn/dusk lighting in `Sky.ts`; wildlife test flake fixed | `docs/evidence/dawn-dusk-before-after.jpg`, `tests/unit/sky-lighting.test.ts` |
| `d7423cd` | Curiosity frames animals by body size, 3.5 m safe minimum | `docs/evidence/curiosity-framing-before-after.jpg`, 2 new unit tests |
| `6c1a3e4` | Instance buffers sized to need (Low 10.82 → 0.72 MB); `?profile=1` profiler; click-select test flake fixed | `docs/PERFORMANCE.md`, `docs/evidence/profile-swiftshader-2026-11-15.json` |
| `6b8261e` | Key taps between frames no longer lost; input-timing test races fixed | `tests/unit/input-latch.test.ts` |

PR #8 was closed with an explanatory comment (its code is in `e6310ce`); #6 shows as merged; #7 stays open as an experiment.

## Living Valley V1 session (navigation, herds, contracts, documentary scenario)
| Commit | Change | Evidence |
|---|---|---|
| `13e9e08`, `9b64860`, `755aa2f` | PR #10 merged (poll for movement); frame waits and commanded-speed comparison in camera tests | CI run 70 success; QA.md CI record |
| `eb92959` | First real-hardware profiles (HP Victus 16, Vega 8 + RTX 3060): presets at the 144 Hz cap; Auto downgrade **and recovery verified** | `docs/PERFORMANCE.md`, `docs/evidence/profile-hp-victus16-*.json` |
| `e1303f9` | Read-only observation contracts for Gemini (motion/animation, audio events, ambient) | `docs/INTEGRATION_CONTRACTS.md`, CI run 78 success |
| `364d942` | Navigation: acceleration, turning limits, look-ahead steering, wall following, give-up; herds: many eyes, coordinated flight, regroup | `npm run movement`, `tests/unit/navigation.test.ts` |
| `05a2cb9` | Personal space in herds; `/?scenario=documentary` with browser walk-through and video | `docs/DOCUMENTARY.md`, `docs/evidence/documentary-scenario-swiftshader.jpg` |

Gemini PRs #11 (soundscape) and #12 (riverbank/chital) were reviewed with specific feedback and **not merged**; both
should move to the contracts in `observe.ts` (events via `onAudioEvents`, pose from `behavior`/`gait`).

## Living Valley V1 next pass (2026-11-16)
| Commit | Change | Evidence |
|---|---|---|
| `c86a691` | Auto quality keeps only downgrades that measurably help; ineffective ones undone and held with back-off; preset step no longer raises resolution | `tests/unit/quality-governor.test.ts` (6 new), reliability browser test (constant feed undone on the real renderer; real SwiftShader trial measured a gain) |
| `46e5e80` | Folded-leg lying pose and pose blending (presentation only, via the contract); personal-space steps turn then walk; resting on dry ground; weather RNG decoupled; documentary seed 3 → 2 | `tests/unit/animal-pose.test.ts`, `navigation.test.ts`, `npm run movement` |
| `acecba0` | Documentary camera by drawn subject size and terrain + object line of sight | `docs/evidence/documentary-camera-before-after.jpg`, walkthrough stills |
| `49ac48c` | `AUDIO_INTEGRATION.md` (PR #11 reviewed, not merged); QA/ROADMAP/SIMULATION/PERFORMANCE | PR #11 comment |
| `3a9d068` | Traversal leak check by exact terrain accounting; observer hold waits for movement (CI flakes 115/124) | QA.md CI record |
| `263e584` | Governor trial windows >= 8 frames, medians (CI 129 exposed noisy verdicts on slow devices) | **CI run 130 success** |

PRs #11, #12 and #13 are untouched and unmerged. GPT-6's V4 graphics experiment (PR #13) was not edited or duplicated.

## Known defects and unsupported claims
- **No physical GPU or phone has been profiled** (none attached to the session). Run `/?profile=1` on real hardware.
- Auto quality recovery is verified on one laptop (two GPUs). The fix for downgrading under CPU-only load (`c86a691`) is
  unit- and SwiftShader-tested only; the hardware re-run is pending.
- Simulation determinism is per JS engine (Node and Chromium differ in the last bit of transcendental Math functions).
- No phone profiled. Ultra, full-screen 1080p and true GPU time not measured.
- At the 3.5 m safety minimum a myna is ~6% of frame height; midday grass reads pale.
- Audio never listened to; touch and gamepad never used on a device; no Firefox/WebKit runs.
- Social Lens history is session-only.

## Next engineering task
1. Owner: re-run `/?profile=1` on the Victus (both GPUs) and commit the JSON; check `auto.keptQualityUnderLoad` and
   `auto.governor` (expected: one or a few undone probes, quality kept at the settled preset under the artificial load).
2. Implement the audio `CallRouter` described in `docs/AUDIO_INTEGRATION.md` with its unit and browser gates.
3. Decide whether cross-browser replay matters; if so, a deterministic math module for the simulation.
4. Profile a midrange phone with `/?profile=1`.
