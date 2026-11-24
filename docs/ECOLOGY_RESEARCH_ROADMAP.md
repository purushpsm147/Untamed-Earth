# Ecology research roadmap (ecology and simulation lead), November 2026

**Status: a proposal for the director. Nothing here is approved scope.** No new species, no merges of experimental
branches, and no changes to frozen configurations happen without director approval. Each item is a separate branch
and PR with:
- a pre-registration committed before any outcome run;
- paired seeds (≥ 60 × 365 days for the primary contrast);
- an explicit zero or ablation control;
- sensitivity runs;
- unit scenarios at 1×/10×/100×/1000×;
- save/load and hash determinism;
- a report that separates research findings from production acceptance.

Evidence base: `docs/ECOLOGY_CONSOLIDATED_REPORT.md` (A–F, sensitivity, G, M).

## Priority 0: close out what is open (before any new behaviour)
| # | Item | Why first | Exit criterion |
|---|---|---|---|
| 0.1 | Director decision on #27/#28/#30/#34 as a stack (see the consolidated report §6) | Every later experiment needs a fixed baseline | One accepted baseline SHA, re-frozen hashes |
| 0.2 | Fix the #35 `Defend` ↔ `Alert` standoff, then re-run M | It holds hungry jackals in `Alert` for up to ~50 game hours and suppresses predation. #31 cannot be judged until it is fixed | A new pre-registration (alert habituation or time limit, a hunger override, an end to defence when the predator neither approaches nor leaves). M′ vs C, 60 seeds. Standoff duration p99 below 1 game hour |
| 0.3 | Fawn rest latency (#31 B) | Synchrony is currently same-tick at the evaluation tick. The issue asks for brief natural latency | A per-animal delay drawn from a stated distribution. Unit test at four ticks |
| 0.4 | Observation contracts v2 (`docs/OBSERVATION_CONTRACTS_V2.md`) | Graphics, audio and gameplay need transit, residency, attention and posture without reading internals | Director approval, then an additive implementation with neutral defaults on the closed build |

## Priority 1: hare refuges (issue #29, "following experiment")
**Question.** Hare local extinction stays high in every closed configuration. Does behavioural refuge use (forms,
cover, escape-to-cover) reduce predation enough to change hare persistence, independently of immigration?

**Design (2 × 2, pre-registered):** refuge off/on × boundary closed/open, on the accepted baseline.
- **Mechanism:**
  - forms (day-time resting scrapes) in grass or scrub cover, chosen by cover and visibility, and remembered as bounded
    place memory (the four-slot pattern from #27);
  - escape-to-cover, when cover is nearer than the predator's closing distance;
  - cover reduces detection range, but **gives no immunity to a predator already tracking the hare** (#29);
  - a cost: less forage time and a thermal or forage trade-off.
- **Primary outcomes:**
  - hare local and resident-lineage extinction;
  - kill rate per hare-day;
  - the edge-cornering share (B3);
  - jackal kills per jackal-day (prey switching to chital young is a risk to measure, not to tune away).
- **Controls:** refuge-on with cover immunity disabled (it must be already disabled), and a cover-map ablation.
- **Field basis:** *Lepus nigricollis* uses forms and grass cover (ADW account cited in #29). Detection ranges and
  form fidelity are **assumed** and must be labelled as such.

## Priority 2: seasonal breeding
**Question.** All species currently breed whenever their condition allows, with only weak seasonal structure in the
birth data. Do realistic breeding seasons change the timing of predation and extinction risk? An example: a pulse of
jackal pups coinciding with the chital fawning peak.
- **Mechanism:** a seasonal receptivity curve per species, on the existing season clock.
  - Jackal: one litter per year in a defined season.
  - Chital: aseasonal, with a peak.
  - Hare: year-round, with a monsoon peak.
  - Boar: a peak.
- **Calibration:** Indian values must be cited per species or labelled assumed. Sources are not yet read; do not
  hard-code them from memory.
- **Outcomes:**
  - births by season (already recorded in `summary.births`);
  - juvenile predation by season;
  - extinction;
  - territory full-pair occupancy.
- **Interaction:** with territories (only resident pairs breed) and with the open boundary (off-map breeding uses
  the same rules).

## Priority 3: navigation intelligence
**State.** #25 added locomotion and water rules; #27 added failed-target memory, which cut jackal retry loops by
8–100×. Stuck time remains (jackals 0.5% at 1×), and so do shoreline and wall-corner traps.
- **Step 1 (read-only audit):** re-run the #24 plausibility audit on the accepted baseline at four speeds.
- **Step 2:** remembered places: bounded slots for water, refuge and carcass sites, with decay. Generalises #27.
- **Step 3:** coarse, bounded route planning, such as a precomputed walkable graph or flow field per goal type, with
  river-crossing points. It is used only when direct steering fails twice. Budget: no per-tick search; measured
  ms/tick at 10k animals.
- **Outcomes:**
  - retry loops per 100 animal-days;
  - stuck hours;
  - rejected navigation attempts;
  - water-crossing violations (stay 0);
  - ecological side effects as paired seeds (#27 showed that navigation changes population outcomes).

## Priority 4: future ecological roles (issue #26)
**No species is added without director approval.** The order follows #26. Each new role must first pass a habitat
gate and a food-web ledger.
1. Food-web resource ledger (kg/day, carcass → scavenger → rot), on the accepted baseline. Design only.
2. A P0 rodent guild and a fish guild as **aggregate pools**, so the jackal has alternative prey. This is a direct
   test of whether hare extinction is partly a single-prey artefact.
3. Sambar, Indian fox, mugger and elephant visitors only after 1–2, each on its own branch, with off-map regional
   tracking for wide-ranging species. The #29 regional-individual model is the template.

## What is explicitly not on this roadmap
- Tuning any parameter toward a target extinction count or headcount.
- Bundling refuge behaviour into the boundary PR (#29), or maternal behaviour into the evaluation.
- Space, dinosaur, mythic or world-library content (CLAUDE.md: documentation until separately accepted).
