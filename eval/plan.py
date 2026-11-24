#!/usr/bin/env python3
"""Plan the remaining evaluation work: every (config, seed) in eval/configs.json without a valid result in
eval/results/, split into batches of `batch` seeds (one seed per runner core). Also schedules one reproducibility
rerun (seed 1) per config listed in `verify` whose result already exists, unless eval/verify/<cfg>-1 is recorded.
Prints a GitHub Actions matrix as JSON. Usage: plan.py [--max N]"""
import json, os, sys
root = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(root, 'configs.json')))
batch = cfg['protocol']['batch']
done = {f[:-8] for f in os.listdir(os.path.join(root, 'results')) if f.endswith('.json.gz')}
vdir = os.path.join(root, 'verify')
verified = {f.split('.')[0] for f in os.listdir(vdir)} if os.path.isdir(vdir) else set()
mx = int(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 250
inc = []
for name, c in cfg['configs'].items():
    a, b = c['seeds']
    todo = [s for s in range(a, b + 1) if f'{name}-{s}' not in done]
    for i in range(0, len(todo), batch):
        inc.append({'config': name, 'sha': c['sha'], 'variant': c['variant'], 'spacing': c['spacing'], 'seeds': ' '.join(map(str, todo[i:i + batch])), 'verify': False})
for name in cfg['verify']:
    if f'{name}-1' in done and f'{name}-1' not in verified:
        c = cfg['configs'][name]
        inc.append({'config': name, 'sha': c['sha'], 'variant': c['variant'], 'spacing': c['spacing'], 'seeds': '1', 'verify': True})
inc = inc[:mx]
print(json.dumps({'include': inc}) if inc else json.dumps({'include': [{'config': 'none', 'sha': '', 'variant': '', 'spacing': 0, 'seeds': '', 'verify': False}]}))
sys.stderr.write(f'{len(inc)} batches planned\n')
