# Maternal instincts and predator–prey encounters (issue #31)

Branch `feat/maternal-instincts`, stacked on `feat/open-boundary` (PR #34). The boundary stays closed unless it is
explicitly opened. **Draft; not merged.**

**Principle.** Every behaviour here comes from perception and from the recorded mother–offspring relationship (`mother`
on the young, `young` on the mother). There are no invisible protection bonuses. A mother must perceive the threat,
decide, and physically respond. Unrelated adults have no maternal abilities. Protection never guarantees survival.

## What changed
### Jackal prey selection (`Simulation.preyValue`)
- **Replaced rule.** The earlier fixed fractions of maturity age are gone: chital prey under 45% of maturity age, boar
  under 30%.
- **Body size.** A predator takes healthy prey up to `PREY_MASS_RATIO` (2.5) × its own mass, where prey mass is
  species mass × growth. For a 9 kg jackal that means about 22 kg: a chital fawn up to about 29% of maturity age, and a
  piglet up to about 18%.
- **Health.** Weak chital (health < 0.45) of any size are prospects. Healthy adult chital and adult boar are never
  targets.
- **Maternal context:**
  - prey within 25 m of its mother are a poorer prospect: × 0.6 for chital, × 0.15 for boar;
  - young far from the mother are a better prospect: × 1.25.
- **Effect.** Value scales the hunting utility, so hunger must outweigh a poor prospect.
- **Hidden newborns** are detected only within 10 m.

### Removed: blanket protection
- **Removed.** Previously any adult of the prey species within 12 m lowered the capture odds (× 0.6, or × 0.25 for boar),
  and a boar could randomly injure the jackal.
- **Replacement.** Only the prey's own mother, defending and within 2.5 m of it, blocks the strike. The predator then
  has to deal with her.

### Chital mother and fawn
- **Newborn hiders.** For `CHITAL_HIDE_DAYS`, about 10 real days compressed to about 1.3 game days (assumed):
  - the fawn lies hidden (`Hide`, lying pose) where its mother left it;
  - it moves only with her beside it;
  - on a threat it freezes;
  - it bolts only when the threat is within 5 m.
- **Nursing returns.** The mother returns to a hidden newborn when she is more than 100 m away.
- **Mobile fawns:**
  - lie down (`Rest`) beside a resting mother when unafraid and not hungry or thirsty;
  - wake as soon as she gets up or moves more than 12 m away, and follow;
  - flee to shelter behind her, on her far side from the threat, when she is within 40 m.
- **Mother's response.** When she perceives a predator within 30 m of her youngest dependent:
  - **Alarm:** her fawn gets a fear signal (threat position) and reacts by its own rules: a hider freezes, a mobile
    fawn runs to her.
  - **Reposition and display (`Defend`):** if she is healthy and the predator is more than 5 m from her, she moves to a
    point between the young and the predator and holds there, facing it.
  - **Escape:** if the predator is on top of her or she is weak, the ordinary fear and flight response applies.

### Wild boar sow and piglets
- **Clustering.** Piglets shelter behind the sow (same rule as fawns). They are followers, not hiders.
- **Charge.** A sow that perceives a predator near her piglets charges it at a run (`Defend`).
- **Contact** (within 1.8 m): the jackal is driven off (it flees) and is injured on half of contacts (health −0.12).
- **End of defence.** It stops when the predator is gone or more than 40 m from the piglets, when she is spent, or when
  she is more than 45 m from them.
- **Speed.** A jackal is faster than a sow (11.5 vs 9.5 m/s), so most charges end with the jackal withdrawing before
  contact. That is the expected outcome, not a defect.

### Jackal awareness and decisions
- **Alert.** A jackal not busy hunting turns to watch (`Alert`) a large animal (more than 2.5 × its mass) that is walking
  toward it within 25 m, including a player-controlled chital. It does not attack it.
- **Withdraw.** It moves away from an adult boar within 12 m.
- **Abandoning a hunt.** A hunting jackal gives up when the target's mother, defending against it, gets close:
  - against a sow (within 15 m), always;
  - against a chital mother (within 6 m), unless the jackal is very hungry (hunger ≥ 0.85).

### Player-controlled mother
- **Alert cue.** The wildlife prompt shows "Your fawn is in danger (N m) — hold Z: defend" when a predator is within
  30 m of her youngest dependent (`Simulation.youngThreat`).
- **Defend action.** Holding Z, or the touch button **Defend**, runs the same `Defend` behaviour an AI mother uses.
- **No takeover.** Movement stays with the player, and the young stay autonomous.

### Contracts and counters
- **Behaviours appended:** `Alert` (15), `Defend` (16) and `Hide` (17). Existing ids are unchanged.
- **Behaviour families extended additively:** `alert`, `defend` and `hide`.
- **Renderer** (`animalPose`): `hide` uses the lying pose; `alert` and `defend` hold the head high when not running.
- **`InteractionStats`** (saved with the simulation) counts defends, charge contacts, jackal injuries, abandoned hunts,
  alerts, withdrawals and hider bolts.

## Tests (`tests/unit/maternal.test.ts`, 16 deterministic scenarios)
- **Prey selection:**
  - healthy adult chital and boar are not targets; young and weak chital are;
  - isolated young are better prospects than protected ones; a protected piglet is a poor one.
- **Fawn behaviour:**
  - a mobile fawn settles beside its resting mother and gets up to follow;
  - a newborn hides, freezes at a jackal 15 m away, and bolts at 3 m;
  - a hidden fawn is detected only at close range.
- **Chital mother:**
  - she steps between her fawn and a jackal, and the fawn is alerted;
  - a very hungry jackal is not turned back by a chital mother, while a moderately hungry one is.
- **Boar sow:**
  - she defends and the jackal withdraws;
  - the charge-contact rule;
  - a hunting jackal abandons when the sow confronts it;
  - an unrelated adult boar does not defend.
- **Jackal awareness:**
  - it watches an approaching adult chital, whether AI or player-controlled;
  - it withdraws from an adult boar;
  - a satiated jackal does not start hunting a fawn, while a hungry one does.
- **Player and persistence:**
  - the player's mother can defend while the fawn stays autonomous;
  - save/load continues with an identical hash.

## Assumptions (not calibrated)
| Assumption | Value | Basis |
|---|---|---|
| Chital hiding period | ~10 real days | Chital are described as a "hider" species. The duration is assumed and was not verified from a primary source |
| Prey mass ratio | 2.5 × predator mass | Golden jackals take young ungulates and small prey; the ratio is assumed |
| Mother-proximity factors | 0.6 (chital), 0.15 (boar), 1.25 (isolated) | Assumed ordering: sows defend aggressively, chital mothers less so |
| Charge injury | 50% of contacts, −0.12 health | Assumed |
| Chital mother abandon threshold | hunger 0.85 | Assumed |

## Not yet done
- The paired-seed evaluation:
  - juvenile mortality (`juvenileDeaths`, cohort survival);
  - jackal injuries and hunting success (`hunting`);
  - time budgets (`behaviourBudget`);
  - population stability;
  - all against configuration C (territories, closed, B1).
  It will run with the same per-seed runner after the #29 runs, which hold the CPU.
- Playwright demonstrations of maternal awareness, fawn rest and wake, jackal stalk and withdraw, and the sow's defence.
