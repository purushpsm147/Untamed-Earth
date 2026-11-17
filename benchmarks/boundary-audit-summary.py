#!/usr/bin/env python3
"""Aggregate benchmarks/boundary-audit.ts output (JSON lines, one per seed) into pooled boundary findings.

  python3 benchmarks/boundary-audit-summary.py run1.jsonl [run2.jsonl ...] > summary.txt

Pooled shares: occupancy and kills are summed over seeds before normalising, so seeds with more animals weigh more.
Kill-risk confidence: a seed-level bootstrap (1,000 resamples, fixed seed) of the pooled ratio in the outer bands.
"""
import json
import random
import sys

rows = [json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
if not rows:
    sys.exit('no rows')
bands = rows[0]['bands']
nb = len(bands) - 1
labels = [f'{bands[b]:g}-{bands[b + 1]:g} m' for b in range(nb)]
species = list(rows[0]['occupancyH'].keys())
walk_share = rows[0]['bandWalkableShare']  # terrain differs per seed: report the mean
walk_share = [sum(r['bandWalkableShare'][b] for r in rows) / len(rows) for b in range(nb)]
area_share = rows[0]['bandAreaShare']
walk_frac = [sum(r['bandWalkableFraction'][b] for r in rows) / len(rows) for b in range(nb)]


def share(v):
    s = sum(v)
    return [x / s if s else 0 for x in v]


def pooled(key, sp, rs):
    return [sum(r[key][sp][b] for r in rs) for b in range(nb)]


print(f'seeds: {len(rows)} ({rows[0]["days"]:.0f} game days, dt {rows[0]["dt"]})')
print(f'out-of-region positions (all seeds): {sum(r["outOfRegion"] for r in rows)}')
print(f'edge-wall cells that are water (mean): {sum(r["edgeWaterShare"] for r in rows) / len(rows):.3f}')
print()
print('band'.ljust(12), 'area share'.rjust(11), 'walkable frac'.rjust(14), 'walkable share'.rjust(15))
for b in range(nb):
    print(labels[b].ljust(12), f'{area_share[b]:11.3f}', f'{walk_frac[b]:14.3f}', f'{walk_share[b]:15.3f}')

print('\nOccupancy share / walkable-area share (1 = uniform on walkable ground), pooled')
print('species'.ljust(8), *[l.rjust(11) for l in labels])
for sp in species:
    o = share(pooled('occupancyH', sp, rows))
    print(sp.ljust(8), *[f'{(o[b] / walk_share[b] if walk_share[b] else 0):11.2f}' for b in range(nb)])

print('\nWall contact (< 8 m from the edge) and pinning (want > 0, speed < 0.05 m/s), animal-hours over all seeds')
print('species'.ljust(8), 'contact h'.rjust(10), 'pinned h'.rjust(9), 'all h'.rjust(11), 'contact share'.rjust(14))
for sp in species:
    c = sum(r['wallContactH'][sp] for r in rows)
    p = sum(r['wallPinnedH'][sp] for r in rows)
    t = sum(sum(r['occupancyH'][sp]) for r in rows)
    print(sp.ljust(8), f'{c:10.1f}', f'{p:9.1f}', f'{t:11.0f}', f'{(c / t if t else 0):14.5f}')

print('\nFlee episodes: started, target clamped by the 8 m edge clamp, ended < 30 m from the edge')
for sp in species:
    s = sum(r['fleeStarts'][sp] for r in rows)
    c = sum(r['fleeTargetClamped'][sp] for r in rows)
    e = sum(r['fleeEndsNearEdge'][sp] for r in rows)
    if s:
        print(f'{sp.ljust(8)} {s:8d} {c:6d} ({c / s:.4f}) {e:6d} ({e / s:.4f})')

print('\nPredation: kill share / occupancy share per band (> 1 = kills concentrated there), pooled; 95% seed bootstrap for < 60 m')
rnd = random.Random(29)
for sp in species:
    k = pooled('killsByBand', sp, rows)
    if sum(k) < 10:
        continue
    o = share(pooled('occupancyH', sp, rows))
    ks = share(k)
    ratio = [(ks[b] / o[b] if o[b] else 0) for b in range(nb)]
    outer = [b for b in range(nb) if bands[b + 1] <= 60]

    def outer_ratio(rs):
        kk = pooled('killsByBand', sp, rs)
        oo = pooled('occupancyH', sp, rs)
        ko = sum(kk[b] for b in outer) / max(1, sum(kk))
        oc = sum(oo[b] for b in outer) / max(1e-9, sum(oo))
        return ko / oc if oc else 0

    boots = sorted(outer_ratio([rnd.choice(rows) for _ in rows]) for _ in range(1000))
    print(f'{sp.ljust(8)} kills {sum(k):5d}', *[f'{x:6.2f}' for x in ratio], f'| <60 m: {outer_ratio(rows):.2f} [{boots[25]:.2f}-{boots[974]:.2f}]')

print('\nDeaths (all causes) per band, pooled')
for sp in species:
    d = pooled('deathsByBand', sp, rows)
    print(sp.ljust(8), *[f'{x:6d}' for x in d])

ts = [r['territory'] for r in rows if r['territory']['samples']]
n = sum(t['samples'] for t in ts)
if n:
    w = lambda k: sum(t[k] * t['samples'] for t in ts) / n
    print(f'\nJackal territories: {n} territory-days over {len(ts)} seeds')
    print(f'  centre-to-edge mean {w("centreEdgeMean"):.0f} m, minimum {min(t["centreEdgeMin"] for t in ts):.0f} m')
    print(f'  exclusive disc (r = spacing/2) crossing the edge: {w("discCrossesEdgeShare"):.3f} of territory-days')
    print(f'  mean disc fraction outside the region: {w("discOutsideMean"):.3f}')
    print(f'  mean disc fraction that is walkable valley ground: {w("discWalkableMean"):.3f}')
print(f'\nrun time per seed: median {sorted(r["ms"] for r in rows)[len(rows) // 2] / 1000:.0f} s')
