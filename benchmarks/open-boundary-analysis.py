#!/usr/bin/env python3
"""Open-boundary evaluation analysis (issue #29). Reads the per-seed JSON files written by
benchmarks/open-boundary-eval.ts and prints paired comparisons.

  python3 benchmarks/open-boundary-analysis.py <dir> [A B C D E F ...]

For each configuration: median [IQR] of local measures, extinction counts. For pairs (C-D, D-E, D-F, B-C, A-D):
seeds higher / lower and a two-sided sign test; extinction transitions (newly extinct / rescued) with a sign test.
Open configurations also report the migration counters and off-map vs on-map mortality.
"""
import glob
import json
import math
import os
import sys

d = sys.argv[1]
cfgs = sys.argv[2:] or ['A', 'B', 'C', 'D', 'E', 'F']
SP = ['chital', 'boar', 'jackal', 'hare', 'crow', 'myna']
J, H, CH = 2, 3, 0


def load(c):
    out = {}
    for f in glob.glob(os.path.join(d, f'{c}-*.json')):
        r = json.load(open(f))
        out[r['meta']['seed']] = r
    return out


data = {c: load(c) for c in cfgs}
data = {c: v for c, v in data.items() if v}


def med_iqr(v):
    s = sorted(v)
    if not s:
        return 'n/a'
    q = lambda p: s[min(len(s) - 1, int(p * (len(s) - 1) + 0.5))]
    return f'{q(0.5):g} [{q(0.25):g}-{q(0.75):g}]'


def sign_p(hi, lo):
    n = hi + lo
    if n == 0:
        return 1.0
    k = min(hi, lo)
    p = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * p)


def metrics(r):
    days = r['daily']
    m = {}
    for i, s in enumerate(SP[:4]):
        pops = [x['pops'][i] for x in days]
        loc = [x['local'][i] for x in days]
        m[f'{s}_days'] = sum(pops)
        m[f'{s}_end'] = pops[-1]
        m[f'{s}_min30'] = min(pops[30:]) if len(pops) > 30 else min(pops)
        m[f'{s}_extinct'] = 1 if pops[-1] == 0 else 0
        m[f'{s}_resident_end'] = loc[-1]
        m[f'{s}_resident_extinct'] = 1 if loc[-1] == 0 else 0
        # recolonisation: absent for >= 1 day after day 30, present at the end
        gap = any(p == 0 for p in pops[30:])
        m[f'{s}_recolonised'] = 1 if gap and pops[-1] > 0 else 0
    s = r['summary']
    kills = s['hunting']['killsBySpecies']
    m['kills_total'] = kills['chital'] + kills['boar'] + kills['hare']
    m['kills_hare'] = kills['hare']
    m['kills_per_jackal_day'] = m['kills_total'] / m['jackal_days'] if m['jackal_days'] else 0
    m['jackal_litters'] = s['litters']['jackal']
    b = r['boundary']
    for prey in ('hare', 'chital'):
        kb = b['killsByBand'][prey]
        occ = b['occupancyH'][prey]
        tk, to = sum(kb), sum(occ)
        m[f'{prey}_edge_kill_ratio'] = (sum(kb[:3]) / tk) / (sum(occ[:3]) / to) if tk and to and sum(occ[:3]) else float('nan')
        m[f'{prey}_edge_kill_share'] = sum(kb[:3]) / tk if tk else float('nan')
    if r['daily'][0].get('terr'):
        m['terr_inside'] = sum(x['terr'][0] for x in days) / len(days)
        m['terr_straddle'] = sum(x['terr'][1] for x in days) / len(days)
        m['terr_external'] = sum(x['terr'][2] for x in days) / len(days)
        m['full_pairs_inside'] = sum(x['fullPairs'] for x in days) / len(days)
    if r['migration']:
        mg = r['migration']
        for k in ('exitExcursion', 'exitEmigration', 'exitFlee', 'exitAborted', 'entryVisit', 'entryReturn', 'settled', 'departed', 'offBirths', 'offDeathsBackground', 'offDeathsAge', 'offDeathsPredation', 'pursuitCaptured', 'pursuitEscaped', 'suppressed'):
            m[f'{k}_jackal'] = mg[k][J]
            m[f'{k}_hare'] = mg[k][H]
        m['regional_jackal_days'] = sum(x['regional'][J] for x in days)
        m['regional_hare_days'] = sum(x['regional'][H] for x in days)
    return m


