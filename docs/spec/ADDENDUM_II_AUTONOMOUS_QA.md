# Addendum II — Autonomous QA, beta testing and corrective loop

This extends the Master Prompt; it is not permission to abandon the current milestone. Claude Code must **build → run → explore → measure → diagnose → fix → retest → record**, beginning from the first playable scene and continuing at each release gate. A successful compilation is not a working game.

## Review roles
- **Developer** implements coherent features and regression fixes.
- **Independent QA reviewer** attempts to break behavior, verifies user-visible flows and catches incomplete implementations.
- **Performance reviewer** records frame time distribution, CPU cost, GPU-related draw calls and memory evidence.
- **Visual reviewer** inspects screenshots against art direction; screenshot diff is consistency checking, *not* proof of photorealism.
These may be Claude Code subagents or sequential independent review passes depending on available tooling. Never claim a separate agent inspected what it did not.

## Gameplay browser paths
Automate opening the page, selecting seed/quality, loading terrain, navigating all four biomes, animal select/follow, enter/exit deer, graze/drink/rest/escape, switching modes, changing rainfall/growth/fertility/populations, speed 1×/10×/100×, charts, pause/unpause, graphics changes, save/reload and failure handling. Include deterministic scripted camera paths, seeded fuzzed input traces, repeated reset and chunk-boundary traversal. Collect screenshots, console and page errors, trace files and reproducible inputs.

## Headless ecological tests
At minimum 1-, 10-, 100-day seeded runs, with invariant checks for unique IDs, finite bounded needs, nonnegative biomass, correct births-deaths population accounting, hunger/feeding, water depletion, carcasses, reproduction, threat-limited perception, and deterministic save/resume. Create scenario A/B from identical seeds for drought and predator/resource changes. Observe population trajectories rather than forcing stability. Genuine ecological collapse and migration may be valid; investigate unexplained events rather than hardcoding expected outcomes. Distinguish rules of the simplified model from empirical ecological predictions.

## Visual inspection
Save screenshots at fixed seed/time/camera for daylight, night, rain, river, wetland, forest, city ruins, waste dump, wildlife up close, biome seam, shadows, Low/Medium/High; eventually Curiosity Mode and World Library. Look for holes, seams, clipping/floating animals, broken lighting/shadows/water, unnatural vegetation, scale, animation and HUD. Human visual review remains necessary for aesthetic quality. Baselines must not be rewritten solely to green a failing test.

## Performance, resource and endurance tests
Repeatable benchmark camera path with recorded browser/OS/GPU/CPU/RAM/viewport/quality/backend. Capture FPS, p50/p95/p99 frame time, frame spikes, JS simulation update time, draw calls/triangles, active animals, loaded chunks, bundle/download size, JS heap if available, total browser process memory only if accessible. No unsupported VRAM claims. Stress dense vegetation, weather, rapid camera flight, multiple animals, quality toggles, speed 100×/1000×, save/restore, repeated world restarts and ≥30-minute soak where feasible. Compare memory slopes after warmup/GC; do not misclassify one-time initial allocations.

## Device/browser policy
Chromium SwiftShader is valuable for smoke tests, **not physical-GPU proof**. Test actual supported GPUs and Android/mobile browsers where available. Mobile emulation is controls/layout verification, not real thermal, memory or FPS validation. Try Firefox/WebKit as supported; explicitly state skips. Verify hidden-tab policy, reload, context loss and IndexedDB failure.

## Autonomous defect process
1. Reproduce and log exact seed, steps, browser/OS, console error and observed/expected.
2. Isolate root cause, classify P0/P1/P2/P3 and add focused failing regression test.
3. Apply smallest maintainable fix; do not silence errors, loosen thresholds or remove checks.
4. Re-run reproduction, relevant unit suite, browser smoke and performance case.
5. Log evidence and remaining uncertainty. Stop unproductive guess loops, document blocker.

## Artifacts
Update `docs/QA.md`, `docs/ROADMAP.md` and `docs/HANDOFF.md`; create `docs/reports/PERFORMANCE_REPORT.md`, `VISUAL_REVIEW.md`, `ECOLOGY_VALIDATION.md`, `BETA_RELEASE_CHECKLIST.md` when evidence exists. Do not create empty congratulatory reports. Use screenshots, trace names, exact device provenance; keep bulky binaries out of Git unless justified.

## Mandatory QA gates
Typecheck, unit/headless, production build, actual browser interaction, relevant visual screenshots, resource lifecycle, user-facing control correctness, save consistency, honest performance context and known limitations. Never mark a milestone verified when mandatory evidence is absent; no known P0/P1 can enter public beta. See `docs/QUALITY_GATES.md` and `docs/TEST_STRATEGY.md`.

## Beta readiness
Enter, traverse all biomes, observe autonomous wildlife, possess/release a deer, alter the world and see actual effects, fast-forward accurately as defined, save/continue, adjust quality, finish an extended session without critical faults. Performance and memory claims require actual measurements, not self-report.
