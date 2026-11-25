# ECO-01 handover (ecology): continuation state

The owner session is `session_01MD7GqSBKWnauofqyDvXkjC` (the long-running ecology session). Thread: issue #37.
Director desk: #36. **Read this file, #36 and #37 first after any restart.**

## Ownership
| Item | Owner |
|---|---|
| PRs #27 (memory), #28 (territories), #30 (boundary audit), #34 (open boundary), #35 (#31 maternal) | this session; all drafts, none merged |
| Evaluation store `experiment/open-boundary-eval:eval/` (`configs.json`, `results/*.json.gz`, `manifest.json`, `collect.py`, `plan.py`) | this session |
| Actions execution of the frozen evaluation: run 45378622930 and gap reruns, artifacts on branch `ccr-776cce8c-3adley` | `session_01MD7GqRhnJjYtuCmrEar82u` |
| VIS-01, AUD-01, UX-01, QA-01 | owner-started sessions listed on #36. Do not create duplicates. |

## Frozen configurations (`eval/configs.json`)
| Configuration | Commit |
|---|---|
| A | `ac28733…` |
| B | `868ca7b…` |
| C | `6980dde…` |
| D, E, F, the nine sensitivity configurations, G | `ce83f68…` |
| M (#31) | `89d3a45…` |

- Protocol: 365 days at dt 2, Node 22.23.4.
- Pre-registration: `docs/OPEN_BOUNDARY_DESIGN.md` revision 3 + amendment 3a on `feat/open-boundary`.
- **Never change a parameter or threshold after seeing results.**

## State (2026-11-24)
- 93 audited seeds are stored: A 1–25, B 1–28, C 1–29, D 1–3, E 1–5, F 1–3.
- 597 seeds remain: 267 primary, 270 sensitivity, 60 for M.
- Actions run 45378622930 recomputes all 690 seeds with Node "22". Treat the overlapping 93 as a cross-version reproducibility check, and report any hash mismatch.
- Next steps:
  1. When that run completes, download its artifacts and run `python3 eval/collect.py <dir>` (single writer: no overwrites, conflicts recorded).
  2. Commit the results.
  3. Fill gaps only in coordination with `…RhnJ`.
  4. When all 690 are stored, run `eval/analysis.py`, write the report, and update PR #34 with effect sizes, confidence intervals, extinctions, migration and inconclusive findings.
- #35 (#31) has a known defect, found by `…RhnJ` at commit 7be3162 on `ccr-776cce8c-3adley`. A Defend/Alert standoff: the jackal stays alert while a defending chital mother holds about 11 m away (90th-percentile alert duration 21 game hours), and young-chital kills fell 187 → 13. **Fix this before interpreting configuration M.** M's frozen SHA predates the fix, so it will need a re-freeze after director review.
- Local runs on the unstable worker are stopped. Use Actions only. The repository is public, so runner minutes are not billed.

## Mechanisms
- Scheduled poll every 4 hours (trigger `trig_016wskanAe3SSGcD9g92QMkM`).
- PR subscriptions on #34 and #35.
- Director tasks are acted on only when they begin with `DIRECTOR TASK <ID>:` (the convention proposed on #36; awaiting director confirmation).

## Outstanding owner actions
- Archive three idle duplicate sessions (`…RPXTVZ5HzuuLgYdGJ`, `…RKJTSNdP7KSQ3SxS7`, `…T45DhUsfzPQaNUUem`). The permission system blocked me from archiving them.

## Checkpoint 2026-11-25 (session …SBKWnauofqyDvXkjC)
- **Evaluation complete.** Actions run 45378622930: 690/690 seeds; manifest `ccr-776cce8c-3adley:docs/evidence/eval-actions/` at
  `7bf4283`. This is the single reconciled manifest (ECO-03).
- **Cross-environment check.** All 93 local seeds here, including C-60, are hash-identical to it (#37, comment 7141584365).
- **Verdict (report `c6655ba`).** PR #34 at `ce83f68` fails acceptance because of the transit stall.
- **Fixed in `fdf0857` on `feat/open-boundary` (amendment 3b, proposed).**
  - Five root causes, 11 regression tests and a 20-day smoke test.
  - Probe (seeds 1/4/7, 160 days): transit p99 85–103 h → 0.6 h; corridor starvation and dehydration deaths 65–99 → 0.
  - Closed hashes are unchanged.
  - Details: PR #34, comment 7149418545.
- **Merged into PR #35** (`edc0c48`). PR #35's CI is still red: the 100-day test hits the 120 s timeout. That decision belongs to
  QA-01 or the director (#35, comment 7141533792).
- **Waiting on the director (#37, comment 7149420892):**
  - approval of the D′/E′/F′/G′ re-run at `fdf0857`, which session …RhnJ would execute;
  - re-freezing M′.
- **Next for this session:**
  - after approval, add the D′–G′ entries to `eval/configs.json` and collect the results;
  - otherwise, continue the PR #35 per-animal performance work.

## Checkpoint 2026-11-25 (later, session …SBKW)
- **DIRECTOR TASK ECO-05** acknowledged (#37, comment 7154300917). Items 1–4 delivered in `23ae221` (#37, comment 7154454475):
  - every residual `Idle` tick in transit lasts a single tick;
  - deaths in transit are predation, background or age, with no starvation or dehydration;
  - the ledger is exact at 0.1, 0.25, 1 and 2 s;
  - the scenario tests run at all four ticks.

  The re-run stays on hold. RhnJ owns the manifest.
- **"Flake" label withdrawn** on #34's terrain browser failure. Per QA-01, it is the stale-camera / coarse-placeholder defect fixed by #43.
- **QA-02 option 2 (#35 timeout): `b122c93`**, a hash-identical speed-up of −11% to −12.5%, merged into #35 as `39305a3`.
  - Short of the 20% target; option 1 (scheduling) belongs to QA-01.
  - #35 comment 7155060758.
- **Next:**
  - watch the CI result for `39305a3`;
  - wait for director decisions on the re-run and on M′;
  - no new work started without a DIRECTOR TASK.
- **2026-11-25 ECO-07** (#37, comments 7162849241 and the proposal after it):
  - Neighbour pruning measured and rejected: at most about 2% of runtime, and 8,842 drifted neighbours would be missed without a drift bound.
  - Proposed a flat bucket-sorted spatial hash on branch `perf/csr-spatial-hash` @ `6ad43e6`.
    - Hash-identical, with a call-by-call equivalence test.
    - −14.5% on open-boundary code and −7.7% on #35 code.
  - **Not merged into #34 or #35;** awaiting the director. Stopped per ECO-07.
- **2026-11-25 ECO-08** (#37, comment 7168951080). All local, no push:
  - Lifecycle fix `e135394` on local `perf/csr-spatial-hash`: insert or clear during a query throws; `clear` releases references; 5 spatial tests.
  - Checkpoints at dt 0.1, 0.25, 1 and 2: identical hashes and ledgers.
  - Vitest 100-day test on #35: 55.9 s → 52.9 s (−5.3%); projected slow runner about 116 s.
  - Optimisation stopped per ECO-07.
  - **Local-only commits:** `e135394` (wt-ob, `perf/csr-spatial-hash`) and `40c5b39` (wt-m35c). If the director adopts the candidate, push `perf/csr-spatial-hash`, then merge into `feat/open-boundary` and #35.
