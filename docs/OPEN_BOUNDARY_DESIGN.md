# Open valley boundary: design proposal (issue #29, step 2)

Status: **design only, for owner review.**
- No migration code exists.
- The audit this design rests on is `docs/OPEN_BOUNDARY_AUDIT.md`.
- Every parameter below is **pre-registered**: it is fixed before any open-boundary run and is not adjusted afterwards
  to improve outcomes. Each one is labelled either *field-supported* or *assumed*.

## 1. What the model must represent
Three different things happen when an animal crosses a real valley edge. The closed model cannot tell them apart.

| Event | Example | What it is |
|---|---|---|
| **Excursion** | A jackal whose territory straddles the ridge goes over it to hunt and returns | Movement within a home range. Neither emigration nor death; the animal keeps its ID, needs and relationships |
| **Emigration** | A dispersing young jackal leaves and does not come back | The animal leaves the local population but stays alive in the region |
| **Immigration** | A floater from a neighbouring territory arrives and takes a vacant breeder slot | A recruit from a finite regional population; it is not a birth |

An animal that comes in and leaves again is a **visitor**. It becomes an **immigrant** only when it establishes local
residence. For a jackal, residence means taking a territory slot whose centre lies in the valley; for a hare, it means
settling a home range in the valley.

## 2. Alternatives considered
**A. Closed boundary (status quo).**
- What it does: a hard wall 6 m from each edge, and no world beyond it.
- Problem: the audit shows edge cornering, a bird-stranding defect, and territories truncated against the wall. Every
  vacancy must be filled from inside.

**B. Anonymous finite pools per edge sector.**
- What it does: each edge sector keeps a count, or a sex/age histogram, of animals beyond it. Emigrants increment it;
  arrivals decrement it and are created as new animals at the edge.
- Pros: simple and cheap.
- Problems:
  - It cannot preserve identity. A jackal that steps over the ridge and returns would come back as a different animal,
    which breaks the invariant that IDs, needs and relationships are preserved.
  - It cannot represent a territory that straddles the edge.
  - It cannot separate visitors from immigrants or returns from new arrivals.
- **Rejected as the main model.**

**C. Identity-preserving regional individuals, with regional territories that straddle the edge (recommended).**
- The neighbouring landscape is populated with real `Animal` records flagged off-map, plus regional jackal territories.
  Each record keeps ID, sex, age, mother, group, needs and failed-target memory.
- Off-map animals have no physical position. They are advanced once per game hour by a coarse demographic model (§4)
  using the same species parameters as on-map animals.
- An off-map jackal whose territory overlaps the valley makes excursions into it: it materialises at the edge with its
  own ID, behaves as an ordinary animal, and returns to the off-map record when it walks back out.
- The regional population is finite because it is made of individuals. It is replenished only by births among those
  individuals.

**D. Simulate a larger region at full fidelity.**
- What it would mean: a 3.4 km × 3.4 km world, 5.4× the area.
- This is the faithful reference, but it changes `REGION_SIZE`, the terrain, rendering and memory budgets for everything.
- **Rejected for the product.** It is worth considering later, headless only, as a validation reference for C.

**Recommendation: C, scoped to jackals and hares first.**
- These are the two species the Gate 2 result is about.
- Chital, boar and birds keep the closed edge. The bird-stranding defect (audit finding B1) is fixed separately as a
  correctness change, not as migration.

## 3. Geometry of the regional landscape
**Regional ring.** The off-map landscape is a ring of width `W` around the valley.
- `W` is one jackal territory spacing, 960 m (assumed). The ring's outer square is 3,360 m on a side, an area of
  9.2 km², or 4.4× the valley.
- **Hard limit:** nothing exists outside the ring. There is no infinite stock.

**Regional jackal territory slots.**
- Slots are fixed at world creation from the seed: centres on a lattice with `spacing` 960 m, offset 480 m outside each
  edge, so each exclusive disc straddles the boundary.
- That gives 10 straddling slots. A second lattice row 1,440 m outside the edge adds slots entirely off-map.
- Spacing is enforced across the boundary. A valley floater cannot claim a centre within 960 m of a held regional centre,
  and the converse also holds.
- With 960 m spacing and 480 m offsets, an in-valley centre must lie at least 480 m from every edge. The valley then
  holds about one interior territory and shares about ten with neighbours. This follows from the stated geometry; it is
  not a target.

**Connectivity of each edge sector (derived, not hand-set).**
- Connectivity is computed from the valley's own terrain: the walkable fraction and habitat suitability of the edge band
  in that sector.
- The border ridges reduce forage capacity by up to 60%, and no home site is placed within about 113 m of an edge (audit
  §2). Hares therefore connect mainly through the river corridor, where the generator keeps the ridges open. Jackals
  cross ridges freely: their habitat weight for forest is 0.6, and they are not excluded.

