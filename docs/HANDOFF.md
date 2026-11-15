# Continuation handoff — 2026-11-15

## Branch and observed snapshot
Independent review target: `ccr-4783fee0-8wvc41` at `14e57324832b7b74c79f3b6a64feb44b5ddc13a4`. This was the only listed development branch at inspection. A separate documentation branch was created to avoid overwriting in-progress Claude Code changes. **Recheck the live branch HEAD** before applying any suggested fix or merging other work.

## Existing implementation observed in repository (not independently executed)
- Workspace: TypeScript/Vite/Three.js WebGL2, code in `apps/web`, `packages/core`, `packages/worlds`, `packages/environment`, `packages/ecology`, `packages/persistence`.
- Procedural ~2.07 km² Reclaimed Valley with forest/river, settlement, dump, meadow/wetland; chunked terrain meshed in a Worker, instancing for vegetation and wildlife.
- Species: chital, boar, jackal, hare, crow, myna. Headless environment and animal simulation, three modes (Observer, Wildlife as deer, Experiment), rain/time variation, IndexedDB snapshots.
- Tests present: core/world/ecology unit suites, 100-day headless test, one Playwright end-to-end smoke test. Existing `docs/QA.md` reports typecheck/build/test passing in Claude's environment with software-rendered Chromium.
- Existing honest limitations: no real-GPU FPS, memory or mobile validation; audio not listened to; no full animal↔abstract population promotion; no true multi-region simulation; wall/path navigation gaps.

## Independent review status
Static source and documentation review completed through connected GitHub access; **no local install, browser playthrough, hardware profiling, or independent execution** was possible from the reviewing environment. Findings and evidence in `docs/INDEPENDENT_REVIEW.md` should be treated as actionable hypotheses requiring reproduction, not pre-certified runtime failures.

## Suggested next sequence, in priority order
1. Protect current state (commit or stash user/Claude modifications; never reset without approval).
2. Run fresh typecheck, unit, headless, production build, Playwright in clean environment. Save command output and environment.
3. Resource lifetime: audit all render geometry/material allocations; implement complete disposal/restart coverage and repeated-restart tests.
4. Auto Quality: verify downgrade-and-recover to higher preset after sustained headroom, with user ceiling/cooldown and deterministic quality-controller tests.
5. Terrain streaming: test fast camera movement and out-of-order Worker results, stale LOD updates and disposal.
6. Long browser soak; GPU or mobile hardware where available. Report real measured FPS, p95 frame time, memory and bundle sizes; distinguish software rasterizer.
7. Additional survival/AI behavior and navigation tests; refine ecology parameters and high-speed numerical stability.
8. Minimal Curiosity Mode only when the underlying camera and ecological event systems are stable; Social Lens after persistent relationships exist.
9. World registry and expansions remain unimplemented future work until their prerequisites pass.

## Commands (verify against package.json)
```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run sim -- 150 7
npm run bench
npm run dev
```
Do not claim commands were run if they were not. The reported 100-day tests are intentionally long; provision CI timeouts accordingly.

## Developer handoff template
- Branch/HEAD and working-tree status:
- Milestone, scope, accepted changes:
- Commands actually run, environment, results, artifacts:
- FPS/p95 frame time/heap/GPU indicators with measurement provenance:
- Known defects (severity + reproducer):
- Requirements deliberately deferred:
- Exact next file/function/test:
- User-visible demo/screenshots:
- New commits pushed / PR link:

## Where to look
The product vision is in `docs/spec/MASTER_PROMPT.md`; beta-test addendum, living worlds, adaptive quality, Simulation Inspectors in `docs/spec/`. The executable policies are `docs/ENGINEERING_RULEBOOK.md`, `docs/QUALITY_GATES.md`, `docs/TEST_STRATEGY.md`, `docs/DEV_PLAYBOOK.md`.