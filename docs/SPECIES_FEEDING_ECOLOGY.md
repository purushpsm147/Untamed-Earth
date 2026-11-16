# Species feeding ecology (Mission 5, Gate 2)

Status: **experimental branch `experiment/gate2-jackal-diet`**. Nothing here is in production until a gate review accepts
it. Baseline is the integration branch after PR #20 (`5cf7b4a`). Time scale: 48 game days ≈ 1 life-year, so 365 game
days ≈ 7.6 life-years.

## Question from the owner: "isn't hunting a function of hunger?"
Yes, and the data show that part works:

- **The hunger gate.** A jackal only hunts above hunger 0.3. Its stalk utility scales with hunger, and it stops feeding
  once sated.
- **Per-jackal kill rate is unchanged by PR #20.** Over 15 seeds × 365 days:

  | | `a0e08ba` | after PR #20 |
  |---|---|---|
  | Kills per jackal-day | 0.126 | 0.125 |
  | Jackal-days | 17,341 | 32,494 |

  Mean jackal hunger is 0.38 before and 0.41 after.
- **So why did hares fall?** Hare pressure rose because more jackals survived. That is a *numerical* response (how many
  jackals there are), not a *functional* one (how much each jackal kills). Hunger regulates each animal; nothing
  regulates how many jackals the valley holds.
- **Three further gaps:**
  1. The hunger gate is almost always open. Jackals take in 0.44 kg per jackal-day against the 0.75 kg/day nominal
     intake, so they are chronically hungry.
  2. Prey choice ignores profitability. A hungry jackal that sees a hare stalks it (stalk utility ≈ 1.35 × hunger)
     even when foraging small fauna nearby would pay better.
  3. Kills are poorly used by the killer. By mass, 80% of killed meat is chital fawns and boar piglets (~8 kg
     carcasses). Jackals eat only **19%** of the meat they kill; boar eat 34%, crows 5%, and 43% decays.