**Regional habitat suitability.**
- The ring has no terrain, so suitability is a per-sector scalar.
- It is drawn once from the seed: uniform 0.6–1.0 of the valley's mean habitat value (assumed). It follows the valley's
  seasons and does not invent weather.

## 4. Off-map demography (coarse, hourly, deterministic)
**General rules.**
- Off-map animals use the same species parameters as everyone else: aging, background hazard (`adultHazard` /
  `juvHazard`), breeding season, gestation, litter size and maturity.
- What is simplified: individual hunger and thirst are not simulated off-map. The sector's suitability, crowded against
  its capacity, scales survival and fertility instead.
- **Capacity governs off-map demography only. It never governs arrivals.**
- **Random numbers.** All off-map draws come from a new stream, `migRng = hash3(seed, 99, 3)`. With the boundary
  closed, the stream is never drawn from, so configuration C reproduces #28's hashes exactly.

**Jackals.**
- A regional slot holds a pair, a helper or a vacancy, with the same rules as in the valley.
- Breeding follows the valley's rules, scaled by sector suitability.
- Pups follow the valley's juvenile hazard.
- Helpers disperse at the same age. A disperser picks a direction uniformly at random:
  - toward the valley with probability equal to the angle the valley subtends from its slot, times the sector's
    connectivity;
  - otherwise it moves around the ring and may join or claim a regional slot.
- Floaters off-map face the same hazards. They never count as "residents".

