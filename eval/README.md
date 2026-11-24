# Ecology evaluation store (issues #29 and #31)

**Status:** this branch is evidence only. Nothing here is product code, and nothing here has been merged.

## Contents
- `configs.json`: the frozen configurations. Each records its code SHA, seed range, variant and jackal spacing. The
  protocol is 365 days at dt 2 for every configuration.
- `results/<config>-<seed>.json.gz`: one result per seed. Each was written by `benchmarks/open-boundary-eval.ts` at
  that configuration's frozen SHA, and validated by `collect.py` before it was stored.
- `manifest.json`: done and missing seeds per configuration, the sha256 of every stored file, verification outcomes,
  and the conflict count.
- `verify/`: reproducibility reruns of seed 1 for configurations A–F on GitHub Actions, compared with the stored
  hashes.
- `conflicts.json`: any (config, seed) that was produced twice with different state hashes. It should stay empty.

## Execution
Workflow: `.github/workflows/ecology-eval.yml`. A push that changes `eval/request.json` starts a run.

**Stages:**
1. `plan.py` lists every missing (config, seed) and splits them into batches of 4, one seed per core on a standard
   4-vCPU Linux runner.
2. A matrix runs the batches with at most 16 jobs in parallel. Each job checks out the frozen SHA and runs Node
   22.23.4, the same version as the original runs.
3. Each batch uploads its artifact even if the job fails or times out.
4. A single collector validates the results and commits them with `[skip ci]`.

**Resuming and safety:**
- Pushing the trigger again resumes the evaluation. Completed seeds are never rerun or overwritten.
- Only the collector writes to `results/`, and the workflow's concurrency group allows one run at a time. That rules
  out concurrent write conflicts.
- Every rejected file is logged in the collect job.

## Seed accounting (at hand-off to Actions, 2026-11-24)
| Group | Target | Done | Remaining |
|---|---|---|---|
| A–F (primary) | 6 × 60 = 360 | 93 | 267 |
| Sensitivity (9 configurations) | 9 × 30 = 270 | 0 | 270 |
| M (#31, paired with C) | 60 | 0 | 60 |
| **Total** | **690** | **93** | **597** |

- The 92 seeds from the unstable cloud worker were audited:
  - unique and contiguous from seed 1;
  - correct frozen commit, variant and protocol;
  - 365 daily samples each;
  - byte-identical to the local copies.
- One more seed (C-60) came from the local smoke test of this pipeline.
- An earlier PR comment said "about 320 remaining" for A–F. That was an arithmetic error; the correct figure was 268.

## Compute estimate
- **Single-thread time per seed**, measured on the cloud worker:
  - closed configurations: about 220 s (C-60 took 219 s);
  - open configurations: about 300–400 s (the off-map population and crossings add cost);
  - M: about 250 s.
- **Total:** about 60 core-hours. With batches of 4 seeds on 4-vCPU runners plus about 2 minutes of setup per job,
  that is about 156 jobs and about 25–30 runner-hours, or 1,500–1,800 runner-minutes.
- **Cost:** the repository is public. Standard GitHub-hosted runners are free for public repositories, so these minutes
  are not billed. No paid runner or other paid resource is used.
