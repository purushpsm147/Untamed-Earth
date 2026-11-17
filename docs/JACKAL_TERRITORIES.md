# Territorial jackal breeding (Gate 2)

Status: **experimental, branch `gate2/jackal-territories`** (stacked on PR #27, failed-target memory). Not merged; for
owner review.

## Why
PR #27 removed an irrational behaviour: jackals pacing for hours at carcasses they cannot reach. Afterwards jackals
persisted far more (jackal-days higher in 14 of 15 paired seeds) and hare extinctions rose (4 → 9 of 15).
- **Cause:** the model has no mechanism that limits how many jackals breed. Every adult female in a family could breed
  once the dominant one died, families budded off new groups by size, and nothing tied breeding to space.
- **Approach:** the owner's direction is to keep the rational behaviour and add a credible regulating mechanism, not
  caps or tuned mortality.

## Field basis
| Observation | Source | Used for |
|---|---|---|
| Golden jackals are monogamous, behaviourally and genetically. Pairs mark and defend territories, hunt together and rear young cooperatively; territories are held by a pair for up to eight years | Search summary of genetic and Serengeti field studies ([Better Planet: golden jackal breeding](https://betterplaneteducation.org.uk/factsheets/jackal-golden-breeding); [PBS Nature: Moehlman](https://www.pbs.org/wnet/nature/jackals-of-the-african-crater-the-jackal-woman/2010)) | One breeding pair per territory |
| Annual ranges of mated pairs were mutually exclusive (Cambodia, mean 47 km²) | [Rasphone et al., via search summary (PMC8491366)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8491366) | Exclusive spacing between territory centres |
| Some young from the previous litter stay and help raise the next litter, typically about a year after maturity (~11 months), then disperse | [Better Planet factsheet](https://betterplaneteducation.org.uk/factsheets/jackal-golden-breeding) (secondary); Moehlman 1979, *Nature* (helpers and pup survival), cited in later work | `helperYears` = 1, then dispersal as floaters |
| Home-range size varies enormously: 0.1–14 km² near villages or with provisioning, 21–35 km² in natural areas; 6.6 vs 21.2 km² near villages vs natural (Israel); 11–14 km² (Hungary) | [Rotem et al. 2011, *J. Wildl. Manage.*](https://complete.bioone.org/journals/journal-of-wildlife-management/volume-75/issue-1/jwmg.9/The-Effect-of-Anthropogenic-Resources-on-the-Space-Use-Patterns/10.1002/jwmg.9.full); [Hungary/Serbia, *J. Wildl. Manage.* 2024](https://www.citedrive.com/en/discovery/home-ranges-of-roaming-golden-jackals-in-a-european-forestagricultural-landscape/) | Territory size is the main uncertainty; tested with a sensitivity run |

**Caveats.**
- Several of these sources were read only as search summaries, not full text.
- No Indian golden-jackal territory size was found.
- The whole valley (~2 km²) is smaller than most measured ranges. Any territory size that fits several pairs in the
  valley is at the small, anthropogenic end of the field range. There are ruins and a dump here, so that end is the
  defensible one, but it is a modelling choice and is stated as one.

## Model (`SpeciesDef.territory`, `Simulation.updateTerritories`, once per game hour)
- **Territories.** A territory is held by a group: a centre, a resident female and a resident male (either slot may be
  vacant). Centres are at least `spacing` apart.
  - Spacing is 960 m = 2 × the model's jackal home range, an exclusive range of ~0.7 km².
  - There is **no cap on territories or jackals**. How many territories exist follows from space and from who is alive
    to hold them.
- **Breeding.** Only the resident female breeds, and only with the resident male present. The male mates only with
  his territory's female, so floaters and helpers never breed.
- **Founders.** Animals with no recorded mother fill a vacant slot of their sex in their own group.
- **Natal animals.** They take a slot only when both slots are vacant (inheritance). While one parent still breeds,
  the other slot waits for an outsider, so no offspring pairs with a surviving parent. Fathers are not recorded, so
  this rule is the model's inbreeding avoidance.
- **Helpers.** Adult offspring stay for `helperYears` (1 life-year) after maturity, then disperse. A disperser gets a
  new group id and wanders toward changing anchor points across the valley.
- **Floaters.** An adult floater:
  - joins a territory it is inside (within half the spacing) if that territory lacks a breeder of its sex and the
    resident female is not its mother;
  - otherwise claims a new territory where it stands, if it is at least `spacing` from every held centre, on dry
    ground, not in a ruin, inside the region;
  - otherwise keeps exploring.
- **Vacancy.** A territory with no living adult member is vacated.
- **Group budding is off** for territorial species. Offspring leave one by one, as dispersers.

**What is deliberately not modelled:**
- No population cap, kill quota, or extra mortality for floaters. Floaters live under the same physiology and hazards
  as everyone else.
- No helper effect on pup survival (Moehlman's finding). It would raise breeding success, and it is left out until
  measured against the model.
- No immigration or emigration. The valley is closed; a vacancy can only be filled by local dispersers. This is the
  model's largest remaining simplification (stability report, finding 5).
- No fighting over territories. Spacing and vacancy-filling stand in for defence.

## Tests (`tests/unit/jackal-territories.test.ts`, 8 cases)
1. Exclusive spacing over 30 days, seeds 1–3.
2. Only the resident female with a resident male is receptive; a daughter helper is not.
3. No pairing with a surviving parent; inheritance once both parents are gone.
4. Dispersal exactly after the helper period.
5. A floater joins a vacancy of its sex, but not its mother's territory.
6. A floater claims only at full spacing.
7. Vacancy when no adult is left.
8. Save/load with an identical continuation hash.

## Evaluation
Paired seeds and identical weather (each configuration uses its own code on the same seeds):
1. **M2**: integration (`78bb515`, PR #25 merged).
2. **M2 + memory**: PR #27 head.
3. **M2 + memory + territories**: this branch, spacing 960 m.
4. **Sensitivity**: as 3 with spacing 720 m (~0.4 km² exclusive range).

30 seeds × 365 game days (≈ 7.6 life-years) each. Results are below.

## Results: 60 paired seeds × 365 game days, identical weather per seed
The sensitivity configuration has 30 seeds. Evidence:
- `docs/evidence/ecology/gate2-summary-60-seeds.json` (all metrics, per-seed extinction transitions, paired sign tests);
- `docs/evidence/ecology/gate2-analysis.txt` (readable output);
- raw per-day runs on branch `experiment/ecology-stability`, `docs/evidence/ecology/gate2/` (gzipped).

### Distributions (median [IQR])
| Measure | M2 | M2 + memory | M2 + memory + territories | sensitivity 720 m (n = 30) |
|---|---|---|---|---|
| Jackal-days | 1,373 [1,021–2,123] | 3,592 [2,352–5,438] | 1,859 [1,466–2,703] | 2,267 [1,598–2,912] |
| Jackal litters | 5.5 [4–9] | 15.5 [9–26] | 4.5 [3–7] | 6.5 [4–10] |
| Kills per jackal-day | 0.174 | 0.129 | 0.187 | 0.163 |
| Total predation (chital + boar + hare) | 253 [191–335] | 403 [318–499] | 340 [278–404] | 351 [251–441] |
| Hare end population | 54.5 [1–120] | 0.5 [0–50] | 3.5 [0–59] | 6 [0–44] |
| Hare minimum after day 30 | 24.5 [1–56] | 0.5 [0–31] | 3.5 [0–20] | 2 [0–15] |
| Chital end population | 5 [2–12] | 7.5 [3–13] | 10.5 [5–17] | 12 [4–17] |

### Extinction frequency
| Species | M2 | M2 + memory | M2 + memory + territories | sensitivity 720 m |
|---|---|---|---|---|
| Jackal | 38/60 | 11/60 | 25/60 | 15/30 |
| Hare | 13/60 | 30/60 | 24/60 | 14/30 |
| Chital | 11/60 | 10/60 | 3/60 | 4/30 |
| All six persist | 11/60 | 20/60 | 16/60 | 8/30 |

### Paired comparisons (seeds higher / lower in the second configuration; two-sided sign test)
**Memory → memory + territories** (the Gate 2 question, n = 60):
| Measure | Higher / lower | p |
|---|---|---|
| Jackal-days | 13 / 47 | < 0.0001 |
| Jackal litters | 8 / 51 | < 0.0001 |
| Kills per jackal-day | 44 / 16 | 0.0004 |
| Total predation | 22 / 38 | 0.052 |
| Chital end population | 35 / 19 | 0.040 |
| Hare end population | 27 / 21 | 0.47 |
| Hare minimum | 28 / 20 | 0.31 |

Extinctions, as newly extinct / rescued seeds:
- **Chital:** 0 / 7 (p = 0.016).
- **Jackal:** 21 / 7 (p = 0.013).
- **Hare:** 12 / 18 (p = 0.36).

**M2 → memory + territories** (n = 60):
- Jackal-days higher in 40 of 60 seeds (p = 0.014).
- Total predation higher in 43 (p = 0.001).
- Hare minimum lower in 39 (p = 0.0008).
- Chital end population higher in 39 (p = 0.005).
- Extinctions (newly extinct / rescued): jackal 10 / 23 (p = 0.035), hare 18 / 7 (p = 0.043), chital 2 / 10 (p = 0.039).

### Territory dynamics (60 seeds)
- Median mean occupied territories: **1.82**.
- Median mean full pairs: **0.72**.
- Helpers: 0.6; floaters: 0.97.
- 0.79 litters per full-pair life-year.
- 36% of pups reached maturity (404 of 1,116 resolved).
- Events over all seeds: 289 dispersals, 219 claims, 167 joins, 30 inheritances, 170 vacancies.

### Interpretation (findings, not tuning)
1. **Territorial breeding regulates jackals as intended.**
   - Litters fall to the M2 level and jackal-days fall by half.
   - Each jackal is better fed (higher kill rate per jackal), because fewer jackals share the same prey.
   - Chital benefit clearly (extinctions 10 → 3 of 60).
2. **It does not resolve the hare problem.**
   - Hare outcomes do not differ significantly from memory alone, and remain worse than M2 (24 vs 13 hare extinctions
     of 60).
   - Every hare extinction in the memory and territory configurations happened with jackals present in the previous
     30 days.
   - Even 1–2 jackal territories impose enough predation on a closed population of a few dozen hares to drive it
     extinct in about 40% of seeds.
3. **Jackal persistence becomes fragile.**
   - A territory has both breeders only 0.72 of the time on average. When a breeder dies, the slot waits for an
     outsider, and in a closed valley the supply of outsiders is a handful of local dispersers.
   - Jackal extinction rises from 11 to 25 of 60. Territoriality without immigration makes a 2–3 territory population
     prone to extinction. That is biologically credible for such a small closed area, and it is an artefact of the
     closed boundary rather than of territoriality.
4. **Sensitivity.** Smaller territories (720 m) produce more litters (p = 0.005) and more predation (p = 0.024) at
   n = 30. The hare and jackal extinction differences from 960 m are not significant. Results depend on territory size
   in the expected direction, but the qualitative findings hold.

### What this means for the next mechanism
The missing stabilisers are not in breeding rules any more. They are the two the stability report named (finding 5)
plus one from the Phase 2 plan:
- **An open boundary.** Rare, seeded immigration and emigration of jackals and hares at the valley edge. Real
  populations of this size persist through connectivity, and it would also fill vacant breeder slots.
- **Hare refuge use.** Cover and form sites that reduce detection and capture, a documented anti-predator behaviour
  (Phase 2, "hare cover").

Both are mechanisms, not targets. Each should be tested the same way: paired seeds and identical weather, 60 seeds
where 30 cannot resolve the effect.
