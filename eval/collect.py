#!/usr/bin/env python3
"""Collect per-seed results from downloaded artifacts (dir argv[1]) into eval/results/<config>-<seed>.json.gz.
Single writer (run by one collect job at a time). Rules, so nothing is silently lost or duplicated:
  * a result is accepted only if its meta matches configs.json (config, frozen commit, variant, spacing, 365 days, dt 2)
    and it has 365 daily samples;
  * a (config, seed) already stored is never overwritten: an identical stateHash is recorded as a duplicate; a different
    stateHash is recorded as a CONFLICT in eval/conflicts.json for review;
  * verification reruns are compared with the stored result and recorded in eval/verify/<config>-<seed>.json.
Rewrites eval/manifest.json (per-config counts, missing seeds, sha256 of every stored file)."""
import gzip, hashlib, json, os, sys
root = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(root, 'configs.json')))
res = os.path.join(root, 'results'); vdir = os.path.join(root, 'verify'); os.makedirs(vdir, exist_ok=True)
conf_path = os.path.join(root, 'conflicts.json')
conflicts = json.load(open(conf_path)) if os.path.exists(conf_path) else []
added = dup = rejected = 0
def load_stored(name):
    with gzip.open(os.path.join(res, name + '.json.gz')) as f: return json.load(f)
for dirpath, _, files in os.walk(sys.argv[1]):
    verify = os.path.basename(dirpath).startswith('verify-') or '/verify-' in dirpath
    for fn in files:
        if not fn.endswith('.json'): continue
        try: r = json.load(open(os.path.join(dirpath, fn)))
        except Exception as e: print('unreadable', fn, e); rejected += 1; continue
        m = r.get('meta', {}); name = f"{m.get('config')}-{m.get('seed')}"
        c = cfg['configs'].get(m.get('config'))
        ok = c and m.get('commit') == c['sha'] and (m.get('variant') or '') == c['variant'] and (m.get('spacing') or 0) == c['spacing'] and m.get('days') == 365 and m.get('dt') == 2 and len(r.get('daily', [])) == 365
        if not ok: print('rejected', fn, 'meta', {k: m.get(k) for k in ('config', 'seed', 'commit', 'variant', 'spacing')}); rejected += 1; continue
        stored = os.path.exists(os.path.join(res, name + '.json.gz'))
        if verify:
            if not stored: print('verify without stored result', name); continue
            s = load_stored(name)
            rec = {'config': m['config'], 'seed': m['seed'], 'match': s['hash'] == r['hash'], 'stored': s['hash'], 'rerun': r['hash'], 'storedEnd': s['endPops'], 'rerunEnd': r['endPops']}
            json.dump(rec, open(os.path.join(vdir, name + '.json'), 'w'))
            print('verify', name, 'MATCH' if rec['match'] else 'MISMATCH'); continue
        if stored:
            s = load_stored(name)
            if s['hash'] == r['hash']: dup += 1
            else:
                conflicts.append({'name': name, 'stored': s['hash'], 'new': r['hash']}); print('CONFLICT', name)
            continue
        with gzip.open(os.path.join(res, name + '.json.gz'), 'wt') as f: json.dump(r, f)
        added += 1
json.dump(conflicts, open(conf_path, 'w'), indent=1)
man = {'configs': {}, 'files': {}}
stored = {f[:-8] for f in os.listdir(res) if f.endswith('.json.gz')}
for name, c in cfg['configs'].items():
    a, b = c['seeds']; have = [s for s in range(a, b + 1) if f'{name}-{s}' in stored]
    man['configs'][name] = {'sha': c['sha'], 'label': c['label'], 'target': b - a + 1, 'done': len(have), 'missing': [s for s in range(a, b + 1) if f'{name}-{s}' not in stored]}
for f in sorted(os.listdir(res)):
    man['files'][f] = hashlib.sha256(open(os.path.join(res, f), 'rb').read()).hexdigest()
man['verify'] = {f[:-5]: json.load(open(os.path.join(vdir, f)))['match'] for f in sorted(os.listdir(vdir))}
man['conflicts'] = len(conflicts)
json.dump(man, open(os.path.join(root, 'manifest.json'), 'w'), indent=1)
print(f'added {added}, duplicates {dup}, rejected {rejected}, conflicts total {len(conflicts)}')
print({k: f"{v['done']}/{v['target']}" for k, v in man['configs'].items()})