M = {c: {seed: metrics(r) for seed, r in v.items()} for c, v in data.items()}
print('configurations:', {c: len(v) for c, v in M.items()})
keys = ['jackal_days', 'jackal_end', 'jackal_resident_end', 'jackal_litters', 'hare_days', 'hare_end', 'hare_min30', 'hare_resident_end', 'chital_end', 'kills_total', 'kills_hare', 'kills_per_jackal_day', 'hare_edge_kill_ratio', 'hare_edge_kill_share', 'chital_edge_kill_ratio', 'terr_inside', 'terr_straddle', 'full_pairs_inside']
print('\n## Distributions, median [IQR]')
print('measure'.ljust(24) + ''.join(c.rjust(26) for c in M))
for k in keys:
    print(k.ljust(24) + ''.join(med_iqr([round(m[k], 3) for m in M[c].values() if k in m and m[k] == m[k]]).rjust(26) for c in M))

print('\n## Extinction at day 365 (local / resident lineage) and recolonisation')
for s in SP[:4]:
    row = []
    for c in M:
        v = M[c].values()
        row.append(f"{sum(m[f'{s}_extinct'] for m in v)}/{sum(m[f'{s}_resident_extinct'] for m in v)}/r{sum(m[f'{s}_recolonised'] for m in v)} of {len(M[c])}".rjust(26))
    print(s.ljust(24) + ''.join(row))


def paired(a, b, label):
    if a not in M or b not in M:
        return
    seeds = sorted(set(M[a]) & set(M[b]))
    print(f'\n## {a} -> {b} ({label}), n = {len(seeds)}: seeds higher / lower in {b}, sign test')
    for k in ['jackal_days', 'jackal_litters', 'hare_days', 'hare_end', 'hare_min30', 'chital_end', 'kills_total', 'kills_hare', 'kills_per_jackal_day', 'hare_edge_kill_share']:
        if not all(k in M[a][s] and k in M[b][s] for s in seeds):
            continue
        hi = sum(1 for s in seeds if M[b][s][k] > M[a][s][k])
        lo = sum(1 for s in seeds if M[b][s][k] < M[a][s][k])
        print(f'  {k.ljust(22)} {hi:3d} / {lo:3d}   p = {sign_p(hi, lo):.4f}')
    for s_ in SP[:4]:
        k = f'{s_}_extinct'
        new = sum(1 for s in seeds if M[b][s][k] and not M[a][s][k])
        res = sum(1 for s in seeds if M[a][s][k] and not M[b][s][k])
        print(f'  extinction {s_.ljust(8)} newly extinct {new:3d} / rescued {res:3d}   p = {sign_p(new, res):.4f}')


paired('A', 'B', 'memory')
paired('B', 'C', 'territories')
paired('C', 'D', 'open boundary')
paired('E', 'D', 'immigration (D has inflow, E none)')
paired('F', 'D', 'flee exits (D allows, F not)')
paired('A', 'D', 'M2 -> open')

for c in M:
    v = list(M[c].values())
    if 'exitExcursion_jackal' not in v[0]:
        continue
    print(f'\n## {c}: boundary counters per seed-year, median [IQR] (jackal | hare)')
    for k in ('exitExcursion', 'exitEmigration', 'exitFlee', 'exitAborted', 'entryVisit', 'entryReturn', 'settled', 'departed', 'offBirths', 'offDeathsBackground', 'offDeathsAge', 'offDeathsPredation', 'pursuitCaptured', 'pursuitEscaped', 'suppressed'):
        print(f'  {k.ljust(20)} {med_iqr([m[k + "_jackal"] for m in v]).rjust(18)} | {med_iqr([m[k + "_hare"] for m in v])}')
    # off-map vs on-map mortality per animal-year (48 game days = 1 life-year)
    for i, s in ((J, 'jackal'), (H, 'hare')):
        off_d = sum(m[f'offDeathsBackground_{s}'] + m[f'offDeathsAge_{s}'] + m[f'offDeathsPredation_{s}'] for m in v)
        off_y = sum(m[f'regional_{s}_days'] for m in v) / 48
        on_d = sum(sum(data[c][seed]['summary']['deaths'][s].values()) if isinstance(data[c][seed]['summary']['deaths'][s], dict) else sum(data[c][seed]['summary']['deaths'][s]) for seed in data[c])
        on_y = sum(m[f'{s}_days'] for m in v) / 48
        print(f'  mortality {s}: off-map {off_d / off_y if off_y else float("nan"):.3f} / animal-year ({off_d} deaths, {off_y:.0f} animal-years); on-map {on_d / on_y if on_y else float("nan"):.3f} ({on_d}, {on_y:.0f})')
