#!/usr/bin/env python3
"""Consolidated paired analysis: memory x territories x open boundary (issue #29) and the #31 investigation (M).

Reads the per-seed JSON files written by benchmarks/open-boundary-eval.ts (any configuration, any pinned commit).
Read-only: it never runs or changes the simulation.

  python3 benchmarks/ecology-consolidated-analysis.py <runs-dir> [--prior <dir>] [--json out.json]

Adds to the pre-registered analysis (benchmarks/open-boundary-analysis.py at ce83f68):
  * an independent conservation ledger per seed, from the run outputs alone:
        founders = end on-map + end off-map + deaths on + deaths off + departed - births on - births off - initial regional
    must be identical for every configuration of a seed (no count leak across region transfer);
  * paired effects as the median paired difference with a seed-bootstrap 95% CI (10,000 resamples, fixed seed);
  * paired extinction transitions with an exact McNemar (sign) test and Holm correction within each contrast;
  * Wilson 95% CIs for extinction proportions;
  * sensitivity direction stability vs D on the shared seeds;
  * cross-environment determinism: state hashes compared with an earlier run of the same commit and seed (--prior).
"""
import glob
import json
import math
import os
import random
import sys

args = sys.argv[1:]
d = args[0]
prior = args[args.index('--prior') + 1] if '--prior' in args else None
jout = args[args.index('--json') + 1] if '--json' in args else None
SP = ['chital', 'boar', 'jackal', 'hare']
CH, BO, J, H = 0, 1, 2, 3
OUT = {}


def load(dirname):
    out = {}
    for f in glob.glob(os.path.join(dirname, '*.json')):
        try:
            r = json.load(open(f))
        except Exception:
            continue
        if 'meta' not in r:
            continue
        out.setdefault(r['meta']['config'], {})[r['meta']['seed']] = r
    return out


data = load(d)


def ledger(r):
    s, mg = r['summary'], r['migration']
    res = []
    for i, sp in enumerate(SP):
        births = sum(s['births'][sp].values())
        deaths = sum(s['deaths'][sp].values())
        reg = r['daily'][-1]['regional'][i] if r['daily'][-1].get('regional') else 0
        if mg:
            offb = mg['offBirths'][i]
            offd = mg['offDeathsBackground'][i] + mg['offDeathsAge'][i] + mg['offDeathsPredation'][i]
            dep, init = mg['departed'][i], mg['initialRegional'][i]
        else:
            offb = offd = dep = init = 0
        res.append(r['endPops'][i] + reg + deaths + offd + dep - births - offb - init)
    return tuple(res)


def metrics(r):
    days = r['daily']
    m = {}
    for i, s in enumerate(SP):
        pops = [x['pops'][i] for x in days]
        loc = [x['local'][i] for x in days]
        m[f'{s}_days'] = sum(pops)
        m[f'{s}_end'] = pops[-1]
        m[f'{s}_extinct'] = int(pops[-1] == 0)
        m[f'{s}_resident_end'] = loc[-1]
        m[f'{s}_resident_extinct'] = int(loc[-1] == 0)
        m[f'{s}_resident_days'] = sum(loc)
        m[f'{s}_absent_days'] = sum(1 for p in pops if p == 0)
        gap = any(p == 0 for p in pops[30:])
        m[f'{s}_recolonised'] = int(gap and pops[-1] > 0)
    s = r['summary']
    k = s['hunting']['killsBySpecies']
    m['kills_total'] = k['chital'] + k['boar'] + k['hare']
    m['kills_hare'] = k['hare']
    m['kills_chital'] = k['chital']
    m['kills_per_jackal_day'] = m['kills_total'] / m['jackal_days'] if m['jackal_days'] else 0.0
    m['jackal_litters'] = s['litters']['jackal']
    jd = s['juvenileDeaths']
    m['chital_juv_predation'] = jd['chital']['predation']
    m['boar_juv_predation'] = jd['boar']['predation']
    m['chital_cohort_survival'] = s['cohortSurvivalToMaturity']['chital']['rate']
    m['boar_cohort_survival'] = s['cohortSurvivalToMaturity']['boar']['rate']
    bb = s['behaviourBudget']
    for sp_, beh in (('chital', 'Resting'), ('chital', 'Following mother'), ('chital', 'Alert'), ('chital', 'Defending young'),
                     ('chital', 'Hiding'), ('jackal', 'Alert'), ('jackal', 'Chasing'), ('jackal', 'Resting')):
        m[f'bb_{sp_}_{beh.replace(" ", "_")}'] = bb.get(sp_, {}).get(beh, 0.0)
    b = r['boundary']
    for prey in ('hare', 'chital'):
        kb, occ = b['killsByBand'][prey], b['occupancyH'][prey]
        tk, to = sum(kb), sum(occ)
        m[f'{prey}_edge_kill_share'] = sum(kb[:3]) / tk if tk else float('nan')
        m[f'{prey}_edge_kill_ratio'] = (sum(kb[:3]) / tk) / (sum(occ[:3]) / to) if tk and to and sum(occ[:3]) else float('nan')
    if days[0].get('terr'):
        m['full_pairs_inside'] = sum(x['fullPairs'] for x in days) / len(days)
        m['terr_inside'] = sum(x['terr'][0] for x in days) / len(days)
    if r['migration']:
        mg = r['migration']
        for key in ('exitExcursion', 'exitEmigration', 'exitFlee', 'exitAborted', 'entryVisit', 'entryReturn', 'settled',
                    'departed', 'offBirths', 'pursuitCaptured', 'pursuitEscaped', 'refused', 'suppressed'):
            m[f'{key}_jackal'] = mg[key][J]
            m[f'{key}_hare'] = mg[key][H]
        m['offdeaths_jackal'] = mg['offDeathsBackground'][J] + mg['offDeathsAge'][J] + mg['offDeathsPredation'][J]
        m['offdeaths_hare'] = mg['offDeathsBackground'][H] + mg['offDeathsAge'][H] + mg['offDeathsPredation'][H]
        m['regional_jackal_days'] = sum(x['regional'][J] for x in days)
        m['regional_hare_days'] = sum(x['regional'][H] for x in days)
    m['wallS'] = r['meta']['wallS']
    return m


