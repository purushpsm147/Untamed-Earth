# Hardware validation package

**Purpose:** collect physical-device evidence that this container cannot produce: real GPUs, integrated graphics, phones,
browsers other than Chromium, gamepads and listening. Each run takes 5–15 minutes. Nothing is uploaded automatically. The tester
attaches the files to a GitHub comment on the director desk (#36) or on the QA-01 PR.

**Owner:** QA-01 maintains this procedure. Testers are the project owner or volunteers with consent. Results are *physically
verified* only for the device and browser named in the report.

---

## 0. Build under test (do this once per round)

```bash
git fetch origin && git checkout <SHA under test>      # write the full SHA in the report
npm ci && npm run build
npm run preview -- --host                               # serves apps/web/dist on http://<lan-ip>:4173
```
- From a SHA that includes `apps/web/src/build-info.ts`, every `?profile=1` report records `build.sha`, `build.dirty` and `build.builtAt`.
  `dirty: true` means the build had uncommitted edits, so the report is not admissible for that SHA.
- For phones on the same Wi-Fi, use `http://<lan-ip>:4173/`. Plain-HTTP LAN origins work for WebGL2. If a browser refuses
  (iOS sometimes restricts storage), use any static HTTPS host serving `apps/web/dist` and note the host in the report.
- Close other heavy tabs and apps. Laptops on mains power, with the power plan noted. Phones above 50% battery, not charging.

## 1. Report template (copy into the comment)

```
Device:            <make/model>            (no serial numbers, no user names)
OS / version:      <e.g. Windows 11 23H2, Android 15, iOS 18.2>
Browser / version: <e.g. Edge 157, Chrome 157, Firefox 140, Safari 18>
GPU string:        <from F3 overlay or report.device.gpu>
Display:           <resolution, refresh rate, window size or full screen, DPR>
Power:             <mains/battery, power plan / low-power mode>
SHA under test:    <full SHA>; report build.sha matches: yes/no; dirty: false
Files attached:    <report JSON names>
Observations:      <stutter, artefacts, heat, fan noise, input problems>
```

**Privacy:** never attach DxDiag, `about:gpu` dumps, crash dumps or screenshots that show account names. The profile JSON
contains only the user agent, the GPU model string, core count, memory class, viewport and DPR, which QA-01 reviewed (PLATFORM_HANDOVER §5).

---

## A. Desktop discrete GPU (e.g. NVIDIA RTX / AMD Radeon RX)

| Step | Action | Evidence |
|---|---|---|
| A1 | Open `/?profile=1`, keep Graphics = **Auto**, press **Enter the valley**, don't touch anything until **Done** (~8 min), **Download report** | `profile-<device>-<gpu>-<date>.json` |
| A2 | Repeat A1 in **full screen** at native resolution (F11) | second JSON |
| A3 | Normal play: Settings → frame-rate **Display rate**, Graphics **Ultra** (manual), fly the observer through all four areas for 2 min with F3 open; note the p95 and frame-time readings | screenshot of the F3 overlay at the worst spot |
| A4 | Set the frame-rate target to 60 and then 30 and confirm the F3 frame time locks to ~16.7 / ~33.3 ms | note |
| A5 | Gamepad (if available): move, look, select, possess a deer, release | note: controller model, any unmapped action |

**Pass criteria (the targets in QUALITY_GATES.md):** High p95 ≤ 16.7 ms at the measured resolution. `auto.recoveredToSettled: true`.
`auto.keptQualityUnderLoad: true` on SHAs that include `c86a691` (the CPU-only artificial load should not push quality down; expect one or a few
undone probes in `auto.governor`). Restarts: identical `gl.buffer/texture/program` counts on runs 1–5. No `spikesOver50ms` on High.

## B. Integrated graphics (Intel Iris Xe/UHD, AMD Vega/680M, Apple M-series)

Same steps as A1–A4. Also do the following.

| Step | Action | Evidence |
|---|---|---|
| B1 | Run A1 **on battery** with the OS power saver on | JSON, power mode noted |
| B2 | 15 min of Curiosity Mode (`C`) at Auto, then note the quality/scale shown in F3 and whether the fan or chassis got hot | note + F3 screenshot |
| B3 | macOS Safari: repeat A1 (reports `heapMB: null`, which is expected) | JSON |

**Pass:** Auto settles at a preset where p95 ≤ 16.7 ms at the 60 target, or it reports a 30 target honestly. It does not oscillate (F3 quality
stays put for 60 s) and does not end at Low with headroom left.

## C. Mobile devices (one midrange Android, one iPhone at minimum)

| Step | Action | Evidence |
|---|---|---|
| C1 | `/?profile=1&short=1` in Chrome (Android) / Safari (iOS), portrait then landscape | JSON for each orientation |
| C2 | Touch controls: drag to look, on-screen stick to move, tap to select an animal, pinch-zoom, open/close every panel | note per control: works / awkward / broken |
| C3 | Settings → frame-rate **30 fps**, play 10 min in Observer + Curiosity; note device temperature (warm/hot), whether frame time stays ~33 ms, and battery % before and after | note |
| C4 | Background the browser for 30 s and return. The world must resume where it left off, without fast-forwarding | note |
| C5 | Rotate the device mid-play; the layout must stay usable | screenshot |

**Pass:** p95 ≤ 33.3 ms at the 30 target after 10 min (no thermal collapse), every control usable, no reload or crash, the save restored after backgrounding.

## D. Cross-browser and accessibility (any desktop)

| Step | Action |
|---|---|
| D1 | Firefox: A1 (no heap API, expected) and smoke (enter, fly, select, save, reload) |
| D2 | Settings → reduced motion on: Curiosity camera moves slowly; no flashing |
| D3 | Keyboard only: every panel opens and closes, focus stays visible, Escape closes menus |
| D4 | Audio: mute, volume and music controls work; **listening notes** (what you heard and whether it matched what was visible). Listening review belongs to AUD-01 and is recorded separately |

## E. What the reports do **not** prove
- GPU memory or total process memory: the web platform does not expose them. `heapMB` is the JS heap only, and Chromium-only.
- True GPU time: frame time is limited by vsync. A device at its refresh cap only proves it has headroom.
- Any device other than the one named. Results from one laptop do not extend to its product line.

## F. Intake (QA-01)
1. Check that `build.sha` equals the stated SHA and `dirty` is false; otherwise mark the report *not admissible*.
2. Privacy-check the attachment (no identifiers beyond §1), then commit it under `docs/evidence/hardware/<date>-<device>-<browser>.json`
   with a row in `docs/PERFORMANCE.md`: device, browser, SHA, p50/p95 per preset, Auto outcome, restarts.
3. Update the #9 ledger row and `RELEASE_READINESS.md` with the evidence level *physically verified (<device>, <browser>)*.
