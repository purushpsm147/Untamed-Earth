# Untamed Earth — instructions for Claude Code and other contributors

**Start here on every resumed session.** The repository contains a playable prototype; do not regenerate, replace, or discard it. Read `docs/HANDOFF.md`, `docs/INDEPENDENT_REVIEW.md`, `docs/QUALITY_GATES.md`, `docs/ENGINEERING_RULEBOOK.md`, and `docs/DEV_PLAYBOOK.md` before changing code. Read the canonical vision in `docs/spec/MASTER_PROMPT.md` and all four numbered addenda in `docs/spec/`. Existing `docs/{ARCHITECTURE,SIMULATION,ROADMAP,QA}.md` describe what the current implementation actually does.

## Instruction precedence
1. User's latest explicit direction and safety constraints.
2. Do not destroy working code, overwrite existing work, or invent verification.
3. Quality gates, test evidence, architectural invariants, and performance budgets.
4. MVP-first scope and the product specification/addenda.
5. Implementation preferences where there is a justified tradeoff.

## First action on resume
- `git status --short && git branch --show-current && git log -5 --oneline`; preserve local uncommitted work.
- Inspect `README.md`, `docs/ROADMAP.md`, `docs/QA.md` and the handoff; determine exact current implementation and evidence.
- Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` when the environment supports them; record which actually ran. Do not assume passing from documentation.
- Address the high-priority static-review risks in `docs/INDEPENDENT_REVIEW.md`, adding reproductions and regression tests. Reconcile new commits before changing files.
- Continue only the next unverified milestone. Do not build ocean/space/fantasy until the valley and browser performance are verified.

## Non-negotiable invariants
- Scientific Natural Earth has no living humans/humanoids; setting is 100 years after disappearance.
- Simulation is authoritative, headless, deterministic for seed + ordered inputs, and independent of renderer.
- Preserve entity IDs, needs, relationships, and world state across player possession, save/load, and chunk streaming.
- Auto graphics quality must preserve ecological truth; no untracked population removal or fake metrics.
- Browser-first, optional modules lazy-loaded, static hosting, no mandatory network/login/paid services.
- Never claim photorealism, device support, memory, frame-rate, or ecological calibration without evidence.
- Future content is documentation until separately accepted: world library, social lens, curiosity autopilot, space, dinosaurs, mythic Eden, alien inspectors.
- Implement → run → inspect → measure → fix → rerun → report. No passing result by deleting tests or lowering thresholds.
- Add tests, code review notes, benchmarks, and updated docs to each milestone commit.

## Deliverable every session
A runnable repository, exact commands/results, fixed and outstanding defects, acceptance-gate status, and next implementation step. Use `docs/HANDOFF.md` as the concise continuation checkpoint.