M = {c: {s: metrics(r) for s, r in v.items()} for c, v in data.items()}
OUT['seeds'] = {c: len(v) for c, v in M.items()}
OUT['commits'] = {c: sorted({r['meta']['commit'][:8] for r in v.values()}) for c, v in data.items()}
print('configurations (seeds):', OUT['seeds'])
print('commits:', OUT['commits'])


def q(v, p):
    s = sorted(v)
    return s[min(len(s) - 1, int(p * (len(s) - 1) + 0.5))] if s else float('nan')


def med_iqr(v):
    v = [x for x in v if x == x]
    return f'{q(v, .5):.4g} [{q(v, .25):.4g}-{q(v, .75):.4g}]' if v else 'n/a'


def wilson(k, n, z=1.96):
    if n == 0:
        return (float('nan'), float('nan'))
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0, c - h), min(1, c + h))


def sign_p(hi, lo):
    n = hi + lo
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(min(hi, lo) + 1)) / 2 ** n)


def boot_ci(diffs, stat=lambda v: q(v, .5), n=10000, seed=29):
    rng = random.Random(seed)
    k = len(diffs)
    if k == 0:
        return (float('nan'), float('nan'))
    bs = sorted(stat([diffs[rng.randrange(k)] for _ in range(k)]) for _ in range(n))
    return (bs[int(.025 * n)], bs[int(.975 * n) - 1])


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    adj, run = [0.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (len(ps) - rank) * ps[i]))
        adj[i] = run
    return adj


# ---------------- conservation ledger ----------------
print('\n## Conservation ledger (implied founders must be identical across configurations of a seed)')
led = {}
for c, v in data.items():
    for s, r in v.items():
        led.setdefault(s, {})[c] = ledger(r)
bad = [(s, x) for s, x in led.items() if len(set(x.values())) > 1]
open_cfgs = [c for c in data if any(r['migration'] for r in data[c].values())]
same_cfg_founders = {}
for s, x in led.items():
    for c, f in x.items():
        same_cfg_founders.setdefault(f, 0)
        same_cfg_founders[f] += 1
print(f'  seeds checked: {len(led)}; configuration-seed records: {sum(len(x) for x in led.values())}; '
      f'seeds with a mismatch: {len(bad)}; distinct founder tuples: {same_cfg_founders}')
for s, x in bad[:10]:
    print('  MISMATCH seed', s, x)
OUT['ledger'] = {'records': sum(len(x) for x in led.values()), 'mismatchSeeds': [s for s, _ in bad], 'founders': {str(k): v for k, v in same_cfg_founders.items()}}

# ---------------- determinism across environments ----------------
if prior:
    pd_ = load(prior)
    same = diff = 0
    diffs = []
    for c, v in pd_.items():
        for s, r in v.items():
            o = data.get(c, {}).get(s)
            if not o or o['meta']['commit'] != r['meta']['commit'] or o['meta'].get('variant') != r['meta'].get('variant'):
                continue
            if o['hash'] == r['hash']:
                same += 1
            else:
                diff += 1
                diffs.append((c, s))
    print(f'\n## Cross-environment determinism: {same} identical / {diff} different state hashes vs prior runs (same commit, seed, variant)')
    if diffs:
        print('  different:', diffs[:20])
    OUT['determinism'] = {'identical': same, 'different': diff, 'differentList': diffs}

