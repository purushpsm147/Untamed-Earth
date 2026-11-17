# Gate 2 raw evidence (territorial jackal breeding)
Per-day diagnostics, 365 game days at the 2 s tick, identical weather per seed, gzipped.
- `e25-*.json.gz`: M2 (integration simulation code, = eea57e1), seeds 1-15. `g2/m2-*`: M2 at 78bb515, seeds 16-60.
- `e3b-*.json.gz`: M2 + failed-target memory (PR #27 simulation code, = 44a76b7), seeds 1-15. `g2/m3-*`: PR #27 head, seeds 16-60.
- `g2/terr-*`: M2 + memory + territories (gate2/jackal-territories), seeds 1-60.
- `g2/t720-*`: as terr with territory spacing 720 m, seeds 1-30.
Reproduce: gunzip into a directory D (keeping g2/), then `GATE2_DATA=D python3 benchmarks/ecology-gate2-analysis.py`
on branch gate2/jackal-territories.
