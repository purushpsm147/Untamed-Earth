# Developer playbook — resume, implement, test, hand off

## On resuming Claude Code
1. Run `git status --short`, `git branch --show-current`, `git log -5 --oneline`; identify local unpushed commits and working files. Never reset or reclone over this work.
2. Read `CLAUDE.md`, `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/QA.md`, `docs/INDEPENDENT_REVIEW.md`, `docs/QUALITY_GATES.md`, and canonical specs in `docs/spec/`.
3. Record exact branch HEAD and test environment. Run the minimal checks before edits to establish a known baseline; distinguish preexisting failing tests.
4. Select **one** highest-value issue or milestone with explicit acceptance criteria. Prioritize P1 resource lifecycle and Auto Quality recovery.
5. Implement minimal coherent change; add deterministic tests. Inspect actual world rendering if touched.
6. Rerun relevant tests, run full checks at milestone gate, profile impacted workloads. Fix regressions rather than weakening acceptance criteria.
7. Update docs truthfully; commit a small logical unit with test evidence and concise handoff. Do not claim work performed by another session as verified in this one.

## Milestone order (code reality may already span several)
- M0 foundation: install/build/typecheck, WebGL2 detection, clean failure modes.
- M1 world: 2 km² connected forest/river, settlement, waste, meadow/wetland; collision, streaming and visual cohesion.
- M2 environment: day/night, wind, rain, soil/water/vegetation causal coupling.
- M3 ecology: six species, needs, perception, reproduction, mortality, finite food web; deterministic 100-day tests.
- M4 hybrid: Observer→Follow→Possess deer→Release, Experiment controls, time, interface.
- M5 release proof: versioned persistence, error handling, adaptive quality, audio, physical hardware performance, mobile input, browser soak and offline correctness.
- M6+ only after MVP gates: Curiosity Mode; Animal Social Lens; World Library; ocean/desert/heritage/prehistoric/space/mythical/aliens as independent, lazy-loaded expansions.

## Concrete implementation patterns
- Architecture: core → world → environment → ecology → renderer reads state; browser UI sends explicit commands.
- Simulation: fixed step, seeded RNG, spatial hash/local perception; avoid quadratic entity comparisons.
- World streaming: chunk ID + desired LOD + request generation, bounded worker queue; dispose stale meshes, prevent visible seams.
- Rendering: per-species instancing, procedural meshes/materials; quality settings control visual density, not the true ecology. Use reusable buffers and per-view teardown.
- Camera: smooth transitions, collision, immediate manual override; reduced-motion support for autopilot.
- Social: species-appropriate group membership and kinship, compact bounded history; no fabricated animal biographies.
- Save: versioned envelope, explicit migrations, snapshot deterministic state and important camera/game preferences; test restore equivalence.
- Experiments: same seed and input state for controls; display measured variables, not claims of real-world prediction.

## Before calling a feature done
Link implementation path, test path, execution log and screenshot/profile when relevant; include supported-device limitations. If user asks for new worlds, prefer documented design and independent module contracts to fabricated playable modes.

## Release and continuation handoff
Document: current HEAD; completed and incomplete features; tests executed; screenshots, browser traces and benchmark environment; performance and memory evidence; regressions/blockers; precise next code entry point; uncommitted work. Keep the repository runnable even when the coding session is interrupted.