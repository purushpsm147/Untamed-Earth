# Platform, QA and Release Engineering handover (QA-01)

**Owner of this file:** QA-01 (`session_01MD7GqPxyJBUB5qRk854hy3`). Director channel: [#36](https://github.com/purushpsm147/Untamed-Earth/issues/36).
Milestone ledger: [#9](https://github.com/purushpsm147/Untamed-Earth/issues/9). Draft PR: [#43](https://github.com/purushpsm147/Untamed-Earth/pull/43).
**Snapshot:** 2026-11-25 (first written 2026-11-24). Base: integration `ccr-4783fee0-8wvc41` @ `3a0e7f9`. Working branch: `ccr-be746a20-5zbpsi`.

This file is the restart point for QA-01. Read it with `docs/QA.md`, `docs/handover/RELEASE_READINESS.md` and
`docs/handover/HARDWARE_VALIDATION.md`. Anything not stated here with a SHA, run link or file is not established.

Evidence levels used below: **implemented** (code exists), **software-verified** (unit/headless or SwiftShader Chromium),
**physically verified** (a named real device), **creatively accepted** (a human reviewed look/sound). They are not interchangeable.

---

## 1. Integration HEAD and CI status

| Item | Value |
|---|---|
| Integration HEAD | `3a0e7f973b8935fa7a05b5406c5af9b970584c18` (Merge PR #33, 2026-11-17) |
| Latest integration CI | [run 322 / 44116004501](https://github.com/purushpsm147/Untamed-Earth/actions/runs/44116004501): **failure**: 19/20 browser tests passed. Typecheck, unit and build passed. |
| Last green integration CI | [run 282 / 44050126945](https://github.com/purushpsm147/Untamed-Earth/actions/runs/44050126945) on `78bb515` (Merge PR #25) |
| Candidate fix | PR #43 head `07dd3aa` on `ccr-be746a20-5zbpsi`: **CI green twice on the same SHA**, [run 384](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45467323137) (push) and [run 385](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45467341467) (PR); 135 unit, 21/21 browser. Awaiting director review; not merged. |
| Workflow | `.github/workflows/quality.yml`: `npm ci` → typecheck → `npm test` → build → `playwright install --with-deps chromium` → `npm run test:e2e` (smoke, reliability, gameplay, documentary) on ubuntu-latest, SwiftShader. Runs on every push and PR. Concurrency is per ref, cancel-in-progress. |

### Run 322 failure: diagnosis
- **Failing test:** `tests/e2e/reliability.spec.ts`, "terrain converges after violent camera travel; stale Worker results are
  discarded, none applied late". `expect(after.mismatched).toBe(0)` received **97**, straight after `terrainSettled()` had passed.
- **Root cause (a test-synchronisation defect; the product is fine):** `TerrainView` recomputes `live`/`want`/`mismatched` only in
  `update(cam)`, which `Engine.render` calls once per rendered frame. `debugCam()` only writes `Game.cam`. If the previous
  camera position had fully settled, the first poll of `terrainSettled()` could run before the next frame and read all
  zeros that described the old position. The helper returned, the next frame streamed for the new position, and the read
  that followed saw 97 chunks below their wanted LOD. Whether a frame lands between two `page.evaluate` round trips is a
  matter of timing, so the failure is intermittent. This is the first time it has been seen in CI: runs 247, 275 and 282 passed
  the same test.
- **Reproduction:** teleporting and reading `debugTerrain()` in the same task always returns 0 for a position that has not
  loaded at all. The new regression test asserts this, so the race is pinned down deterministically. A local probe
  with separate round trips (3 teleports) read 52/144/180 outstanding immediately afterwards. That run had a frame between the round trips, which
  shows why the failure only appears on some runs.
- **Artifact:** CI artifact `playwright-reports` (id 14342759805, sha256 `75e19741…0643f7`) expires 2026-11-24 15:52 UTC.
  This container's egress proxy blocks the artifact blob host, so I could not archive the trace. The diagnosis above does
  not depend on it.
- **Fix (`daf0ffa`):** `TerrainView.debugState()` now also returns `updates`, a counter of `update()` passes (QA diagnostics only, no
  behaviour change). `terrainSettled()` records `updates` first, then polls until a later pass has run **and**
  `mismatched + pending + inFlight + queued === 0`. No assertion, threshold or timeout was changed. Every caller of the helper
  benefits, including the smoke, gameplay and reliability tests.
- **Regression test:** "terrain readiness is judged for the current camera, not the position before a teleport"
  (`tests/e2e/reliability.spec.ts`).
- **Second cause, found when that regression test failed in CI run 378 (`f0afb90`): `mismatched` 18 after the helper passed.** A chunk
  with no mesh is first filled at LOD 6; its full-detail target (`want = lodFor(d)`) is set only on the *next* `update()`. Between the
  coarse fill landing and that pass, `mismatched` (computed against `want`), `pending`, `inFlight` and `queued` were all 0 while nearby
  chunks were still coarse. **Fix (`07dd3aa`):** `debugState().mismatched` compares `res` with the chunk's final LOD `lodFor(dist)`
  (distance recorded per update). Diagnostics only. Deterministic unit regression on the main-thread path
  (`tests/unit/terrain-streaming.test.ts`), verified to fail on the old diagnostic. Run 322's 97 is consistent with either cause; both are fixed.
- **Same family, another test:** "graphics quality changes at runtime" read GPU geometry counts after a fixed 3.5 s sleep. Round 1
  read low (80/88/89 vs 102–105) in 3 of 3 local runs, and UX-01 reproduced it on `3a0e7f9` and on PR #45 CI run 45399663928.
  Fix (`f0afb90`): shared helper `gfxSettled()` (terrain settled, then geometry and chunk counts stable over 1 s). The ≤ 6 threshold is unchanged.

---

## 2. Inherited GPT-6 PRs: merged status and remaining obligations

Every head listed was checked with `git merge-base --is-ancestor <head> origin/ccr-4783fee0-8wvc41` (all true).

| PR | Head | Integrated as | State | Delivered (evidence level) | Remaining obligation |
|---|---|---|---|---|---|
| #2 renderer lifecycle | `85e2880` | `a16b98f` (2026-11-15) | merged | Every InstancedMesh disposed; one WebGLRenderer per canvas; equal GL object counts after 4 restarts (software-verified, `reliability.spec.ts` test 1; physically: restarts 1–5 stable on the Victus, see §5) | Long restart soak (>20 restarts, with region changes) and context loss/restore: **not tested** |
| #3 adaptive quality | `4688dc6` | `21c3aba`, then extended in `c86a691`/`263e584` | merged | Governor, ceiling, 30/60 target, pacing, calibration, hidden-tab policy, downgrade trials (software-verified; downgrade + recovery **physically verified** on the Victus before `c86a691`) | Re-run on hardware after `c86a691` (keep quality under CPU-only load); Ultra/1080p; mobile 30 fps; thermal |
| #4 terrain streaming | `0d3ce46` | `c50d1b7` | merged | Stale/out-of-order Worker replies rejected; dead-Worker main-thread fallback (software-verified) | The CI 322 readiness race was a test defect, fixed here. Not yet tested: Worker restart after failure (the fallback is permanent for the session), and streaming under real-GPU travel speeds |
| #8 Curiosity skip/clearance | `2cb72c8` | `e6310ce` (with #6), closed by hand | closed into #6 | Skip semantics, rotated-building clearance, speed cap (software-verified) | Ownership moved to UX-01 (#36). QA keeps only the regression gate |
| #10 browser test reliability | `4943d26` | `13e9e08` | merged | Movement assertions poll for the real effect; thresholds unchanged (software-verified; CI 70) | Same principle now applied to terrain readiness (`daf0ffa`). Keep auditing helpers for "read before the next frame" races |

Related merged test-reliability work: PR #19 (`deb1de8`), with deterministic terrain draw accounting and frame-independent wildlife/traversal checks.

---

## 3. CI failure history (integration branch, `quality.yml`)

Runs listed by GitHub for `ccr-4783fee0-8wvc41` (30 total). Cancelled runs were superseded by a newer push. Unit and browser counts are for that SHA.

| Run | SHA | Result | Unit / browser | Cause → fix |
|---|---|---|---|---|
| 3 | `cdc5343` | success | — | PR #1 docs/CI baseline |
| 44 | `21c3aba` | **fail** | | Wildlife: resting deer halves detection → stand up first (`1695c09`) |
| 46 | `dcd446c` | **fail** | | Click-select: followed deer walked away → click projected position (`6c1a3e4`) |
| 48 | `d7423cd` | **fail** | | Walk-speed dilution; traversal timeout → measure while moving; real-time path (`c93468d`) |
| 51 | `c93468d` | success | 69 / 18 | |
| 52 | `7dd1587` | **fail** | 69 / 16 of 18 | `KeyQ` descend and deer escape read before the input frame → PR #10 (`13e9e08`) + `9b64860` |
| 70 | `9b64860` | success | | |
| 78 | `e1303f9` | success | | |
| 83 | `364d942` | **fail** | | Wildlife run-speed measured during acceleration → measure after plateau |
| 85 | `3d53c14` | success | 80 / 19 | |
| 115 | `c86a691` | **fail** | | Traversal geometry counter depended on frame sampling → exact terrain accounting (`3a9d068`) |
| 124 | `49ac48c` | **fail** | | Same traversal flake + observer Space hold → hold until moved (`3a9d068`) |
| 129 | `3a9d068` | **fail** | | Governor trial verdict on ~5-frame windows → ≥ 8 frames, medians (`263e584`) |
| 130 | `263e584` | success | 93 / 19 | |
| 131 | `42abea5` | success | | docs |
| 132 | `a0e08ba` | success | | PR #14 docs |
| 220 | `5cf7b4a` | success | | PR #20 critical thirst |
| 246 | `9e25ecc` | cancelled | | superseded by 247 |
| 247 | `deb1de8` | success | | PR #19 test stabilisation (PR #23 included) |
| 275 | `0acc437` | success | | PR #24 audit |
| 282 | `78bb515` | success | 120 / 20 | PR #25 |
| **322** | **`3a0e7f9`** | **fail** | 132 / 19 of 20 | **Terrain readiness race (§1) → `daf0ffa` + `07dd3aa`** |
| PR #43: 363/364 | `d484a37` | success ×2 | 132 / 21 | first fix + docs |
| PR #43: 378 | `f0afb90` | **fail** | / 20 of 21 | new regression test exposed the coarse-LOD false zero → `07dd3aa` |
| PR #43: 384/385 | `07dd3aa` | **success ×2** | 135 / 21 | candidate |

**Pattern:** every red integration run since run 44 has been a test that read state **before a slow software-rendered frame
applied it** (input, camera, streaming), or a verdict computed from too few frames. None was a product regression that
reached players, apart from the two product fixes that these tests exposed: tap latching (`6b8261e`) and governor windows (`263e584`).
**Rule for new browser tests:** read state only after the frame that applies the change. Poll for an effect or a frame counter,
never sleep for a fixed time.

---

## 4. Performance budgets (targets; `docs/QUALITY_GATES.md`)

| Budget | Target | Current evidence |
|---|---|---|
| Desktop frame time | 60 fps, p95 ≤ 16.7 ms on a specified device | Victus 16 (Vega 8, RTX 3060 Laptop): p50 6.9 ms, p95 7.0–7.3 ms on Low/Medium/High at 1490×706, DPR 1.25. Capped by vsync at 144 Hz, so presets cannot be ranked. **Not measured:** Ultra, full-screen 1080p |
| Mobile frame time | 30 fps, p95 ≤ 33.3 ms on a specified midrange phone | **None** |
| Mobile working memory | ~300 MB where measurable | **None.** Only the JS heap is observable (Chromium) |
| Initial compressed download | < 10 MB | Build on `3a0e7f9`: main JS 676 kB (181 kB gzip) + worker + lazy chunks. Total transfer not yet measured on a real host |
| Simulation CPU | ≤ a few ms per tick at 1× | 0.37–0.46 ms/tick (container CPU, `npm run bench`); 0.02–0.18 ms/tick on the Victus |
| Render submission CPU | — | 1.2–2.3 ms/frame on the Victus |
| GPU leaks | equal GL object counts across restarts | Software: identical after 4 restarts. Victus: stable over restarts 1–5 |

## 5. Evidence provenance: physical hardware

The #9 ledger says the AMD/NVIDIA reports are "not yet archived in repo". **That is out of date: they are archived** in commit `eb92959`
(2026-11-15, CI run 68 cancelled → superseded by run 70, green):

| File | sha256 (prefix) | GPU string | Run start (UTC) |
|---|---|---|---|
| `docs/evidence/profile-hp-victus16-radeon-vega8-run1.json` | `99cdc2afb9d95afc` | ANGLE AMD Radeon(TM) Graphics, D3D11 | 2026-11-15T16:48:55Z |
| `docs/evidence/profile-hp-victus16-radeon-vega8-run2.json` | `b32d6312bc8edf7f` | same | 2026-11-15T16:55:08Z |
| `docs/evidence/profile-hp-victus16-rtx3060-laptop.json` | `49b32b890fd80981` | ANGLE NVIDIA GeForce RTX 3060 Laptop GPU, D3D11 | 2026-11-15T17:39:21Z |

- **Who ran them, and with what:** the project owner, Edge 157 on Windows 10/11 x64, window 1490×706 CSS px, DPR 1.25, 16 logical cores, 16 GB.
- **Results:** Auto settled at High, went down to Low at 80% under the artificial load, then recovered to High at 100% (`recoveredToSettled: true`)
  on both GPUs. Restarts 1–5: 395 buffers, 7 textures, 29 programs on every run.
- **Privacy review (QA-01, 2026-11-24):** the files contain a user-agent string, ANGLE renderer strings with PCI *model* IDs
  (`0x1638`, `0x2520`, which are shared by every unit of that model), core count, memory class, viewport and DPR. They contain no
  hostnames, serial numbers, user names, driver install paths or DxDiag output. DxDiag was used only for the specs in
  PERFORMANCE.md and was never committed. **Verdict: acceptable to keep public.**
- **Provenance gap:** the reports do not record the commit they measured. From timing (between `6c1a3e4`, which added
  `?profile=1`, and `eb92959`) the build was one of `6c1a3e4`/`6b8261e`/`c93468d`/`7dd1587`, which is **before** the governor-trial change `c86a691`.
  Fix in this branch: `?profile=1` reports now include `build: { sha, dirty, builtAt }` (`apps/web/src/build-info.ts`,
  `apps/web/vite.config.ts`). New reports can therefore be tied to a commit.
- **Still not archived anywhere:** any phone, any Firefox/Safari run, any gamepad, any listening review.

---

## 6. Branch ownership and merge coordination protocol

**Branches** (from #36 acknowledgements, 2026-11-24):

| Workstream | Session | Branch | Draft PR | Writes to |
|---|---|---|---|---|
| ECO-01 | `…RhnJjYtuCmrEar82u` | `feat/open-boundary` (#34), `feat/maternal-instincts` (#35), chain #27→#28→#30 | #34 (frozen evaluation) | `packages/ecology`, ecology tests/evidence |
| VIS-01 | `…PuXwHyvyQzg92MD6S` | `claude/reclaimed-valley-naturalism-erqqqu` | #42 | isolated visual slice, `docs/handover/VISUAL_*` |
| AUD-01 | `…QnvbKmagdfGEfBYd1` | (see #36) | (see #36) | audio slice, `docs/handover/AUDIO_*` |
| UX-01 | `…RcW3ts2MijX2aRYdJ` | `claude/living-valley-v1-gameplay-8g1v40` | (see #36) | `apps/web/src/{game,curiosity,input}`, HUD, gameplay e2e |
| QA-01 | `…PxyJBUB5qRk854hy3` | `ccr-be746a20-5zbpsi` | #43 | `tests/e2e/helpers.ts`, `tests/e2e/reliability.spec.ts`, `.github/workflows/*` (director approval), `docs/{QA,ROADMAP,PERFORMANCE,HANDOFF}.md`, `docs/handover/{PLATFORM_HANDOVER,RELEASE_READINESS,HARDWARE_VALIDATION}.md`, `apps/web/src/profile/*`, `apps/web/src/build-info.ts`, QA-only `debugState()` fields |

**Rules**
1. One writer per branch. Never force-push. Never commit to the integration branch directly. Nobody merges without director approval on the PR.
2. **Shared files** (`apps/web/src/render/Engine.ts`, `apps/web/src/game/Game.ts`, `packages/ecology/src/observe.ts`,
   `docs/INTEGRATION_CONTRACTS.md`, `tests/e2e/helpers.ts`, `playwright.config.ts`, `quality.yml`, `package*.json`): post the
   intended change on #36 **before** implementing it, and name the affected workstreams. Contract changes are additive and versioned.
3. **Before asking for a merge:** rebase-free update (merge the latest integration into your branch), then a green `quality.yml` on the
   **exact head SHA**, then the PR body lists SHA, run link, unit/browser counts and the evidence level of each claim.
4. **Merge order, when several are approved together:** test infrastructure and CI fixes first (unblocks everyone), then contract
   or interface changes, then ecology, then rendering, audio and UX consumers. After each merge, wait for integration CI on the merge SHA
   before the next one. If it goes red, the next merge waits until it is diagnosed (§7).
5. **Determinism-sensitive changes** (anything under `packages/ecology` or `packages/core`) must state their state-hash checkpoints
   and paired-seed evidence (as PR #33 did). Rendering, audio and UX changes must show the simulation hash is unchanged.
6. **Compute:** CI on public GitHub runners only. Long evaluations, such as ECO-01's #34, run where their owner says. Nobody cancels
   another workstream's workflow. Nobody starts paid compute without owner approval.

## 7. Red-integration runbook
1. Read the failing job log (`get_job_logs`), and download the `playwright-reports` artifact within its 7-day retention.
2. Reproduce locally on the same SHA: `npm ci && npm run build && npx playwright test --project=<p> -g "<test>" --repeat-each 5 --trace on`.
3. Classify the failure: product defect / test-synchronisation defect / environment (runner, network). Write the evidence in `docs/QA.md`'s CI record.
4. Fix the underlying problem with a regression test. **Never** loosen a threshold, add a retry or skip a test to get green.
5. Post the diagnosis on #36 and, if the failure blocks other PRs, ping the PR owners.

---

## 8. Release blockers (M5 beta), as of this snapshot

Green CI is a precondition only. **It does not complete M5.**

| # | Blocker | Owner | Evidence needed |
|---|---|---|---|
| B1 | Integration CI green on the latest integration SHA, repeatedly | QA-01 + director (merge #43) | Two consecutive green runs on the merge SHA (candidate `07dd3aa` already green twice on the PR) |
| B2 | Hardware re-run after `c86a691`, on the Victus with both GPUs | owner (device) | `?profile=1` JSON with `build.sha`, `auto.keptQualityUnderLoad` |
| B3 | Midrange Android and iOS phones: touch, 30 fps, thermal | owner (devices) | `HARDWARE_VALIDATION.md` §C reports |
| B4 | Firefox and Safari/WebKit runs; real gamepad | owner + QA-01 (adding WebKit/Firefox projects to CI needs a director decision) | Reports or CI projects |
| B5 | ≥ 30 min live soak; > 20 restarts; context-loss handling; memory slope | QA-01 (software: **done**, `docs/evidence/soak/`, `ee9545d`), owner (hardware: open) | Hardware soak report |
| B6 | Offline launch / storage-failure behaviour: **not implemented** (no service worker) | director decision | Decide whether it is in beta scope |
| B7 | Ecological audio listened to by a human | AUD-01 + owner | Recordings + listening notes |
| B8 | Presentation human-accepted for a public beta | VIS-01/UX-01 + owner | Screenshots/video + acceptance |
| B9 | No open P0/P1 | all | Triage list |

## 8a. Integration risks visible in the open draft PRs (2026-11-25)
- **CI duration:** AUD-01 (#44) adds an `audio` Playwright project and UX-01 (#45) an `experience` project to `npm run test:e2e`.
  The job is about 15 min now against a 45 min timeout. Re-measure after each merge.
- **Shared files:** `tests/e2e/helpers.ts` (QA-owned; UX-01's two additive edits accepted), `apps/web/src/main.ts` (VIS-01/AUD-01 hooks,
  to be coordinated per OPS-02), `package.json` scripts and `playwright.config.ts` projects (#44, #45). Merge order per §6 rule 4: #43 first.
- **Product finding from AUD-01:** production `AudioEngine.update()` plays count-driven random calls. That is an invented-call violation,
  tracked by AUD-01 for integration.

## 8b. DIRECTOR TASK QA-02 results (2026-11-25)
- **#34 browser failure (job 138904227386):** the same mechanism as run 322 (`mismatched` 94 vs 97, same assertion). #34 head `fdf0857`
  contains neither #43 fix and does not touch the terrain path. Remedy: merge #43, then merge the integration branch into #34. ECO-01 withdrew its flake label (#37).
- **#35 100-day ecology timeout (job 138905305806):** runner speed variance (the same SHA `70f7903` passed in run 383 at 69.6 s and timed out in run 382)
  plus a larger, intended population (end population 292 vs 257; same cost per animal). Local: base isolated 66.7 s, #35 isolated 75.8 s,
  #35 full suite 81.5 s. Scheduling trial (ecology file alone in vitest group 0): 78.1 s (−4%) for +28% suite wall time, **not adopted**.
  ECO-01 is taking a semantics-preserving `decide`/`steer` speed-up (≥ 20%, identical hashes). Timeout unchanged.
- **Soak:** 30 min live, 25 restarts and context loss all pass on `ee9545d` (`docs/QA.md` soak section). P3 finding: the simulation keeps running after context loss.

## 8c. DIRECTOR TASK QA-03 results (2026-11-25)
- **Graphics-quality failure, job 139015282427** (`medium: 106,106,90`, spread 16 > 6): ran on #34 head `23ae221` (`feat/open-boundary`),
  which contains none of #43's fixes and still uses the fixed 3.5 s sleep. **Not a `gfxSettled` regression**: it is the pre-fix failure
  (here the low reading came in round 3, not round 1, which matches "read before the preset change landed" in any round). It clears when #34 merges
  the integration branch after #43.
- **#43 current head `68900bd`:** CI green (run 45562738822). Vitest scheduling unchanged, no timeout change (director decision).
- **UX-02 context-loss fix (`5b4370e`, PR #45), checked from the QA side:** QA's opt-in soak context-loss test passes against it. Ticks after
  the loss went from 528 in 5 s (457 → 985) on the old code to 25 (359 → 384, about one 100x frame before the asynchronous `webglcontextlost`
  event); Reload → Continue restores the manual save; no page errors. UX-01's own regression test (in `experience.spec.ts`, no shared-helper
  edits) checks that the tick stays stable for 3 s and that no autosave is written.

## 9. Next QA-01 steps
1. ~~Get PR #43 green on CI~~ (done: `07dd3aa`, runs 384/385). Director review and merge restores B1. Then confirm two green integration runs on the merge SHA.
2. Owner runs the hardware validation package (B2/B3).
3. Propose adding Firefox and WebKit Playwright projects as a non-blocking CI job (decision for the director, because CI time roughly doubles).
4. Software soak: a 30 min live browser run with heap/GL sampling, 25 restarts and a forced `WEBGL_lose_context` test.