# ---------------- distributions ----------------
keys = ['jackal_days', 'jackal_end', 'jackal_litters', 'hare_days', 'hare_resident_days', 'hare_end', 'chital_end', 'chital_days',
        'boar_end', 'kills_total', 'kills_hare', 'kills_chital', 'kills_per_jackal_day', 'full_pairs_inside', 'hare_edge_kill_share',
        'chital_edge_kill_share', 'chital_juv_predation', 'chital_cohort_survival', 'wallS']
cfgs = list(M)
print('\n## Distributions, median [IQR]')
print('measure'.ljust(24) + ''.join(c.rjust(24) for c in cfgs))
for k in keys:
    print(k.ljust(24) + ''.join(med_iqr([m[k] for m in M[c].values() if k in m]).rjust(24) for c in cfgs))

print('\n## Extinction at day 365: local | resident lineage | recolonised, count of n [Wilson 95% CI of local]')
OUT['extinction'] = {}
for s in SP:
    row = []
    for c in cfgs:
        v = list(M[c].values())
        k, n = sum(m[f'{s}_extinct'] for m in v), len(v)
        lo, hi = wilson(k, n)
        kr = sum(m[f'{s}_resident_extinct'] for m in v)
        rc = sum(m[f'{s}_recolonised'] for m in v)
        OUT['extinction'].setdefault(c, {})[s] = {'local': k, 'resident': kr, 'recolonised': rc, 'n': n, 'ci': [lo, hi]}
        row.append(f'{k}|{kr}|r{rc}/{n} [{lo:.2f}-{hi:.2f}]'.rjust(24))
    print(s.ljust(24) + ''.join(row))

PRIMARY = ['jackal_days', 'hare_days', 'chital_days', 'kills_total', 'kills_per_jackal_day']
EXT = ['jackal_extinct', 'hare_extinct', 'chital_extinct', 'boar_extinct']
SECOND = ['hare_resident_days', 'jackal_litters', 'full_pairs_inside', 'kills_hare', 'kills_chital', 'chital_juv_predation',
          'chital_cohort_survival', 'boar_cohort_survival', 'hare_edge_kill_share', 'bb_chital_Resting', 'bb_chital_Following_mother',
          'bb_jackal_Alert', 'wallS']


def paired(a, b, label, extra=()):
    if a not in M or b not in M:
        return
    seeds = sorted(set(M[a]) & set(M[b]))
    if not seeds:
        return
    res = {'n': len(seeds), 'label': label, 'effects': {}, 'extinction': {}}
    print(f'\n## {a} -> {b}: {label} (n = {len(seeds)} paired seeds)')
    print('  measure'.ljust(28) + 'median diff [95% boot CI]'.rjust(30) + '  higher/lower   p(sign)  p(Holm)')
    fam = [k for k in PRIMARY if all(k in M[a][s] and k in M[b][s] for s in seeds)]
    rows = []
    for k in fam + [k for k in list(SECOND) + list(extra) if all(k in M[a][s] and k in M[b][s] for s in seeds)]:
        dif = [M[b][s][k] - M[a][s][k] for s in seeds]
        dif = [x for x in dif if x == x]
        hi, lo = sum(1 for x in dif if x > 0), sum(1 for x in dif if x < 0)
        rows.append((k, q(dif, .5), boot_ci(dif), hi, lo, sign_p(hi, lo), k in fam))
    ext = []
    for k in EXT:
        new = sum(1 for s in seeds if M[b][s][k] and not M[a][s][k])
        resc = sum(1 for s in seeds if M[a][s][k] and not M[b][s][k])
        ext.append((k, new, resc, sign_p(new, resc), sum(M[a][s][k] for s in seeds), sum(M[b][s][k] for s in seeds)))
    adj = holm([r[5] for r in rows if r[6]] + [e[3] for e in ext])
    ai = 0
    for r in rows:
        ph = ''
        if r[6]:
            ph = f'{adj[ai]:.4f}'
            ai += 1
        print(f'  {r[0].ljust(26)}{f"{r[1]:+.4g} [{r[2][0]:+.4g}, {r[2][1]:+.4g}]".rjust(30)}  {r[3]:3d}/{r[4]:3d}   {r[5]:.4f}   {ph}')
        res['effects'][r[0]] = {'medianDiff': r[1], 'ci': list(r[2]), 'higher': r[3], 'lower': r[4], 'p': r[5], 'pHolm': adj[ai - 1] if r[6] else None}
    for e in ext:
        print(f'  {e[0].ljust(26)} {e[4]:2d} -> {e[5]:2d}   newly extinct {e[1]:2d} / rescued {e[2]:2d}   p(McNemar) {e[3]:.4f}   p(Holm) {adj[ai]:.4f}')
        res['extinction'][e[0]] = {'a': e[4], 'b': e[5], 'newlyExtinct': e[1], 'rescued': e[2], 'p': e[3], 'pHolm': adj[ai]}
        ai += 1
    OUT.setdefault('contrasts', {})[f'{a}->{b}'] = res


