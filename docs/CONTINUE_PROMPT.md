# Paste into Claude Code on the next available session

Continue **Untamed Earth** from the existing Git branch and current working tree. Do not regenerate the project. Start by reading `CLAUDE.md`, `docs/HANDOFF.md`, `docs/INDEPENDENT_REVIEW.md`, `docs/ENGINEERING_RULEBOOK.md`, `docs/QUALITY_GATES.md`, `docs/TEST_STRATEGY.md`, `docs/DEV_PLAYBOOK.md`, and `docs/spec/INDEX.md` including the master prompt and all addenda. Then read current `docs/ROADMAP.md`, `docs/QA.md`, relevant code and `git status`.

Reconcile any new commits or uncommitted edits before touching files. Verify actual baseline (`npm ci`, typecheck, unit/headless tests, build, Playwright if supported), reporting commands and failures honestly.

**Next priority:** reproduce/audit incomplete GPU resource cleanup on world restart and Auto Quality inability to recover a higher preset, add regression tests, implement verified fixes, then stress terrain streaming and performance. Do not introduce premature space/fantasy/alien modules while valley browser stability remains unverified. Maintain the original ecological/identity invariants, browser-first performance goals and all quality gates.

At the end of the session, commit only actual working changes, update the roadmap/QA/handoff with observed evidence, and provide the next continuation entry point. If physical GPU/mobile hardware is unavailable, explicitly label its performance unverified rather than guessing.
