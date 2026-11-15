# Performance profiling

## Status
**No physical GPU or phone has been profiled yet.** The development container has no GPU and no user computer was
attached, so every number here comes from SwiftShader (a CPU rasteriser). Those numbers show relative cost between
presets and verify bookkeeping (leaks, buffer sizes); they say nothing about real frame rates.

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