paired('A', 'B', 'adds failed-target memory')
paired('B', 'C', 'adds territorial breeding (given memory)')
paired('A', 'C', 'memory + territories together')
paired('C', 'D', 'opens the boundary (given memory + territories)')
paired('C', 'E', 'exits only, zero inflow (sink effect of an open edge)')
paired('E', 'D', 'immigration itself (D inflow, E none; same off-map draws)')
paired('F', 'D', 'flee exits (D allows, F does not)')
paired('A', 'D', 'all three mechanisms vs M2')
paired('C', 'M', 'issue #31 maternal instincts (investigation, closed boundary)')

# ---------------- interaction: does the memory/territory effect depend on the boundary? ----------------
print('\n## Additivity of mechanism effects on hare and jackal local extinction (counts of 60-seed sets)')
for s in ('jackal', 'hare', 'chital'):
    try:
        e = {c: sum(m[f'{s}_extinct'] for m in M[c].values()) for c in 'ABCDE' if c in M}
        print(f'  {s}: ' + '  '.join(f'{c}={v}' for c, v in e.items()))
    except KeyError:
        pass

# ---------------- open-boundary flux ----------------
for c in [c for c in cfgs if any('settled_jackal' in m for m in M[c].values())]:
    v = list(M[c].values())
    print(f'\n## {c}: boundary flux per seed-year, median [IQR] (jackal | hare)')
    for key in ('exitExcursion', 'exitEmigration', 'exitFlee', 'exitAborted', 'entryVisit', 'entryReturn', 'settled', 'departed',
                'offBirths', 'offdeaths', 'pursuitCaptured', 'pursuitEscaped', 'refused', 'suppressed'):
        print(f'  {key.ljust(18)} {med_iqr([m[key + "_jackal"] for m in v]).rjust(22)} | {med_iqr([m[key + "_hare"] for m in v])}')
    for s, i in (('jackal', J), ('hare', H)):
        offd = sum(m[f'offdeaths_{s}'] for m in v)
        offy = sum(m[f'regional_{s}_days'] for m in v) / 48
        ond = sum(sum(data[c][seed]['summary']['deaths'][s].values()) for seed in data[c])
        ony = sum(m[f'{s}_days'] for m in v) / 48
        r_off, r_on = (offd / offy if offy else float('nan')), (ond / ony if ony else float('nan'))
        print(f'  mortality {s}: off-map {r_off:.3f} / animal-year ({offd}, {offy:.0f} a-y)   on-map {r_on:.3f} ({ond}, {ony:.0f} a-y)')
        OUT.setdefault('mortality', {}).setdefault(c, {})[s] = {'offmap': r_off, 'onmap': r_on}

# ---------------- sensitivity ----------------
SENS = [c for c in cfgs if c.startswith('S-') or c == 'G']
if 'D' in M and SENS:
    print('\n## Sensitivity vs D on shared seeds: extinctions (jackal/hare/chital) and median paired diff of hare_days, jackal_days')
    for c in SENS:
        seeds = sorted(set(M[c]) & set(M['D']))
        if not seeds:
            continue
        e = lambda cc, s: sum(M[cc][x][f'{s}_extinct'] for x in seeds)
        hd = [M[c][x]['hare_days'] - M['D'][x]['hare_days'] for x in seeds]
        jd = [M[c][x]['jackal_days'] - M['D'][x]['jackal_days'] for x in seeds]
        rd = [M[c][x]['hare_resident_days'] - M['D'][x]['hare_resident_days'] for x in seeds]
        line = (f'  {c.ljust(8)} n={len(seeds):2d}  D {e("D", "jackal")}/{e("D", "hare")}/{e("D", "chital")}  ->  '
                f'{e(c, "jackal")}/{e(c, "hare")}/{e(c, "chital")}   hare_days {q(hd, .5):+.0f} {boot_ci(hd)}   '
                f'hare_resident_days {q(rd, .5):+.0f}   jackal_days {q(jd, .5):+.0f} {boot_ci(jd)}')
        print(line)
        OUT.setdefault('sensitivity', {})[c] = {'n': len(seeds), 'ext': {s: [e('D', s), e(c, s)] for s in SP}, 'hareDays': [q(hd, .5), list(boot_ci(hd))], 'jackalDays': [q(jd, .5), list(boot_ci(jd))]}

if jout:
    json.dump(OUT, open(jout, 'w'), indent=1, default=str)
