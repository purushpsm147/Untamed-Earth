# UX-01 director review package — Living Valley V1 experience

PR: **#45** (draft) · branch `claude/living-valley-v1-gameplay-8g1v40` · base `ccr-4783fee0-8wvc41` @ `3a0e7f9`.
Exact head SHA, CI run and test totals for this package are in the PR comment that links this file.
Continuation detail: `docs/handover/GAMEPLAY_HANDOVER.md`. Journey script: `docs/JOURNEY.md`.

## Status by charter category
| Item | Implemented | Software-verified | Physically verified | Creatively accepted |
|---|---|---|---|---|
| Documentary director V1 (groups, continuity, shot planning, cuts) | yes | yes (24 unit, 2 browser) | no | **pending director** |
| Honest captions ("Simulated:", "why this shot", history line) | yes | yes (browser) | no | **pending director** |
| Persistent Social Lens history (save/load) | yes | yes (7 unit, 1 browser save/close/Continue) | no | n/a |
| Observer easing, follow glide, double-click follow, hints | yes | yes (browser) | no | **pending** (motion comfort needs a human) |
| Chital perception cues, trends, toggle actions | yes | yes (browser) | no | **pending** |
| Field guide, ARIA, larger text | yes | yes (browser) | no (no screen reader / phone here) | **pending** |
| Guided 10–15 min journey | yes | yes (recorded, compressed mode) | no | **pending** |

"Software-verified" = Node unit tests and SwiftShader Chromium in a Linux container (no GPU). Nothing here is evidence
of frame rate, visual quality on real hardware, motion comfort, or accessibility with assistive technology.

## What changed and why (one line each)
- **Director cadence** 0.5 s instead of every frame — spec asks for low-frequency bounded decisions.
- **Herds as subjects** — the valley's most legible behaviour is the herd; individual calm members were competing noise.
- **Continuity bonus** (prey/predator, mother/young, same group, same scene) — successive shots now tell one story
  (journey log: alarm on chital #17 → "Continuing the story: the same group").
- **Ongoing stories held up to 1.6× max hold** — the camera no longer cuts away mid-chase or mid-flight.
- **Profile shots + leading room + 180° rule + 8-azimuth line-of-sight** — composition derived from heading, terrain and
  ruins, not a constant orbit.
- **Fade cuts beyond 160 m** (45 m with reduced motion) — the old director flew up to 55 m/s across the valley; a cut is
  calmer and how documentaries edit. Relocation happens only on black; visible motion keeps the original cap.
- **Captions** state the subject, simulated values, and the director's reason; internal labels removed.
- **Social Lens history** recorded from real events and observed state transitions, bounded, saved with the world,
  validated on load; alarms capped and summarised so they cannot evict births, kills or possession (found by the
  journey run at 1000× drought).
- **Observer** eased flight and follow glide (no snaps), double-click follow, mode hint line.
- **Chital** cues from the animal's own perception/memory only (sensed threat, own herd, remembered water) — feedback
  without omniscience; behaviour status says when an action cannot work.
- **Onboarding** five-tip field guide, information only, completes by doing, dismiss persists.
- **Accessibility** aria-pressed, live regions, dialog focus, larger text, toggle-instead-of-hold.

## Evidence
- Journey stills and contact sheet: `docs/evidence/ux01/journey-*.jpg`, `journey-contact-sheet.jpg`.
- Journey video (unedited, SwiftShader, re-encoded 640 px / 3 fps): `docs/evidence/ux01/journey-walkthrough-640p.webm`.
  Full-resolution recording is produced by `npm run journey` under `test-artifacts/playwright/`.
- Journey stage log (simulation tick/day, mode, exact text shown) is printed by the run and stored as a test annotation.
- Bundle: main chunk 675.6 kB → ~701 kB raw (+~26 kB, no new dependencies, nothing lazy-loaded changed).
- Simulation determinism: unit test asserts an identical state hash with the history recorder attached; the director
  is unchanged in its read-only contract.

## Known limitations and risks
- Composition uses simulation positions, not rendered pixels; foliage/grass occlusion is not considered.
- Group subjects require ≥ 3 members (jackal pairs never qualify); groups are the simulation's `group` ids.
- History starts when a world is first observed with this build; earlier events are not reconstructed. Group change
  and maturity entries are "noticed" (time = first observation, up to ~1 s of play late).
- Cuts change the experience of Curiosity; some viewers may prefer continuous flights (thresholds are config).
- Pre-existing CI failure `gameplay.spec.ts:378` (GPU geometry spread) is red on the base too; QA-01 informed.
- `tests/e2e/helpers.ts` (QA-owned under OPS-02) has two additive UX-01 edits; recorded with QA-01.

## Decisions requiring director approval
1. Cut thresholds and timings (160 m / 45 m reduced motion; 0.45 s out, 0.15 s black, 0.6 s in).
2. "Why this shot / Continuing the story" caption line on by default (alternatively behind a caption-detail option).
3. Field guide shown by default on first visit (Observer only, dismissible).
4. Whether to merge stage-wise or as one PR after QA-01's CI fixes land.

## Recommended next task
Human review on real hardware of the journey (motion comfort of glides and cuts, caption readability at 1080p and on a
phone, screen-reader pass), then a small follow-up from that feedback. Ecology-owned issues surfaced by UX (sprint
labelled `Flee`, possessed animals exempt from background mortality, jackals ignoring non-prey chital) are for ECO-01.
