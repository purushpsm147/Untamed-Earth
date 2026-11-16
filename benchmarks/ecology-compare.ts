/**
 * Compare variants across seeds from docs/evidence/ecology/diag-*.json (365-day, dt 2). Usage:
 *   node --import tsx benchmarks/ecology-compare.ts baseline fix-drink-approach ...
 * Reports per variant: species extinction counts, median end population, jackal litters, kills per chase,
 * chital deaths by cause, and the share of runs where all six species persist.
 */
import { readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1]! : null;
const variants = args.filter((a, i) => a !== '--json' && args[i - 1] !== '--json');
const summary: Record<string, unknown> = {};
const dir = 'docs/evidence/ecology';
const sp = ['chital', 'boar', 'jackal', 'hare', 'crow', 'myna'];
const med = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1]! : NaN; };
for (const v of variants) {
  const runs: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(`diag-${v}-dt2-d365`) || !f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    if (j.meta.variant !== v) continue;
    for (const r of j.runs) if (!runs.some((x) => x.seed === r.seed)) runs.push(r);
  }
  runs.sort((a, b) => a.seed - b.seed);
  const ext = sp.map((_, i) => runs.filter((r) => r.endPops[i] === 0).length);
  const allPersist = runs.filter((r) => r.endPops.every((p: number) => p > 0)).length;
  const endMed = sp.map((_, i) => med(runs.map((r) => r.endPops[i])));
  const lit = med(runs.map((r) => r.summary.litters.jackal));
  const succ = med(runs.map((r) => r.summary.hunting.successPerChase ?? 0));
  const kills = med(runs.map((r) => r.summary.hunting.kills));
  const chStarve = med(runs.map((r) => r.summary.deaths.chital.starvation));
  const chPred = med(runs.map((r) => r.summary.deaths.chital.predation));
  const jDehyd = med(runs.map((r) => r.summary.deaths.jackal.dehydration));
  summary[v] = {
    seeds: runs.map((r) => r.seed), extinctCounts: Object.fromEntries(sp.map((s, i) => [s, ext[i]])), allSixPersist: allPersist,
    medianEnd: Object.fromEntries(sp.map((s, i) => [s, endMed[i]])), medianJackalLitters: lit, medianKillsPerChase: succ, medianKills: kills,
    medianChitalStarvation: chStarve, medianChitalPredation: chPred, medianJackalDehydration: jDehyd,
    perSeedEnd: Object.fromEntries(runs.map((r) => [r.seed, r.endPops])),
  };
  console.log(`${v.padEnd(34)} n=${runs.length} seeds=[${runs.map((r) => r.seed).join(',')}]`);
  console.log(`   extinct in: ${sp.map((s, i) => `${s} ${ext[i]}`).join(', ')}; all six persist: ${allPersist}/${runs.length}`);
  console.log(`   median end: ${sp.map((s, i) => `${s} ${endMed[i]}`).join(', ')}`);
  console.log(`   median: jackal litters ${lit}, kills/chase ${succ}, kills ${kills}, chital starvation ${chStarve}, chital predation ${chPred}, jackal dehydration ${jDehyd}`);
}
if (jsonOut) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(jsonOut, JSON.stringify({ meta: { days: 365, dt: 2, species: sp, lifeYearDays: 48, generated: new Date().toISOString(), source: dir }, variants: summary }, null, 1));
}
