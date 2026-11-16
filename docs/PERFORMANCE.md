# Performance profiling

## Status
**First real-hardware data (2026-11-15):** one laptop, two GPUs, run by the project owner with `?profile=1` in Edge 157.
No phone has been profiled. SwiftShader numbers further down are kept only as a software baseline.

## Real hardware: HP Victus 16 (2026-11-15)
Ryzen 7 5800H (8 cores / 16 threads), 16 GB RAM, Windows 11, 1920×1080 144 Hz panel; browser window 1490×706 CSS px at
DPR 1.25. Reports: [`evidence/profile-hp-victus16-radeon-vega8-run1.json`](evidence/profile-hp-victus16-radeon-vega8-run1.json),
[`run2`](evidence/profile-hp-victus16-radeon-vega8-run2.json) (integrated Radeon Vega 8, driver 31.0.12044.3) and
[`evidence/profile-hp-victus16-rtx3060-laptop.json`](evidence/profile-hp-victus16-rtx3060-laptop.json) (GeForce RTX 3060 Laptop, 6 GB).

| GPU | Preset | p50 | p95 | p99 | worst | fps | draw calls | triangles | render CPU |
|---|---|---|---|---|---|---|---|---|---|
| Radeon Vega 8 (run 2) | Low | 6.9 ms | 7.0 | 7.1 | 34.8 | 143.6 | 68 | 296 k | 1.17 ms |
| | Medium | 6.9 | 7.0 | 7.4 | 27.8 | 142.6 | 124 | 757 k | 1.77 |
| | High | 6.9 | 7.3 | 13.9 | 21.0 | 137.5 | 169 | 1.25 M | 1.94 |
| RTX 3060 Laptop | Low | 6.9 | 7.0 | 7.1 | 48.7 | 143.8 | 68 | 296 k | 1.41 |
| | Medium | 6.9 | 7.0 | 7.1 | 7.4 | 144.0 | 124 | 757 k | 1.73 |
| | High | 6.9 | 7.0 | 7.1 | 28.0 | 143.8 | 169 | 1.26 M | 2.12 |

Reading the numbers honestly:
- **Every preset on both GPUs sits at the 144 Hz refresh interval (6.9 ms).** "Uncapped" in the profiler still follows the
  display's vsync, so this proves headroom on High at this window size, but it cannot rank presets or say how much spare
  GPU time exists. Only the integrated GPU shows occasional drops on High (p99 13.9 ms). No frame exceeded 50 ms.
- Simulation cost: 0.02–0.18 ms per tick. Render submission (CPU): 1.2–2.3 ms per frame.
- **Auto quality** settled on High (the automatic ceiling; Ultra is never chosen automatically and was not measured).
  Under the artificial load it stepped resolution 100→50%, then Medium, then Low at 80%; after the load was removed it
  climbed back to High at 100% in ~65 s on both GPUs (`recoveredToSettled: true`). Downgrade and recovery are therefore
  **verified on real hardware**.
- **Finding:** the artificial load is main-thread CPU work, which lower graphics cannot fix, yet the governor went down to
  Low. **Fixed in `c86a691`** (not yet re-measured on this laptop): every automatic downgrade is now a trial. The median frame
  time over 1.2 s before it (at least 8 frames) is compared with 0.3–1.5 s after it (at least 8 frames), and a step that did not cut frame time by 5% while
  still overloaded is undone exactly. Further downgrades are then held for 30 s, doubling to 8 min, unless frame time gets
  30% worse. This measures whether settings helped; it does not classify the device as CPU- or GPU-bound. The
  `?profile=1` report now includes `auto.keptQualityUnderLoad` and `auto.governor` (trials, helped, undone, last trial
  with before/after ms). **Pending:** a re-run on the Victus (both GPUs) to confirm Auto stays on High under the load.
