# Addendum III — Living Worlds, Curiosity Mode and Animal Societies

These are long-term identity and modularity requirements; **do not crowd out current valley acceptance tests**. Untamed Earth should become a low-friction *library of living worlds*, inviting exploration, passive enjoyment, and scientific curiosity rather than quests and grinding.

## World library / taxonomy
- **Natural Earth (100 years post-human):** forest, ocean, desert, wetland, reclaimed cities, airports, railway stations, power plants, landfills, old industrial and nuclear sites; recognizable monuments and UNESCO heritage destinations as later packs. Rewilding/decay depends on construction, local climate and ecology. Respect geography, rights to 3D models/scans and protected heritage. Do not treat UNESCO status as a license.
- **Deep Time:** Jurassic, Cretaceous, Carboniferous, Permian, Ice Age, prehistoric oceans; period-correct dinosaurs, insects and fauna, not arbitrary mixed-era menagerie presented as accurate. Differentiate evidence from inference.
- **Myth & Sacred Imagination:** optional dragons/unicorns/griffins/phoenixes, enchanted ecosystems, and a Bible-inspired Garden of Eden. Eden is a *respectful artistic interpretation*, not a declared historical reconstruction; no humanoid Adam/Eve/angels in game.
- **Cosmic:** orbital Earth, Sun, Moon, planets, moons, asteroid fields, auroras, solar flares, coronal mass ejections, century-old orbital infrastructure and rare optional non-humanoid alien spaceships. Cinematic compressed scale, UI-labeled travel speed to 1c, not physically accurate relativistic travel. Low-orbit satellites mostly decay in ~100 years; choose plausible remnants.
- **Seasonal/alternative Earth:** monsoon, snow, autumn, drought, flood, volcanic winter and ecological recovery. Separate real-season dynamics from counterfactual scenario.

World registry is data-driven (stable ID, category/evidence label, seed, rules, fauna, geography, assets, available modes, lifecycle, save schema, performance budget). Load only selected world assets. The current valley remains the only playable world until verified; don't add empty fake navigation cards.

## Signature feature: Curiosity Mode (documentary autopilot)
One-button opt-in gentle camera that watches actual simulated behavior without controlling animals. Candidates: herd grazing, alert/escape, scavenging, births, predator searches, parent-young bonds, birds, storms, seasonal phenomena, river scenes, noteworthy ruins. Director interest scores combine novelty, biological significance, visibility, distance, cinematic composition, duration and user preferences. Bounded spatial/event queries at low frequency, not full scan every animation frame.

Use minimum hold time, target cooldown and hysteresis to avoid subject-switch jitter. Camera movement smooth and collision-aware; transitions never trap the player or induce severe motion sickness. Immediately interruptible to manual/free fly, follow, possess, skip, pause. Reduced-motion gentle fades. When no salient event exists, choose scenic wandering without hallucinating predator drama. Curiosity Mode must not alter the causal ecology or spawn cinematic prey.

Future opt-in profiles: Nature Documentary; Scenic Exploration; Animal Stories; Mystery/Discovery; Relaxation. MVP candidate only one functional general mode after existing camera and event infrastructure is reliable.

## Animal sociology and Social Lens
Model species-specific societies rather than a universal hierarchy. Herd membership, parent-young, alarm propagation, foraging synchrony, mate/pair bonds, territorial decisions, leadership only where defensible; crow and jackal group structures differ from chital. No anthropomorphic fabricated social facts.

Individuals have stable IDs, state, optional mother/offspring, bounded past events, group ID and relevant relations. Social graph must remain bounded, with aggregate models for distant populations. Social Lens shows actual current group/kinship, age, behavior, needs, event history and environmental pressures, optionally highlights visible group. Never fabricate biographies. Across **Observe → Select → Follow → Become → Release**, identity, relationships, health and hunger remain unchanged except due to real simulation; control replaces autonomous movement only as applicable.

## Human artifacts and hazard realism
Ruined stations, airports, UNESCO monuments and infrastructure should be ecologically meaningful (shelter, nest, barriers, water, corrosion), not sightseeing thumbnails. A nuclear station after a century could be isolated/recovered/contaminated depending on initial event, design, containment and half-lives; avoid universally glowing green hazards or radiation-as-mutant-magic. Contamination affecting soil, water and organisms is a *future* science-informed module, not MVP.

## Sound and atmosphere
Default environmental sound: wind, rain, water, birds, insects, distant animal cries, rustling and ruin creaks. Spatial and weather-driven. Optional low-fi, meditative and ambient music, independently controlled, with original/public-domain/properly licensed assets; default music off. Casual users should be able to open a link and simply watch.

## Experimental curiosity / butterfly effects
Perturb rainfall, predators, vegetation, immigration, habitat fragmentation, seasonal conditions, contamination; observe resulting causal chains. Support future *parallel seeded scenario A/B*, clone identical initial state, hold known inputs fixed, compare trajectories; distinguish stochastic divergence from true model sensitivity and actual empirical ecological predictions.

## Rollout and acceptance
1. Preserve working MVP and current QA gates.
2. Minimal Curiosity Mode: observe real animal/landmark, smooth camera/collision, interrupt, bounded scoring, deterministic test.
3. Social Lens prototype: one biologically suitable species, real group and kinship state, preserve save/possession behavior.
4. World Library registry: only active destinations display as playable; lazy-load.
5. Larger post-human destinations, ocean, desert/seasonal, prehistoric, space, mythic and alien packs separately.

QA: camera no terrain/ruin clipping, no unstable switching, low frame-cost, reduced motion, manual override; relationships survive save/restore and don't turn into an O(n²) scan; world disable flags isolate speculative content; realistic labels are visible.