## Diet budget, baseline (`Simulation.eatenBy`, 15 seeds × 365 days, after PR #20)
| Source | Share of jackal intake (kg) |
|---|---|
| Small fauna pool (rodents, lizards, frogs, ground birds) | 43% |
| Meat from predation carcasses (own or others' kills) | 20% |
| Other carrion | 16% |
| Invertebrates | 13% |
| Plant matter | 8% |

The fauna share varies by seed (23–61%), which fits the field finding that jackal diet is habitat-conditioned.

## Field evidence (golden jackal, South Asia)
Field figures are mostly **percent occurrence** in scats. That measures how often an item appears, not how much was
eaten, and it overstates small items. They are compared with the model's mass shares only qualitatively.

| Site | Main findings | Source |
|---|---|---|
| Bharatpur, Kanha, Sariska (review) | Rodents, birds and fruit > 60% (Bharatpur); rodents, reptiles and fruit > 80% (Kanha); mammals ~45% of occurrence, mostly rodents (Sariska); vegetable matter ~20% | [JoTT 12(11), 2020](https://threatenedtaxa.org/index.php/JoTT/article/download/4489/6959?inline=1) (cited in the Mission 4 report) |
| Van Vihar NP (small enclosed park) | Fruits 40.74%, vegetative matter 24.38% of occurrence; chital in diet; scavenging of zoo leftovers likely | [Prerna, Edgaonkar & Dubey 2015, JoTT 7(8): 7422–7427](https://threatenedtaxa.org/index.php/JoTT/article/download/2109/3271?inline=1) |
| Patna Bird Sanctuary, Uttar Pradesh (83 scats) | Birds ~38.9%, rodents ~12.1%, vegetative matter ~13.6% | [JoTT 9(9): 10656–10661, 2017](https://threatenedtaxa.org/index.php/JoTT/article/download/3301/4148?inline=1) |
| General | Omnivorous, opportunistic; pairs with young; helpers | [Animal Diversity Web: Canis aureus](https://animaldiversity.org/accounts/Canis_aureus/) |

The Van Vihar and Patna figures come from abstracts in search results. Their full texts could not be fetched from this
environment (`threatenedtaxa.org` is not in the session's allowed hosts), so the tables have not been checked. Treat
them as indicative.

**What the field evidence does and does not support:**
- Plant matter and fruit are a substantial, site-dependent share of the diet. The model's 8% is at the low end.
- Small vertebrates dominate the animal part, which the model matches (43%).
- Hares and ungulates are a minority.
- No source here gives a per-chase success rate or a daily ration for wild golden jackals. Calibration is therefore
  judged on diet composition and population outcomes.

## Gate 2 experiments, one variable at a time (15 seeds, identical weather, against the baseline above)
1. **Plant share** (`jackal-veg-0.3`, `jackal-veg-0.5`; default weight 0.12). This tests the plant share as a dose,
   not a target value.
   - The plant pool is finite and shared with chital and hares, so this adds competition, not free food.
   - Expected effects: jackals less hungry, so the hunger gate opens less often and each jackal kills less. Better-fed
     jackals may also breed more, so the net effect on hares is the question being tested.
2. **Profitability-based prey choice** (next). The stalk utility would use the expected gain of a hunt (success rate
   × carcass mass) relative to local foraging return, instead of hunger alone. This is optimal-diet reasoning, not a
   tuned success rate.
3. **Kill utilisation** (candidate). Two options:
   - A larger meal capacity (gorging), so a predator eats more of its own kill.
   - Family members sharing a kill.

   Both reduce kills per unit of food. Neither has a sourced field number yet, so either would be tested as a
   mechanism with its parameters reported.
4. **Numerical regulation** (Phase 3): territorial pairs limit how many jackals breed. This is the mechanism that
   addresses the jackal-days increase directly.

Acceptance for any of these:
- Diet composition moves toward the field pattern.
- Hare persistence and minimum populations do not worsen relative to the baseline.
- No species extinction rises.
- Kills per chase are unchanged.
- No invisible food is created: every kg comes from a tracked, finite pool, shown by `eatenBy` summing to `eaten`.

## Experiment 1 results: jackal plant share (15 seeds × 365 days, identical weather)
| Measure | baseline (veg 0.12) | veg 0.3 | veg 0.5 |
|---|---|---|---|
| Jackal diet by mass: plants / small fauna / invertebrates / kill meat / carrion | 8 / 43 / 13 / 20 / 16% | **19** / 36 / 14 / 18 / 14% | 23 / 26 / 9 / 23 / 18% |
| Jackal intake, kg per jackal-day | 0.44 | 0.43 | 0.43 |
| Mean jackal hunger | 0.41 | 0.39 | 0.35 |
| Jackal-days (sum over seeds) | 32,494 | 42,826 | 24,031 |
| Kills per jackal-day | 0.125 | 0.102 | 0.151 |
| Kills per chase (median) | 0.129 | 0.129 | 0.130 |
| Hare predation (total) | 2,651 | 2,914 | 2,475 |
| Hare extinct | 4/15 | 5/15 | 0/15 |
| Hare: median day-365 / median minimum after day 30 | 9 / 5 | 62 / 19 | 62 / 34 |
| Hare: median CV days 183–365 / seeds crashing to ≤ 20% of peak | 0.79 / 11 | 0.50 / 8 | 0.39 / 8 |
| Jackal extinct | 8/15 | 8/15 | 7/15 |
| Chital extinct / chital starvation (median per run) | 3/15 / 54 | 2/15 / 52 | 2/15 / 69 |
| All six persist | 3/15 | 3/15 | 6/15 |

**Interpretation.**
- **Composition.** A weight of 0.3 brings the plant share to 19%, in line with the ~20% vegetable matter in the field
  review. This is the composition evidence the gate asks for.
- **Plants substitute; they don't add.** Intake per jackal-day barely moves (0.44 → 0.43). Foraging effort is split
  across pools in proportion to the diet weights, so more weight on plants means less taken from the small-fauna pool.
  Jackals are no less food-limited, and hunger falls only slightly.
- **Effects on hares are mixed.** At 0.3, hare dynamics improve: minimum 5 → 19, CV 0.79 → 0.50, crashes 11 → 8. But
  hare extinctions do not (4 → 5/15), and total hare predation rises, because more jackal-days offset the lower
  per-capita kill rate.
- **0.5 goes beyond the field figure.** Hare extinction 0/15 (Fisher p ≈ 0.10 against 4/15) and all-six persistence
  6/15 (p ≈ 0.43) look better but are not significant. The costs show up elsewhere: jackals compete with chital for
  plants (chital starvation 54 → 69), and per-capita kill rate *rises* (0.151), because plant cells replace
  small-fauna intake.
- **Verdict: not accepted on its own.** The plant share is a calibration of diet composition (0.3 recommended, matching
  the field share), not a regulator. The jackal-days swing (24k–43k) confirms that jackal numbers, not jackal hunger,
  drive predation pressure.

**Next experiments, in order:**
1. Territorial breeding pairs, the numerical regulator (Phase 3, which the gate's social behaviour covers).
2. Profitability-based prey choice.
3. Re-test plant weight 0.3 together with territories.
