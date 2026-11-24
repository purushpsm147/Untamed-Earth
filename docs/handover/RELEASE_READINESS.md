# Release-readiness checklist (M5 beta)

Reproducible procedure for deciding whether a specific SHA can be called a beta candidate. Fill in one copy per candidate
in a PR comment or on #36. **Every row needs evidence: a run link, a file in `docs/evidence/`, or a named human review.** An
empty row is a "no". Green CI covers only section 1.

Candidate SHA: `________________________________________`  Date: `__________`  Filled by: `__________`

Evidence levels: **SW** = software-verified (unit/headless or SwiftShader Chromium) · **HW(<device>)** = physically verified ·
**HUMAN(<who>)** = creatively accepted.

---

## 1. Automated gates (G0–G4, G10). Reproduce locally and in CI

```bash
git checkout <SHA> && git status --short          # must be empty
npm ci                                            # G0: lockfile install
npm run typecheck                                 # G1
npm test                                          # G2: unit + headless ecology (record "N passed")
npm run build                                     # G1: production bundle (record main JS size raw/gzip)
npx playwright install chromium                   # if not preinstalled
npm run test:e2e                                  # G3/G4: smoke, reliability, gameplay, documentary (record "N passed")
npm run bench                                     # G8: simulation cost per tick
```

| # | Check | Required | Result / link |
|---|---|---|---|
| 1.1 | Clean tree, `npm ci` succeeds | yes | |
| 1.2 | Typecheck | pass | |
| 1.3 | Unit + headless | all pass; record the count (132 at `3a0e7f9`) | |
| 1.4 | Build | pass; main bundle size recorded | |
| 1.5 | Browser suites | all pass; record the count (21 from `daf0ffa`) | |
| 1.6 | GitHub Actions `quality.yml` on **this exact SHA** | success, link | |
| 1.7 | Repeatability: a second green run on the same SHA (re-run, or the next docs-only commit) | success, link | |
| 1.8 | No test skipped, no threshold lowered, no retries added since the last candidate (`git diff <last>..<SHA> -- tests/ playwright.config.ts`) | reviewed | |

## 2. Simulation integrity (G2)

| # | Check | Required | Result |
|---|---|---|---|
| 2.1 | 100-day headless run: all species accounted for, no NaN | SW | |
| 2.2 | Save → reload is bit-identical (state hash), older saves load | SW | |
| 2.3 | Graphics/Auto changes leave the state hash unchanged | SW | |
| 2.4 | Ecology PRs merged since the last candidate list their paired-seed evidence and hash checkpoints | reviewed | |

## 3. Performance and quality governor (G5, G8)

| # | Check | Required | Result |
|---|---|---|---|
| 3.1 | Desktop discrete GPU `?profile=1` on this SHA (or one with no render/governor change since) | HW, `build.sha` matches | |
| 3.2 | Integrated GPU `?profile=1` | HW | |
| 3.3 | Auto: downgrade under load **and** recovery; `keptQualityUnderLoad` under CPU-only load | HW | |
| 3.4 | Midrange phone: 30 fps target, p95 ≤ 33.3 ms after 10 min, no thermal collapse | HW | |
| 3.5 | Restarts: identical GL object counts (software) and stable counts (hardware) | SW + HW | |
| 3.6 | ≥ 30 min live soak: heap slope and stalls recorded; > 20 restarts | SW (+ HW preferred) | |
| 3.7 | Initial compressed transfer < 10 MB, measured on a static host | measured | |

## 4. Browser and device coverage (G7)

| # | Check | Required | Result |
|---|---|---|---|
| 4.1 | Chromium desktop (Chrome/Edge) | HW | |
| 4.2 | Firefox desktop | HW or CI project | |
| 4.3 | Safari macOS / iOS | HW | |
| 4.4 | Android Chrome touch controls | HW | |
| 4.5 | Gamepad | HW | |
| 4.6 | Hidden tab / backgrounding resumes without fast-forward; save on hide | SW + HW | |
| 4.7 | WebGL context loss shows the recoverable message; the autosave is intact (no in-place restore exists) | SW | |
| 4.8 | Offline launch / storage failure: **decision needed** (no service worker today) | director | |

## 5. Experience (G6, G9). These cannot be passed by automation

| # | Check | Required | Result |
|---|---|---|---|
| 5.1 | Fixed-seed screenshots of all four areas, no severe seams, clipping or floating | HUMAN | |
| 5.2 | Unedited 2-min observer/Curiosity recording with audio, hardware and settings stated | HUMAN | |
| 5.3 | Ecological audio listening review | HUMAN | |
| 5.4 | Reduced motion, keyboard-only navigation, mute and volume | SW + HUMAN | |
| 5.5 | Content scope labels: no humans, scientific framing, nothing fictional presented as scientific | reviewed | |

## 6. Triage and sign-off (G10)

| # | Check | Required | Result |
|---|---|---|---|
| 6.1 | Open P0 = 0, open P1 = 0 (list them, with links) | yes | |
| 6.2 | Deferred P2 listed with impact and workaround in `docs/QA.md` | yes | |
| 6.3 | `docs/QA.md`, `docs/ROADMAP.md`, `docs/HANDOFF.md`, the #9 ledger reflect this SHA | yes | |
| 6.4 | Director review | ChatGPT on #36 | |
| 6.5 | Owner acceptance (scope, budget, creative) | owner | |

**A candidate is beta-ready only when every row in §1–§6 has evidence and 6.4 and 6.5 are signed.**

---

## Status at `3a0e7f9` + PR #43 (2026-11-24, QA-01)
- §1: 1.1–1.4 pass locally. Integration CI on `3a0e7f9` is red ([run 322](https://github.com/purushpsm147/Untamed-Earth/actions/runs/44116004501)), and the fix is in PR #43. 1.6/1.7 are open until #43 is merged and green twice.
- §2: SW evidence exists in the unit suites.
- §3: HW evidence exists for one laptop (Vega 8, RTX 3060 Laptop) on a build before `c86a691`. 3.3 (CPU-only load), 3.4, 3.6 and 3.7 are open.
- §4: only Chromium on Windows (the owner's laptop) and SwiftShader Chromium on Linux. Everything else is open.
- §5: nothing human-accepted.
- §6: no P0/P1 known to QA-01. Formal triage is not done.
- **Verdict: not beta-ready.**
