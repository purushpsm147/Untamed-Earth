# Engineering rulebook — mandatory policies

## Fundamental contract
1. Browser-first, offline-capable after caching, no required backend, account, paid API, or massive download. Respect hardware constraints.
2. One truth: simulation state is authoritative; renderer only consumes it. Never fake animal statistics or cause simulation changes through camera movement.
3. Seeded and reproducible: identical initial snapshot + ordered inputs + timestep schedule yields identical state; animation-only random effects may be non-deterministic if clearly isolated.
4. No living humans/humanoids. Natural Earth occurs a century after human disappearance. Historical, scientific, speculative and sacred/mythic representations must be labeled distinctly.
5. Ecological integrity: food is finite, predation and births/deaths have modeled causes, no unexplained respawn or chunk-based teleportation, persistent IDs and relationships.
6. Modes: Observer, Wildlife, Experiment must share one persistent world. Follow → possess → release retains the animal's biography and social state.
7. Scientific honesty: no claims of exact prehistoric behavior, radiological outcomes, terrestrial climate forecasting, physics-accurate 1c cinematic travel, or theological certainty.
8. Default music off; soundscape environmental, optional originally licensed ambient/lofi overlay; no unauthorized media.
9. All eventual aliens and mythical creatures are optional, non-humanoid and cannot alter natural-world behavior when switched off.
10. Never sacrifice core ecology for graphics FPS; rendering can drop LOD, shadow detail, density of purely cosmetic foliage and pixels, but not erase authoritative entities.
11. No placeholder UI that appears finished, no fake FPS, fake GPU VRAM usage, false QA status or screenshots from unrelated projects.
12. Avoid unbounded entities, social graph edges, history arrays, spatial searches, worker queues, render recursion, audio nodes and scene allocations.
13. Idempotent cleanup: every allocated geometry, material, texture, render target, worker, listener and audio node has a clear owner and disposal path.
14. Only support modules needed for active phase. Do not preemptively scaffold expensive, empty fantasy/space modules.

## Development and safety
- Work on an existing branch; inspect HEAD and uncommitted files before edits. Do not overwrite Claude's interrupted work, force push, rewrite history, delete branches, or merge speculative changes without explicit direction.
- Prefer small, reviewable commits with tests and recorded outcomes. External dependencies require justification; security and licenses require review.
- Keep parameters data-driven, code typed, performance-critical loops allocation-aware, and public interfaces intentional.
- Require deterministic repro for ecological bugs where possible; record simulation seeds, input sequence and environment.
- If an API or tool is unavailable, say so. Never claim a screenshot was inspected or a benchmark run unless it happened.
- Preserve working functionality; after fixes run focused regression tests plus smoke test as applicable.
- Avoid shortcuts like ignored TS errors, disabled assertions, silent catch blocks hiding functional failures, hardcoded test-mode behavior, or threshold changes solely to pass CI.
- Version and validate save schemas; corrupt or future saves must fail safely. Do not assume IndexedDB exists.
- Do not use another project's code/assets without license checks and attribution. Abyssal Garden is inspiration, not a required dependency.

## Quality before feature volume
The MVP has four interlinked biomes, six species, headless ecology, persistent deer mode and experiment mode. Only after verification should Curiosity Mode, Social Lens, world selection and expansion packs be added. Visual ambition is naturalistic/photorealistic **as a future objective**, not a ship claim. More content is not progress when memory, behavior or controls regress.

## Three ledgers
- Requirements ledger: implemented/partial/planned/blocked, links to code and acceptance tests.
- Defect ledger: severity, repro, observed/expected, root cause, fix, verification evidence.
- Performance ledger: benchmark case, device/browser/renderer, quality, FPS/frame times, draw calls and memory indicators, with provenance.

## Definition of a valid claim
`Implemented` = code exists and expected behavior can be demonstrated. `Verified` = acceptance tests executed successfully in specified environment. `Hardware validated` = measured on real physical target device. `Planned` is not `implemented`. Mark independent source-review findings as hypotheses until reproduced.