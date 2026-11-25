# Consolidated ecology report: memory × territoriality × open boundary (issues #29, #31)

Ecology and simulation lead (session `…RhnJjYtuCmrEar82u`), 2026-11-24. Branch `ccr-776cce8c-3adley`.

**Research findings and production acceptance are kept separate.** §1–§5 are research results. §6 is the
acceptance verdict, and §7 lists the decisions requested from the director. Nothing here was merged, no frozen
configuration was changed, and no species was added.

## 0. Provenance and reproducibility
| Item | Value |
|---|---|
| Evaluation run | GitHub Actions [45378622930](https://github.com/purushpsm147/Untamed-Earth/actions/runs/45378622930), workflow `.github/workflows/ecology-eval.yml` at `700245d`. 92 jobs plus aggregation, all successful |
| Pinned code | A `ac28733` (`baseline/m2-b1`); B `868ca7b` (`baseline/memory-b1`); C `6980dde` (`baseline/territories-b1`); D/E/F, sensitivity and G `ce83f68` (`feat/open-boundary`, amendment 3a); M `89d3a45` (`feat/maternal-instincts`, pre-fix). Each job checked out and verified its SHA before running |
| Design | 365 game days, dt 2, identical weather. A–F and M: seeds 1–60. Sensitivity and G: seeds 1–30. Pre-registration: `docs/OPEN_BOUNDARY_DESIGN.md` at `ce83f68` (revision 3 + amendment 3a) |
| Raw data | `docs/evidence/eval-actions/runs.tar.gz` (690 per-seed JSON files); `manifest.tsv` (config, seed, commit, hash) |
| Analysis | `benchmarks/ecology-consolidated-analysis.py` → `consolidated-analysis.txt` and `consolidated.json`. The pre-registered script's outputs are in `analysis-A-F.txt` and `analysis-sensitivity.txt`. Mechanism breakdowns are in `chital-mechanism.txt` and `jackal-mechanism.txt` |
| Statistics | Paired effects are reported as the median paired difference with a seed-bootstrap 95% CI (10,000 resamples). Extinction transitions use an exact McNemar test, with Holm correction across each contrast's primary family (5 abundance/predation measures + 4 extinction outcomes). Proportions use Wilson 95% CIs |

**Integrity checks, from the outputs alone:**
- **Conservation ledger.** For all 690 configuration-seed records:

  > founders = end on-map + end off-map + on-map deaths + off-map deaths + departures − births − initial regional

  is 52/20/6/64 every time. Regional transfer leaks no count.
  **Limitation:** an animal stalled in the corridor (§4) is counted as on-map, and the ledger cannot detect that.
- **Determinism across environments.** 92 of 92 seeds that also exist from the earlier local runs (Node 22.23.4/5,
  a different machine) have **identical state hashes** on the Actions runners.

## 1. Memory: A → B (failed-target memory, #27)
n = 60 paired seeds.

**Jackals persist far better.**
- Local extinction 38 → 8 (33 rescued, 3 newly extinct; Holm p < 0.0001).
- Jackal-days +2,044 [+1,518, +2,423].
- Litters +8.

**But each jackal hunts less, and predation as a whole rises.**
- Kills per jackal-day −0.049 [−0.070, −0.037].
- Total kills +134 [+85, +161].
- Chital juvenile predation +28.
- Chital cohort survival −0.137.

**Hares lose.**
- Extinction 12 → 30 (21 new vs 3 rescued; Holm p = 0.001).
- Hare-days −11,010 [−16,990, −2,724].

**Reading.** Memory removes a navigation artefact (jackals pacing at unreachable targets). Nothing else then
regulates jackal numbers, and predation pressure on hares rises.

## 2. Territoriality: B → C (territorial pair breeding, #28)
**It regulates jackals.**
- Jackal-days −1,750 [−2,253, −1,126].
- Litters −10.
- Kills per jackal-day +0.064 (fewer, better-fed jackals).
- Chital juvenile predation −9, cohort survival +0.051.

**Jackal extinction comes back.** 8 → 28 (24 new vs 4 rescued; Holm p = 0.0013). The valley holds a median of only
0.84 full breeding pairs per day (seed median of the daily mean), and in a closed valley vacancies wait for outsiders
who never come.

**Hares: no effect.** Extinction 30 → 28 (p = 0.85). Hare-days −468 [−3,285, +2,691].

**Combined, A → C.**
- Hare extinction 12 → 28 (Holm p = 0.007).
- Chital extinction 8 → 1 (raw p = 0.039, Holm 0.27).
- Jackal extinction 38 → 28 (Holm p = 0.52).

**Interaction (closed boundaries).** Memory and territories push jackal persistence in **opposite directions**:
A 38 → B 8 → C 28 extinct of 60. Hare extinction follows memory and is unaffected by territories. The B1-corrected
closed results reproduce the direction of every Gate 2 finding on #28.

## 3. Open boundary as implemented: C → D, with E and F controls
These numbers measure the frozen `ce83f68` implementation. **§4 shows that they are partly an artefact of an
implementation defect, so they must not be read as ecology.**

| Extinct of 60 (local / resident lineage / recolonised) | A | B | C | D | E (zero inflow) | F (no flee exit) |
|---|---|---|---|---|---|---|
| Jackal | 38/38/0 | 8/8/0 | 28/28/0 | **28/57/30** | **60/60/0** | 12/49/7 |
| Hare | 12/12/0 | 30/30/0 | 28/28/0 | **3/8/0** | 2/2/0 | 17/26/1 |
| Chital | 8 | 3 | 1 | **20** | 24 | 14 |
| Boar | 0 | 2 | 0 | 0 | 0 | 0 |

**C → D.**
- **Hares.**
  - Extinction 28 → 3: 26 rescued, 1 new (Holm p < 0.0001).
  - Hare-days +41,880 [+35,460, +47,080].
  - Resident-lineage hare-days +21,500 [+17,550, +27,190] (48/60 seeds). **The gain is not only immigrants.**
  - Resident hares persist because predation collapses: hare kills per 1,000 hare-days fall 9.19 → 1.58.
- **Jackals.**
  - Jackal-days −1,291 [−1,529, −989] (57/60 seeds).
  - The local extinction count is unchanged (28 → 28, with 16 newly extinct and 16 rescued). But the resident
    lineage is extinct in 57 of 60 seeds, and jackal presence is maintained by regional turnover (30 recolonisations).
  - On-map jackal mortality is 2.22 per animal-year, against 0.55 in C and 0.39 off-map.
  - **48% of on-map jackal deaths are from dehydration, against 0% in A, B and C** (§4).
- **Chital.**
  - Extinction 1 → 20: 20 new, 1 rescued (Holm p = 0.0001). Chital do not migrate.
  - The mechanism is predator release followed by a starvation crash:
    - jackal predation on chital falls 50 → 6 per seed;
    - the chital peak is higher in 53 of 57 seeds that differ (median 79 vs 71) and comes later (day 86 vs 74);
    - juvenile starvation doubles (11 → 24), starvation deaths rise from 44 to 84 per seed, and extinction follows on
      days 186–360.
  - Across configurations chital extinction rises with hare abundance (7/138 in the lowest hare-days quintile, 47–51
    in the top two), but **not within D** (10/30 vs 10/30). So hare competition for forage is **not established**
    as a separate cause.

**E → D (immigration itself; same off-map draws).**
- Jackal extinction 60 → 28 (32 rescued, 0 new), and jackal-days +464.
- More predation follows: hare kills +76, resident-lineage hare-days −15,420.
- Hare extinction unchanged (2 → 3).
- **E is a trap, not a neutral control.** Every exit is permanent: 31,300 suppressed re-entries per seed-year, so
  any excursion is a death sentence for the valley population. Its "jackal 60/60" result is **structural**.

**F → D (flee exits).**
- This is the largest single driver of the jackal decline.
- Hares that flee into the corridor escape: hare kills −208 per seed, and hare extinction 17 → 3.
- Jackal-days −1,279 (59/60 seeds), and jackal extinction 12 → 28 (Holm p = 0.0125).
- **In effect, flee exits act as a hare refuge at the map edge.**

**Sensitivity (30 seeds, vs D on the same seeds; extinctions jackal/hare/chital).** D itself: 12/2/10.

| Configuration | Jackal / hare / chital extinct |
|---|---|
| S-W720 | 30/2/9 |
| S-W2160 | 4/3/8 |
| S-K13 | 14/2/11 |
| S-K1 | 14/0/9 |
| S-H05 | 16/1/8 |
| S-H15 | 18/1/10 |
| S-J720 | 12/3/9 |
| S-J1200 | 20/2/9 |
| **G (off-map hazard ×2)** | **28/2/13** |

- **Hare rescue is robust** to every pre-registered parameter (0–3/30 extinct).
- **The jackal outcome is not robust.** It is determined by the off-map assumptions (ring width 4/30 to 30/30;
  doubling the off-map hazard 12 → 28/30).
- Off-map jackal mortality (0.39 per animal-year, with no explicit predation) is 5.7× lower than on-map. G shows that
  this optimism decides the result.

## 4. Implementation defect in `ce83f68` (PR #34): animals stall in the transit corridor
Found while explaining the 48% jackal dehydration share. Read-only probes: `benchmarks/ecology/boundary-*-probe.ts`;
evidence in `docs/evidence/boundary-transit-stall/`.

- **Where jackals die.** Seed 1: 15 of 26 jackal deaths happen outside the valley, in the corridor, while in transit.
  Seed 4: 14 of 15. None are off-map (regional) animals.
- **How long transit lasts** (corrected 2026-11-25; seeds 1 and 4, 160 days; 1 s = 1 game minute):
  - a normal transit takes 22–24 s at the median;
  - stalled tails: jackal p99 3,422–4,976 s (57–83 game hours); hare p99 6,008–6,194 s (100–103 h), longest
    8,170 s (136 h);
  - 0–7 animals are still in transit at day 160;
  - while in transit, jackals are `Idle` 96% of the time, with thirst at the maximum (median 1.0).
  - **Correction:** the first version of this report gave p99 12–16 game days, longest 24–66 days, and 130–166
    animals still in transit. Those figures came from a bug in my probe: a transit start time was not cleared when an
    animal left the map, so time spent off-map was counted as transit. The fixed probe is
    `benchmarks/ecology/boundary-transit-durations-probe.ts`. The corrected values agree with the PR #34 owner's
    independent measurement (p99 85–103 h, longest 127–136 h). The behaviour, thirst, death-location and in-transit
    share measurements did not use that timer and are unchanged.
- **Two stall modes:**
  1. **Outbound** (`transit = −1`, dominant). The animal is `Idle`, has `want = 0` and is stationary, 0–10 m beyond
     the wall. Its target remains the outer line, which it never reaches.
     The likely cause is a behaviour that ends while in transit (a flight ending once the hare is safe, or giving up
     at the progress check) and sets `Idle` without clearing or continuing the transit. Every later decision then goes
     through `updateTransit` only after the timer expires, and the animal stays pinned.
     **This is not root-caused or verified.**
  2. **Inbound** (`transit = +1`). The animal is in `Wander` with `want > 0` but not moving, 20 m or more out near the
     outer line, with its target inside the valley. Movement is blocked at the corridor's outer edge.
- **Impact on the evaluation** (seeds 1, 4 and 7, 365 days):
  - 9.5–12.5% of D's on-map jackal-days are animals in transit (seeds 1, 4 and 7). Since a normal transit lasts about
    25 s, nearly all of these are stalled. For hares, 0.3–1.0%.
  - The **jackal collapse, the dehydration deaths, and the jackal-mediated effects in D/E/F/sensitivity are therefore
    contaminated**: hare release and chital overshoot.
  - The hare *counts* are not inflated by stalled hares.
- **Why the existing tests miss it.** The corridor tests check walk-in and walk-out for animals that keep walking.
  No test bounds transit duration or checks an exit interrupted by a behaviour change.

**Required regression tests before a re-run:**
- the longest time in transit is bounded, for example under 1 game hour at all four ticks;
- no animal in transit stays `Idle` for more than N ticks;
- an exit interrupted by the end of a flight either resumes or aborts and returns inside the wall;
- the inbound outer-edge block is reproduced and fixed;
- a 60-day smoke run has zero corridor deaths from dehydration or starvation.

### 4a. Fix proposed at `fdf0857` (by the PR #34 owner, amendment 3b, awaiting director approval): verified here
The owner reports five root causes, each with a test that fails on `ce83f68` and passes on `fdf0857`. Closed-boundary
hashes are unchanged. My independent probes on `fdf0857`, D, 160 days:

| Measure | `ce83f68` | `fdf0857` |
|---|---|---|
| Transit p99 / longest (seeds 1, 4) | jackal 57–83 h; hare 100–103 h / up to 136 h | jackal 38 s / 54 s; hare 32 s / 58 s |
| Jackal `Idle` samples while in transit (seed 1) | 33,728 of 35,167 | 15 of 5,914 |
| Jackal thirst in transit, median | 1.0 | 0.28–0.33 |
| Deaths in transit (seeds 1, 4) | 118/729; 93/1,118 | 3/254; 5/748 |
| Jackal-days in transit (seed 7) | 9.5% | 0.2% |

The D′/E′/F′/G′ re-run pinned to `fdf0857` waits for a `DIRECTOR TASK`. This session executes it under the agreed
split.

## 5. Issue #31: jackal encounter awareness and fawn rest synchrony (investigation, not in the evaluation)
Read-only probes; evidence in `docs/evidence/issue31/`.
- **Frozen code (`ce83f68`, identical to C when closed).**
  - A dependent fawn never rests beside its resting mother: 0 of 1.33M samples.
  - A jackal has no response to an approaching healthy adult chital.
  - This confirms both #31 observations.
- **PR #35 at `89d3a45`.**
  - **Synchrony:** 86% at dt 2 and 89% at the 1× tick. Rest onset takes 2 s at the median (6 s at p90). Getting up is
    same-tick (0.25 s).
  - **Defect:** a `Defend` ↔ `Alert` standoff. Jackal alert episodes last up to about 50 game hours, with hungry
    jackals held in `Alert`.
  - **60-seed M vs C impact:**
    - jackal extinction 28 → 58 (Holm p < 0.0001);
    - chital extinction 1 → 17;
    - hare extinction 28 → 3.
    - This is the same cascade as §3, triggered by jackal collapse.
- **Fix at `ee4d36e`** (by `…SBKWnauofqyDvXkjC`).
  - Independently re-measured here: jackal time in `Alert` falls from 7–14% to 0.7–2%, and the longest episode from
    2,990 to 34 game minutes.
  - **M at `89d3a45` is superseded.** A fixed M′ needs director re-freezing before it is run.
- **Open #31 gaps:** getting up has no modelled latency, and rest onset latency is the decision timer, not a
  behavioural delay.

## 6. Acceptance verdict against the pre-registered criteria (#29 items 4–7; design §6–§8)
| Criterion | Status | Evidence |
|---|---|---|
| ≥ 60 paired seeds × 365 days, A–E (+F), identical weather | **Met** | 690 seeds; A–F and M at 60, sensitivity at 30 as pre-registered |
| Paired extinction transitions and CIs, not only uncorrected p-values | **Met** | Exact McNemar + Holm, bootstrap CIs, Wilson CIs |
| Zero-inflow control and ±50% source/connectivity sensitivity | **Met (run)** | E, S-W, S-H, S-K, S-J, G. E is structurally a trap (§3); report it as such |
| No extinction-triggered rescue | **Met by test** (`open-boundary.test.ts` "no rescue rule"; not re-run here) | Arrival sequence independent of valley contents |
| Separate metrics (local vs resident, emigration/immigration, departure ≠ death) | **Met** | All recorded per seed |
| Deterministic hashes | **Met** | 92/92 identical across environments |
| No count leak across region transfer | **Met** for bookkeeping | Ledger 690/690. The corridor stall is not a leak |
| Population bookkeeping | **Not met** | Stalled corridor animals count as on-map for days (§4) |
| No edge teleporting or visible spawn pop-in | **Not met** | Animals stand stalled in the visible corridor for days. The entry-frame occlusion on PR #34 is still unverified |
| Bounded near-camera / transit actors | **Not met** | Individual animals stall in the visible corridor for up to about 136 game hours. They do not accumulate (0–7 at day 160, corrected) |
| Tests at 1/10/100/1000× | **Partial** | Corridor tests exist, but they do not cover interrupted exits or transit duration |
| Flux parameters field-supported or labelled assumed | **Met** | Design §8 |
| Existing quality gates | Not re-verified on `ce83f68` by this session | This branch: typecheck OK, unit tests 132/132 |

**Verdict.**
1. **The frozen evaluation is complete and valid as a test of the code it pinned.**
2. **The open-boundary mechanism as implemented at `ce83f68` does not satisfy the acceptance criteria.** It has an
   implementation defect, the transit stall, that biases the jackal results and everything downstream of jackals.
3. **The closed configurations A, B and C are unaffected and remain the valid baseline evidence for memory and
   territoriality.**
4. **No production acceptance is recommended for #27, #28, #30, #34 or #35 on this evidence.**

## 7. Recommended decisions for the director
1. **PR #34.** Do not accept. The owner of PR #34 (`…SBKWnauofqyDvXkjC`) fixes the transit stall with the regression
   tests in §4, under a written **amendment 3b**. The amendment changes no pre-registered parameter. It is followed
   by a re-run of D, E, F and G (60/60/60/30 seeds). The other sensitivity configurations are re-run only if the
   director wants the full grid. A–C are not re-run.
2. **Control E.** Re-label it "exit-only trap control" in the report. If a neutral zero-immigration control is wanted,
   pre-register E′: regional animals may *return* but never *settle*. That is a new configuration and needs approval.
3. **Off-map mortality.** G shows the jackal outcome depends on it. Before acceptance, either add a coarse off-map
   predation or competition term, pre-registered, or present jackal persistence in open configurations as
   **bounded by assumption**: report D and G side by side.
4. **Chital.** With an open boundary, the predator-release starvation crash shows that a single closed ungulate
   population of about 50 in 2 km² is fragile. Treat chital extinction in open configurations as a known artefact of
   keeping chital closed. Opening the boundary to chital is a separate, later decision; do not tune forage to hide it.
5. **#27 and #28.** The evidence supports them as research mechanisms: memory removes a navigation artefact, and
   territoriality regulates jackal reproduction. Neither stabilises hares. Their acceptance should be decided together
   with the fixed boundary (combined review, as #29 requires).
6. **#35.** Keep it a draft. Re-freeze M′ at the fixed head (`ee4d36e` or later), then run 60 seeds against C, and
   against the fixed D if that is accepted. Add the missing fawn get-up latency.
7. **Next research**, per `docs/ECOLOGY_RESEARCH_ROADMAP.md`:
   - hare refuges as a 2 × 2 with the boundary, after the stall fix. F shows that edge escape already acts as a de
     facto refuge, which strengthens the case for modelling refuges explicitly in the interior;
   - then seasonal breeding;
   - then navigation;
   - then the food-web ledger before any new species.

## 8. Limitations
- One synthetic valley; 365 days; dt 2 only for the evaluation. Speed checks at 1×/10×/100× are from earlier audits,
  not this run.
- The stall's root cause is inferred from state snapshots. It is not confirmed by a code-level reproduction test.
  That is the owner of PR #34's next step.
- The Node version on Actions was the runner's current 22.x, not pinned. Hashes nevertheless matched 92/92.
- No Indian field calibration for jackal territory size, hare density or off-map mortality (design §8). The open
  configurations rest on labelled assumptions, and G shows they matter.
- Holm correction is applied within each contrast, not across contrasts.
