# Addendum V — Simulation Inspectors (optional alien Easter egg)

**Working title:** *The Simulation Inspectors: A Universe Under Review*. A rare, skippable, humorous encounter introduced only after Space Exploration has real camera/orbit capability. **Never block the Reclaimed Valley MVP to build this.** Original script and art; do not reuse Rick and Morty characters, dialogue, ship design or other protected media.

## Fictional premise
An extraterrestrial **Interdimensional Simulation Compliance Bureau (ISCB)** studies anomalies and accidentally detects the player, who is an invisible viewpoint manipulating an entire browser universe. They misunderstand quality presets, frame drops, 100× time, deer possession and Curiosity Mode as cosmic threats. No humanoid aliens — only distinctive geometric vessels, drones, symbols, subtitle transmissions, synthesized voice if available.

Alien Encounters toggle **Off by default**, optional in eligible space regions (e.g., Saturn's rings or a special orbital anomaly). Deterministic seed/eligibility/cooldown, bounded event frequency, user-replay option after discovery; never spawn in Natural Earth if disabled, never force an unskippable cinematic.

## Narrative acts
**I — First contact:** vessel scans the camera and asks for dimensional identification.
> Inspector: “We found the observer. It has no body.”
> Commander: “Then how did it become a deer?”
> Inspector: “We're trying not to think about that.”

**II — Quality audit:** short lines react to actual configuration and only previously experienced features.
> On Low: “Several mountains have become remarkably angular.” “Budget cuts, Commander.”
> On Ultra: “The universe has acquired expensive shadows.” “Is it safer?” “No. Just prettier.”
> On time acceleration: “Our retirement date just passed while I was speaking.”
> On Curiosity Mode: “It's looking this way. Behave like a naturally occurring object.”

No fake numerical percentages; dialogue cooldowns prevent spam. Optional sound, subtitles, skip and dismiss.

**III — Universe within:** inspection craft reveals small holographic Earth; zoom through a portal to an apparently nested miniature world containing another craft, repeating only 3–4 visual layers. Finish with:
> SIMULATION DEPTH: 4
> Inspector: “We've found a universe containing a universe containing a universe.”
> Commander: “What's outside?”
> Inspector: “Someone with a browser tab.”

**Closing punchline:**
> Inspector: “Our existence depends on somebody keeping the tab open.”
> Commander: “Recommendation?”
> Inspector: “Remain interesting.”

Award optional **Interdimensional Inspection Report** journal discovery, explicitly fictional. No real OS/browser error dialogs, fake crashes, deceptive warnings, forced popups or loud flashing. Later rare replay might jokingly revere `localhost:5173` as a creator, clearly fiction.

## Technical implementation
Independent lazy-loaded event controller / dialogue / encounter state / small procedural ship / graphics illusion. Subscribe only while relevant to `GraphicsQualityChanged`, `SimulationSpeedChanged`, `CuriosityModeActivated`, `AnimalPossessionStarted`, `SpaceRegionEntered`; unsubscribe on dispose. No external AI calls. No full second simulation. Recursion implemented with reused mini geometry, one/two bounded small render targets, texture/shader loop or low-quality static portal. Max depth hard cap, no unbounded recursive scene graph, no new ecology engines. Reuse assets and release allocations.

Low preset gets simple transition and lower resolution, High/Ultra may enhance glow if stable. Provide reduced-motion fade mode, immediate interrupt and return to prior camera state. Persist only opt-in/discovery/cooldown/report; if saving mid-event, restore from known checkpoint or safely reset event.

Illustrative engineering targets: <250 KB compressed encounter code/data beyond shared engine, fixed small render-target count, ~60–120 seconds skippable dialogue, negligible idle cost. These are not performance guarantees.

## QA
Toggle off blocks spawn; eligible seed triggers; cooldown/replay deterministic; no humanoid entity; dialogue matches actual state; settings thrash does not spam; no extraneous ecology instances; recursive depth capped; no memory leak after repeated activation/skip/load; proper resource disposal; camera and reduced-motion restore; subtitles and mute work; browser screenshots for first contact, recursion, report; memory/FPS measured on target real hardware. No P0/P1 defects before public release.
