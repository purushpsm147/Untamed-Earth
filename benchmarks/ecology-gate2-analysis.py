import json,glob,statistics as st,sys
from math import comb
import os
S=os.environ.get('GATE2_DATA', 'gate2-data')  # directory holding e25-*.json, e3b-*.json and g2/{m2,m3,terr,t720}-*.json
def load(globs):
    runs={}
    for g in globs:
        for f in glob.glob(g):
            for r in json.load(open(f))['runs']: runs[r['seed']]=r
    return runs
C={
 'M2': load([S+'/e25-*.json', S+'/g2/m2-*.json']),
 'M2+memory': load([S+'/e3b-*.json', S+'/g2/m3-*.json']),
 'M2+memory+territories': load([S+'/g2/terr-*.json']),
 'sensitivity: spacing 720 m': load([S+'/g2/t720-*.json']),
}
names=list(C)
MAIN=names[:3]
seeds=sorted(set.intersection(*[set(C[c]) for c in MAIN]))
seeds30=sorted(set(seeds) & set(C[names[3]]))
SENS=names[3]
print('main seeds', len(seeds), '; sensitivity seeds', len(seeds30))
SP=['chital','boar','jackal','hare','crow','myna']
J=2
def jd(r): return sum(d['pops'][J] for d in r['days'])
def kills(r): return r['summary']['hunting']['kills']
def pred(r): return sum(r['summary']['deaths'][s]['predation'] for s in ['chital','boar','hare'])
def litters(r): return r['summary']['litters']['jackal']
M={
 'jackal-days': jd,
 'jackal end population': lambda r: r['endPops'][J],
 'kills per jackal-day': lambda r: kills(r)/max(1,jd(r)),
 'total predation (chital+boar+hare)': pred,
 'jackal litters': litters,
 'hare end population': lambda r: r['endPops'][3],
 'hare min after day 30': lambda r: min(d['pops'][3] for d in sorted(r['days'],key=lambda d:d['day'])[30:]),
 'chital end population': lambda r: r['endPops'][0],
 'chital min after day 30': lambda r: min(d['pops'][0] for d in sorted(r['days'],key=lambda d:d['day'])[30:]),
}
def med(x): return st.median(x)
def q(x):
    s=sorted(x); n=len(s); return (s[n//4], s[(3*n)//4])
def signp(p,m):
    n=p+m
    if n==0: return 1.0
    k=min(p,m); return min(1.0, 2*sum(comb(n,i) for i in range(k+1))/2**n)
out={'seeds':seeds,'configs':names,'metrics':{},'extinction':{},'territory':{},'paired':{}}
print('\n== distributions (median [IQR]) over', len(seeds), 'paired seeds')
for mname,f in M.items():
    row={}
    for c in names:
        ss=seeds if c in MAIN else seeds30
        xs=[f(C[c][s]) for s in ss]; lo,hi=q(xs); row[c]={'median':round(med(xs),3),'iqr':[round(lo,3),round(hi,3)],'n':len(ss)}
    out['metrics'][mname]=row
    print(f"{mname:36s} "+' | '.join(f"{c}: {row[c]['median']} [{row[c]['iqr'][0]}, {row[c]['iqr'][1]}]" for c in names))
print('\n== extinction frequency (of', len(seeds), ')')
for i,s in enumerate(SP):
    row={c:f"{sum(1 for k in (seeds if c in MAIN else seeds30) if C[c][k]['endPops'][i]==0)}/{len(seeds if c in MAIN else seeds30)}" for c in names}
    out['extinction'][s]=row; print(f"{s:7s}", row)
allsix={c:f"{sum(1 for k in (seeds if c in MAIN else seeds30) if all(p>0 for p in C[c][k]['endPops']))}/{len(seeds if c in MAIN else seeds30)}" for c in names}
out['extinction']['allSixPersist']=allsix; print('all six persist', allsix)
print('\n== paired comparisons (sign tests): higher/lower/ties, p')
for a,b in [('M2','M2+memory'),('M2+memory','M2+memory+territories'),('M2','M2+memory+territories'),('M2+memory+territories','sensitivity: spacing 720 m')]:
    SS=seeds if b in MAIN else seeds30
    key=f"{a} -> {b} (n={len(SS)})"; out['paired'][key]={}
    print(' ', key)
    for mname,f in M.items():
        d=[(f(C[a][s]),f(C[b][s])) for s in SS]; p=sum(y>x for x,y in d); m=sum(y<x for x,y in d)
        out['paired'][key][mname]={'higher':p,'lower':m,'ties':len(d)-p-m,'p':round(signp(p,m),4)}
        print(f"    {mname:36s} {p:2d}/{m:2d}/{len(d)-p-m:2d}  p {signp(p,m):.4f}")
    for i,s in enumerate(['chital','jackal','hare']):
        idx=SP.index(s); lost=[k for k in SS if C[a][k]['endPops'][idx]>0 and C[b][k]['endPops'][idx]==0]; res=[k for k in SS if C[a][k]['endPops'][idx]==0 and C[b][k]['endPops'][idx]>0]
        out['paired'][key][f'extinction {s}']={'newlyExtinct':lost,'rescued':res,'p':round(signp(len(res),len(lost)),4)}
        print(f"    extinction {s:7s} newly extinct {len(lost):2d} rescued {len(res):2d}  p {signp(len(res),len(lost)):.4f}")
print('\n== territory metrics (territorial configurations)')
for c in names[2:]:
    SS=seeds if c in MAIN else seeds30
    T=[C[c][s].get('territory') for s in SS]
    if not all(T): continue
    def mean_daily(k): return med([st.mean(d[k] for d in t['daily']) for t in T])
    stats={k:sum(t['stats'][k] for t in T) for k in T[0]['stats']}
    pair_years=[sum(d['fullPairs'] for d in t['daily'])/48 for t in T]
    lit=[litters(C[c][s]) for s in SS]
    success=sum(lit)/max(1e-9,sum(pair_years))
    surv=[C[c][s]['summary']['cohortSurvivalToMaturity']['jackal'] for s in SS]
    born=sum(x['born'] for x in surv); resolved=sum(x['resolved'] for x in surv); survived=sum(x['survived'] for x in surv)
    occupiedFrac=med([sum(1 for d in t['daily'] if d['territories']>0)/len(t['daily']) for t in T])
    row={'median mean occupied territories':round(mean_daily('territories'),2),'median mean full pairs':round(mean_daily('fullPairs'),2),'median mean helpers':round(mean_daily('helpers'),2),'median mean floaters':round(mean_daily('floaters'),2),'median share of days with >=1 territory':round(occupiedFrac,3),'litters per full-pair life-year':round(success,3),'pups born':born,'pups survived to maturity / resolved':f"{survived}/{resolved}",'events (sum over seeds)':stats}
    out['territory'][c]=row; print(' ',c); [print('    ',k,':',v) for k,v in row.items()]
# litters per breeding-female-year for non-territorial configs for comparison
for c in names[:2]:
    lit=[litters(C[c][s]) for s in seeds]; print(f"  {c}: jackal litters total {sum(lit)}, median {med(lit)}")
json.dump(out,open(S+'/g2/gate2-summary.json','w'),indent=1)
print('\n== hare extinctions: cause context')
for c in names:
    rows=[]
    SS=seeds if c in MAIN else seeds30
    for s in SS:
        r=C[c][s]; days=sorted(r['days'],key=lambda d:d['day'])
        ext=[d for d in days if d['pops'][3]==0]
        if not ext: continue
        d0=ext[0]['day']; i0=days.index(ext[0])
        win=days[max(0,i0-30):i0]
        jack=st.mean(d['pops'][J] for d in win) if win else 0
        peak=max(d['pops'][3] for d in days[:i0]) if i0>0 else 0
        rows.append((s,d0-days[0]['day'],round(jack,1),peak))
    dc={k:sum(C[c][s]['summary']['deaths']['hare'][k] for s in SS) for k in ['predation','starvation','dehydration','background','age']}
    noj=sum(1 for x in rows if x[2]<0.5)
    print(f"  {c}: {len(rows)} hare extinctions; with no jackals in the 30 days before: {noj}; hare deaths by cause (sum) {dc}")
    out.setdefault('hareExtinctionContext',{})[c]={'extinctions':len(rows),'noJackalsInPrior30Days':noj,'hareDeathsByCause':dc,'cases':[{'seed':a,'day':b,'meanJackalsPrior30d':j,'harePeakBefore':p} for a,b,j,p in rows]}
json.dump(out,open(S+'/g2/gate2-summary.json','w'),indent=1)