**Hares.**
- Regional hares are individuals in an edge strip 260 m deep, two home ranges.
- Sector capacity is the strip's area times the valley's initial hare density (64 hares over the valley's walkable area)
  times suitability. This is assumed: an Indian density figure was not available, see §8.
- Births and juvenile survival are scaled by crowding against capacity.
- Off-map predation is folded into the existing background hazard. It is not a separate rescue term.

## 5. Crossing the edge (on-map ↔ off-map)
**Exits.**
- An animal of an open-boundary species may choose a target beyond the edge in three situations:
  - a jackal's wander target inside its own territory disc;
  - a disperser's travel direction;
  - a flee direction toward the open side.
- When its continuous movement sweep crosses the 6 m line outward with such a target, it becomes off-map. It keeps the
  same record; only an `offmap` flag and an edge sector change.
- An exit is classified, and the classification is recorded:
  - an **excursion** if the animal's territory or home range overlaps the outside;
  - **emigration** otherwise.
- An animal leaving while pregnant or with dependants is allowed. Its dependants follow under the existing regroup
  rules, or stay; nothing is deleted.

**Entries.**
- An off-map animal enters through the edge sector nearest its target: inside its own territory for an excursion,
  toward the valley for a disperser.
- It appears 6–8 m inside the edge, facing inward, with its own ID and its state at the time it left.
- Entry location and time come only from simulation state and `migRng`, never from the camera.

**Pop-in.** Two options for the owner to choose between (decision point 3):
1. **Renderer only:** an animal that has just entered is drawn walking in from the 192 m terrain apron for its first
   seconds. The simulation is unchanged.
2. **Simulation transit band:** entry starts outside the region in a short transit band. This changes the physical
   invariants and is not recommended.

**Constraints that always hold.**
- A controlled (possessed) animal never exits. For the player the edge stays a wall.
- A breeder vacancy is filled only by an ordinary adult arriving through these rules. There is no direct assignment.
- Arrivals are never triggered or rate-adjusted by local abundance. There is no rescue rule.

## 6. Bookkeeping and metrics (kept separate)
**Counters.** Emitted as events and kept as saved counters, per species:
- local births and deaths by cause;
- emigrations;
- excursion exits and returns;
- immigrations (an arrival that later settles);
- visitor arrivals;
- returns of former residents;
- off-map births and deaths;
- off-map abundance by sector;
- jackal territory occupancy, split into in-valley-centred, straddling and fully regional.

**Derived measures.**
- **Local abundance**, and **resident persistence without newcomers**: survival of the founding cohort and of
  descendants of local mothers. This is reported separately from presence restored by migration.
- **Permanent local extinction** (no residents for the rest of the run) versus **recolonisation** (residents return
  after a gap).
- **Jackal presence**, split three ways:
  - predator-days in the valley by residents;
  - predator-days by visitors from straddling territories;
  - regional breeding pairs.
- Per-capita kills and total predation.
- Full-pair occupancy.
- Hare and chital survival.
- Compute cost (ms per simulated day) and the number of near-camera actors.

**Conservation check (a test).** At every hour:

> on-map + off-map + cumulative deaths = founders + cumulative births

The check is applied per species, and runs across save/load.

## 7. Evaluation plan (paired, 60 seeds × 365 days, identical weather)
**Configurations.**
- **A**: M2, integration.
- **B**: A plus failed-target memory (#27).
- **C**: B plus territories, closed boundary (#28 head, frozen in the audit). Hashes must match #28 exactly.
- **D**: C plus the open boundary, with the pre-registered parameters.
- **E**: D with zero immigration. Exits still happen, so emigration and excursions are possible, but no off-map animal
  enters the valley. This is the zero-inflow control. It uses the same `migRng` draws as D, which are discarded, so D
  and E stay paired.
- **Sensitivity:** D with off-map source size (slot rows, hare capacity) and connectivity each at ±50%. That is four
  runs, at 60 seeds where 30 cannot resolve the effect.

**Reported for each comparison.**
- Extinction transitions (newly extinct / rescued seeds) with sign tests.
- Distributions with seed-bootstrap 95% confidence intervals.
- Every measure in §6.

**Acceptance (issue #29 §7).**
- Deterministic hashes and save/load, including off-map state.
- The conservation identity holds, so nothing leaks.
- No teleporting: entries and exits only at the edge, by continuous movement.
- Near-camera actor count stays bounded.
- Tests at 1×, 10×, 100× and 1,000×.
- Every flux parameter labelled field-supported or assumed.
- All existing gates pass.
- The #25 shoreline and #27 memory regressions are preserved.

## 8. Pre-registered parameters
| Parameter | Value | Status / basis |
|---|---|---|
| Ring width `W` | 960 m (one jackal spacing) | Assumed. It bounds the regional population; ±50% sensitivity on source size |
| Regional jackal slot lattice | Spacing 960 m; first row 480 m outside each edge, second row 1,440 m outside | Follows from #28's spacing (assumed, `docs/JACKAL_TERRITORIES.md`) |
| Initial regional slot occupancy | Each slot holds a pair with probability 0.75, a single adult with 0.15, empty with 0.10, from `migRng` at creation | Assumed. Field studies report pairs holding territories for years; no occupancy rate was found for a comparable landscape |
| Sector suitability | U(0.6, 1.0) × valley mean, drawn once | Assumed |
| Jackal dispersal direction | Uniform; enters the valley with probability = subtended angle × connectivity | Assumed geometry. Field dispersal distances are 6.5–159 km (six GPS-tracked animals, Potočnik et al. 2022, conference abstract, read as a search summary), so a disperser commonly leaves a 3 km landscape; the ring cannot represent long-distance return |
| Excursion rate (straddling pair members) | Daily probability that a member spends its active period inside = fraction of its exclusive disc inside the valley | Assumed. It ties visiting time to space use, not to valley abundance |
| Hare edge strip depth | 260 m (2 × home range 130 m) | Assumed |
| Hare off-map capacity | Valley initial density × strip walkable area × suitability | Assumed (model-internal). No Indian *L. nigricollis* density estimate was obtained; the Rollapadu census (Manakadan & Rahmani) exists but its figures were not read |
| Hare dispersal | Juvenile dispersal follows the existing wander and home rules; crossing happens only by movement | No new parameter |
| Connectivity per edge sector | Walkable fraction × mean habitat suitability of the 0–120 m band in that sector, from terrain | Derived, not tuned |

Sources: [Potočnik et al. 2022 (abstract via search)](https://air.uniud.it/retrieve/63f9b585-b940-48a5-9f54-1b7bdab3e2f0/Poto%c4%8dnik%20et%20al.%20%282022%29.pdf);
[Lanszki et al. 2018, first GPS natal-dispersal record](https://moorcroftlab.oeb.harvard.edu/resource/lanszkietal2018mammbiologypdf);
[Manakadan & Rahmani, Rollapadu hare census](https://archive.org/download/biostor-151804/biostor-151804.pdf).
These were found by search and have not been read in full. They are recorded so that the owner, or a later session, can
verify or replace the assumptions.

## 9. Scope of the first implementation PR (after approval)
1. A separate small correctness PR for audit finding B1: align the flight clamp with the ground wall, or let a grounded
   animal walk inward out of the 4–6 m strip. It gets a regression test and a hash note. It is independent of
   migration.
2. The open-boundary draft PR:
   - the off-map flag;
   - the regional landscape state, saved;
   - `migRng`;
   - the jackal regional slots and excursions;
   - the dispersal flux;
   - the hare edge strip;
   - exit and entry by movement;
   - the counters;
   - conservation, save/load and hash tests at the four speeds;
   - configuration flags for C, D and E;
   - the 60-seed A–E evaluation and the sensitivity runs, reported as in Gate 2.
3. Out of scope:
   - hare refuges (a later, separate PR, compared with and without the open boundary);
   - chital, boar and bird migration;
   - any renderer change beyond the entry fade, if the owner chooses option 1;
   - PRs #12 and #22.

## 10. Decision points for the owner
1. Approve option C (identity-preserving regional individuals with straddling territories) over anonymous pools.
2. Approve scoping to jackals and hares, with chital, boar and birds staying closed for now.
3. Entry pop-in: renderer-only walk-in from the apron (recommended), or a simulation transit band.
4. Approve the pre-registered parameter table as written, or amend it **before** any open-boundary run.
5. Approve fixing audit finding B1, birds stranded in the edge strip, as a separate small PR first.
