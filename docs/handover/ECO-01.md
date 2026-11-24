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
