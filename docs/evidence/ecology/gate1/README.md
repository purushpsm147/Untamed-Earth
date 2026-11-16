# Gate 1 raw evidence (PR #20, critical-thirst emergency layer)

Raw per-day diagnostics (`benchmarks/ecology-diagnostics.ts`, 365 game days, 2 s tick, seeds 1–15, identical weather
per seed), gzipped. `meta.variant` names the variant and `meta.gate1Source` the working name used during the run.
The baseline (`a0e08ba`) and `utility-bonus` (first PR #20 version, previously `fix-critical-thirst`) raw files are
the Mission 4 files one directory up.

| Variant | Code |
|---|---|
| emergency-layer-all-dark-deferral | emergency layer; diurnal animals deferred in all darkness |
| emergency-layer | emergency layer; diurnal animals deferred only while roosting/resting in darkness |
| baseline+takeoff | `a0e08ba` + bird take-off reorder in `move()` |
| baseline+water-access | `a0e08ba` + take-off + `findWater(..., drinkable)` |
| emergency-layer+takeoff | emergency layer + take-off |
| emergency-layer+water-access | PR #20 head: emergency layer + take-off + reachable water sites |

Summary and comparison: `docs/evidence/ecology/summary-15-seeds.json` and `docs/ECOLOGICAL_STABILITY_REPORT.md` on
`fix/ecology-critical-thirst`. Recompute: gunzip into a directory and run
`node --import tsx benchmarks/ecology-compare.ts baseline emergency-layer+water-access ... --dir <dir>`.