- **Restarts:** live WebGL objects stable across restarts 1–5 (395 buffers, 7 textures, 29 programs; VAO count varies
  163–174 without trend). JS heap varied 44–108 MB with no monotonic growth; the browser did not expose forced GC, so
  the heap figures are noisy.
- Not yet measured: Ultra, full-screen 1080p, true GPU time (needs timer queries), a phone.

## How to profile a real device (about 5 minutes)
1. `npm run build && npm run preview` (or deploy `apps/web/dist` to any static host), then open
   `http://<host>:4173/?profile=1` in the browser you want to measure. Add `&short=1` for a ~2-minute pass.
2. Press **Enter the valley** (leave Graphics on Auto). Keep the tab visible and the window still until the panel says
   **Done**, then press **Download report (JSON)**. Nothing is uploaded anywhere.
3. Optional extra evidence: press F3 in normal play to see live frame time, quality, render scale, draw calls,
   triangles, JS heap and the GPU string.

What the run does (`apps/web/src/profile/ProfileRunner.ts`), with the frame-rate cap off so frame times show what the
device can do:

| Phase | What is measured |
|---|---|
| Low, Medium, High | Fixed camera route through all four areas; frame time p50/p95/p99, worst, spikes > 50 ms, fps, simulation and render CPU ms, draw calls, triangles, geometries, JS heap |
| Auto | Starts from the hardware assessment; 30 s settle; quality and render scale logged every second |
| Recovery | 30 ms of artificial main-thread work per frame for 25 s, then removed; checks Auto returns to its settled quality within 90 s |
| Restarts | Six world loads (same seed, Low, same pose): JS heap after GC where exposed, live WebGL buffers/textures/programs/VAOs/framebuffers |

Limits that are inherent to the web platform: GPU memory cannot be measured; JS heap is available only in Chromium
(`performance.memory`) and excludes GPU-side buffers; GC can only be forced when the browser exposes it.

## Baseline: SwiftShader, 2026-11-15 (not real hardware)
Headless Chromium 153, ANGLE/Vulkan SwiftShader, 4 cores, 1280×720, DPR 1. Raw report:
[`evidence/profile-swiftshader-2026-11-15.json`](evidence/profile-swiftshader-2026-11-15.json).

| Preset | p50 | p95 | fps | Draw calls | Triangles | Sim/tick | Render CPU |
|---|---|---|---|---|---|---|---|
| Low | 250 ms | 983 ms | 3.3 | 62 | 284 k | 0.49 ms | 27.5 ms |
| Medium | 517 ms | 1517 ms | 1.9 | 115 | 736 k | 0.32 ms | 47.4 ms |
| High | 850 ms | 1767 ms | 1.4 | 158 | 1.17 M | 0.34 ms | 66.1 ms |

- Auto: settled on Low at 60% resolution; under the artificial load it went to 50%; it could not recover because a
  software rasteriser never has headroom (`recoveredToSettled: false`). **Recovery is unverified until a GPU run.**
- Restarts 1–5: identical WebGL object counts (299 buffers, 5 textures, 17 programs, 67 VAOs, 3 framebuffers); JS heap
  50.5 → 71.6 → 71.3 → 67.2 → 66.9 MB, i.e. a plateau after the second load rather than steady growth.
- The simulation costs well under 1 ms per tick here; on this machine all the time goes into rasterisation.

## Instance-buffer sizing (measured, then fixed)
Measured on Low at a fixed pose before the change: instance buffers allocated **10.82 MB** (scatter 9.0 MB, grass
1.41 MB, animals 0.41 MB) while **0.14 MB** was in use, held twice (CPU array plus GPU copy). Scatter buffers now grow
on demand and shrink with 4× hysteresis; grass is sized to the preset. After: **0.72 MB on Low** and **1.57 MB on High**,
with identical drawn counts (scatter 1,031, grass 823, animals 100 at the same pose on Low). Rain (0.11 MB) and the
animal buffers (0.41 MB) were left as they are: too small to matter.
