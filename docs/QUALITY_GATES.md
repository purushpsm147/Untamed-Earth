# Quality gates and release criteria

All gates apply to changes that affect their area. A milestone is **not verified** when mandatory evidence is missing. Exception/deferment must be visible in the handoff and cannot silently redefine completion.

| Gate | Requirement | Proof | Block condition |
|---|---|---|---|
| G0 repository integrity | Clean, reproducible dependency install and no overwritten work | HEAD, `npm ci`, lockfile | Undocumented destructive changes |
| G1 static correctness | Strict TypeScript, lint if configured, production build | `npm run typecheck`, `npm run build` logs | Any type/build failure |
| G2 simulation invariants | Deterministic seed+input replay; no invalid state; consistent births/deaths/resources | Unit/headless 10/100-day tests, exact seeds | NaN, unexplained entities, corrupt counts |
| G3 gameplay | Launch, navigation, observer, deer possession, experiment, save/reload | Playwright tests and screenshots | Essential path broken or placebo UI |
| G4 streaming/lifecycle | No permanent geometry/worker/listener leak, no discontinuity on repeated traversal/restart | Repeated start/stop/fast-travel soak, resource counts | Confirmed monotonic leak, missing terrain |
| G5 adaptive quality | Downshift under sustained load, restore detail with headroom, user ceiling, stable FPS governor | Controlled workload trace + renderer setting log | Thrashing, permanent unintended low quality, ecology altered |
| G6 visual fidelity | Real screenshots at fixed seed/view, no clipping, severe seams, scale/lighting/animation defects | Baselines + human/AI review notes | Severe visual defects; unverified realism claims |
| G7 browser/device | WebGL capability errors, input, pause/resume, tab visibility, responsive layout | Browser automation; real hardware evidence for device-specific claims | Crashes or unsupported claims |
| G8 resource budgets | Measure start download, FPS/p95 frame, CPU sim time, draw calls, memory indicators | Scenario/hardware-specific benchmark report | Known severe regressions or misleading metrics |
| G9 accessibility/ethics | Usable UI controls, reduced motion, subtitles where relevant, optional music, content scope labels | Manual checklist + relevant tests | Unskippable flashing, inaccessible critical controls, mislabeled fiction |
| G10 release handoff | Updated docs, known bugs and blockers, repeatable commands, versioned saves | QA/roadmap/handoff/PR record | Undocumented risks |

## Target budgets, not fictional guarantees
Desktop baseline **60 FPS** on specified supported device. Midrange mobile **30 FPS** on specified physical device. Target ~300 MB mobile working footprint where measurable. Prefer <10 MB initial compressed delivery, with additional worlds lazy loaded. For 60 FPS the frame budget is ~16.7 ms; for 30 FPS ~33.3 ms; report frame-time percentile, not mean FPS alone. Browser APIs cannot reliably provide total GPU memory. Never label estimates as actual VRAM or total process memory.

## Severity
- **P0 blocker**: crash/data loss/security-sensitive breakage, destroyed saves, uncontrollable camera, core functionality completely unusable.
- **P1 high**: repeatable memory leak, uncontrolled performance degradation, major simulation integrity corruption, persistent quality regression.
- **P2 medium**: imperfect navigation/LOD, recoverable visual artifact, partially broken controls, limited QA coverage.
- **P3 low**: cosmetic, documentation, noncritical ergonomic gap.

No P0/P1 unresolved for public beta. P2 may be deferred with documented impact/workaround; P3 may remain on backlog.

## Required suites
```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run bench
```
Run only supported commands; report absent executables and skipped tests. Existing Playwright uses SwiftShader (software rendering), **not GPU benchmark evidence**.

## Beta gates
A player can independently load the Reclaimed Valley, travel all four biomes, observe autonomous animals, possess and release the same deer, modify ecosystem conditions, fast-forward with honest achieved rate, save/load correctly, tune quality, and exit without known critical failure. Real-device QA and memory/long-run stability remain open until measured; passing software-Chromium smoke tests alone is insufficient.

## Expansion gates
Curiosity Mode: bounded interest selection, camera collision, manual interrupt, reduced motion and no sim influence.
Social Lens: relationships sourced from actual state, survives possession/save; no fabricated biographies.
World registry: stable IDs, lazy assets, versioned saves.
Space: separated physics, compressed-distance disclosure, satellite orbital lifetime plausibility; aliens disabled by default.
Fantasy/Eden/prehistoric/nuclear: correct labeling, defensible scientific/religious boundaries, independent packs. Simulation Inspectors: no nested ecology engine, recursion depth cap, skippable, no regressions.

## Evidence template
Commit SHA; scenario seed; test command/tool and date; browser/device/version/renderer; quality settings, viewport and target; p50/p95 frame times; FPS, draw calls and memory signals if available; before/after screenshots; identified limitations; link to artifacts. Do not change golden baselines to suppress regressions.