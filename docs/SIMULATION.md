# Simulation model

This is a simplified, causally coherent model, not a calibrated ecological forecast. Where a choice trades realism for watchability it is stated here.

## Time compression (read this first)

| Clock | Scale | Why |
|---|---|---|
| Motion | real time at 1× | Animals walk and run at believable speeds |
| Physiology and calendar | 60× motion | A full day/night cycle takes 24 minutes at 1× |
| Life history | one year = 48 game days (factor 7.6) | Seasons, gestation and maturation fit inside a session and a 100-day test |

Consequences worth knowing: an animal's daily food and water needs are real daily amounts, but it lives through fewer days per year, so lifetime consumption is lower than in nature. Forage capacity was scaled down so herbivores can still deplete it.

## Environment (24 m grid, 3 600 cells)

- **Weather**: a seasonal Markov chain over clear / overcast / rain / storm (rain chance 3% winter, 5% summer, 42% monsoon, 12% post-monsoon). Cloud, rain rate and wind relax toward the state's targets.
- **Soil moisture**: gains from rain, loses to evapotranspiration (temperature, light, canopy shade), and is held up near open water.
- **River stage**: follows mean catchment moisture with lag; it moves the water surface, which floods or dries the shallow wetland and decides where animals can drink.
- **Vegetation**: logistic growth per cell, co-limited by moisture, temperature, light, nutrients and contamination; senescence speeds up in dry soil. A small seed-bank term lets bare cells recover.
- **Nutrients**: growth draws nutrients down; dung, dead plants and carcasses become detritus, which decomposes (faster when warm and moist) back into nutrients.
- **Abstract consumers**: invertebrates and small fauna grow logistically toward capacities set by vegetation, detritus, moisture and shelter (ruins, scrap).
- **Contamination**: dump soils suppress growth; leachate pools never dry but damage the health of whatever drinks from them.

## Animals

State per individual: identity, species, position, altitude (birds), heading, age, sex, health, hunger, thirst, rest, sprint stamina, fear, behaviour and target, pregnancy and breeding cooldown, home range, group, mother, and one remembered drinking site.

**Perception** is local: vision shortened by darkness (less for nocturnal species), forest cover and rain; hearing at short range; carrion by smell. Stalking predators are harder to detect, resting animals detect less. Neighbours come from a spatial hash, never a global scan. Animals do not know where water or food is beyond their senses, except for a remembered drinking site and their group's home range.

**Decisions** are utility scores re-evaluated every few seconds: flee (overrides everything), drink, forage, rest or roost, seek a mate, approach carrion, stalk prey, wander. The current behaviour gets a small bonus to prevent dithering.

**Movement** (Living Valley V1). Behaviours set a *desired* speed; the body follows with species acceleration and
braking (heavier animals are slower to start: hare ~9 m/s², chital ~4.5 m/s²) and slows to arrive instead of stopping
dead. Turning rate falls with speed and body mass, so a sprinting deer arcs and a walking one can pivot. Ground animals
steer by looking ahead (1.2 m, half and full look distance; look grows with speed) along eleven headings around the goal
and taking the cheapest: buildings and the region edge are walls, slopes above ~44° up or ~52° down are refused and
steep ground costs more, jackals avoid deep water strongly and small mammals cannot enter it. Once a wall forces a
detour, the animal commits to that side until the direct line is clear (a "bug" wall-following rule), which stops
left-right dithering in front of wide ruins. Every 4 s each animal checks progress (moved at all, and closest approach
to its destination improved); after two failed checks it abandons the destination (flee re-plans an escape, water
seekers forget the unreachable site, others go idle).

**Herds** (chital and boar; not bird flocks). Many eyes: an individual's chance of detecting a predator rises with the
number of herd mates nearby. When an alarm sends them running, each blends its own escape direction with the herd's
centre (unless the centre lies toward the threat), so the herd tends to flee together. After a flight, and whenever an
animal has drifted more than 30 m from its herd, it *regroups*, trotting back to the herd's near side; a rejoined animal
resumes ordinary behaviour.

**Food web**: grazers remove forage from their cell (with a functional response, so sparse forage feeds slowly); omnivores also draw on invertebrate and small-fauna pools; jackals stalk, chase and kill hares, fawns, weak deer and piglets, limited by sprint stamina and by adults defending young; kills and other deaths leave carcasses that jackals, boar and crows eat and that otherwise rot into detritus.

**Demography**: conception needs a receptive female in season and in condition, and a male that finds her; only the dominant female in a jackal family breeds. Gestation, litter size, weaning and maturity come from the species table. Deaths: predation, starvation, dehydration, old age, poisoning (leachate), and a density-dependent background hazard standing in for causes not modelled individually (raptors, snakes, disease). Nothing respawns.

## Species (approximate field values, South Asian populations)

| Species | Adult mass | Diet in model | Activity | Gestation / litter | Notes |
|---|---|---|---|---|---|
| Spotted deer, *Axis axis* | 60 kg | Forage | Crepuscular | 230 d / 1 | Herds; alarm calls spread to herd mates |
| Wild boar, *Sus scrofa cristatus* | 80 kg | Forage, invertebrates, carrion | Mostly nocturnal | 115 d / 3–6 | Adults ignore jackals and defend piglets |
| Golden jackal, *Canis aureus* | 9 kg | Small fauna, carrion, hares, fawns, piglets, some fruit | Crepuscular | 63 d / 2–5, winter | Pairs; one breeding female per family |
| Indian hare, *Lepus nigricollis* | 2.3 kg | Forage | Nocturnal | 42 d / 1–4 | Gets most water from food |
| House crow, *Corvus splendens* | 0.3 kg | Carrion, invertebrates, small fauna, fruit | Diurnal | ~30 d to fledging / 1–3 | Roosts in trees and on ruins |
| Common myna, *Acridotheres tristis* | 0.11 kg | Invertebrates, fruit | Diurnal | ~26 d to fledging / 1–3 | Favours the settlement |

Simplifications: bird "gestation" stands for incubation plus nestling period and "litter" for fledged young; running speeds are scaled down from true top speeds so chases are watchable; tigers and other large predators are absent because the valley is far smaller than their territories.

## Determinism

One seeded generator drives all stochastic choices, in a fixed iteration order. Given the same seed, the same sequence of `step(dt)` calls and the same inputs (focus, control, experiment levers), the state is bit-identical; this is tested, including across a save/load round trip. Different time multipliers use different step sizes and therefore produce different (equally valid) histories.

## Known model limits

- Jackals rarely starve because the small-fauna pool is forgiving; their numbers are held mainly by breeding rules and background mortality.
- Hares can be driven locally extinct by a drought followed by a jackal peak; there is no immigration from outside the valley.
- Steering is local with wall-following, not path-finding: an animal can still give up on a destination behind a long
  river bend or inside a courtyard of ruins, and choose another. `npm run movement` reports pinned animals (≈1–5 twenty-second
  windows per seed-day across ~200 animals).
- Herd cohesion uses the group centre only: there is no leader, no spacing between individuals, and no lying-down group
  vigilance rota.
