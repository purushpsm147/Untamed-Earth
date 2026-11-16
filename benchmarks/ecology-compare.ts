/**
 * Compare variants across seeds from docs/evidence/ecology/diag-*.json (365-day, dt 2). Usage:
 *   node --import tsx benchmarks/ecology-compare.ts baseline fix-drink-approach ... [--dir path] [--json out.json]
 * Reports per variant: species extinction counts, median end population, jackal litters, kills per chase,
 * chital deaths by cause, the share of runs where all six species persist, death totals by cause, population
 * dynamics (median coefficient of variation over days 183-365, seeds with a crash to <= 20% of the running peak,
 * median minimum after day 30) and the behaviour at death of dehydrated animals.
 */
import { readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1]! : null;
const flagged = new Set(['--json', '--dir']);
const variants = args.filter((a, i) => !flagged.has(a) && !flagged.has(args[i - 1]!));
const summary: Record<string, unknown> = {};
const dir = args.includes('--dir') ? args[args.indexOf('--dir') + 1]! : 'docs/evidence/ecology';
const sp = ['chital', 'boar', 'jackal', 'hare', 'crow', 'myna'];
const med = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1]! : NaN; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dynamics(runs: any[]): Record<string, unknown> {
  const causes = ['predation', 'starvation', 'dehydration'];
  const deathTotals = Object.fromEntries(causes.map((c) => [c, Object.fromEntries(sp.map((s) => [s, runs.reduce((t, r) => t + r.summary.deaths[s][c], 0)]))]));
  const cv: Record<string, number> = {};
  const crashSeeds: Record<string, number> = {};
  const minAfter30: Record<string, number> = {};
  sp.forEach((s, i) => {
    const cvs: number[] = [];
    const mins: number[] = [];
    let crashes = 0;
    for (const r of runs) {
      const ser: number[] = [...r.days].sort((a, b) => a.day - b.day).map((d) => d.pops[i]);
      const late = ser.slice(182);
      const mean = late.reduce((t, x) => t + x, 0) / late.length;
      if (mean > 0) cvs.push(Math.sqrt(late.reduce((t, x) => t + (x - mean) ** 2, 0) / late.length) / mean);
      let peak = 0;
      let crashed = false;
      for (const x of ser.slice(30)) {
        peak = Math.max(peak, x);
        if (peak >= 10 && x <= 0.2 * peak) crashed = true;
      }
      if (crashed) crashes++;
      mins.push(Math.min(...ser.slice(30)));
    }
    cv[s] = +med(cvs).toFixed(3);
    crashSeeds[s] = crashes;
    minAfter30[s] = med(mins);
  });
  const dehydrationBehaviour: Record<string, Record<string, number>> = {};
  for (const r of runs) for (const d of r.summary.dehydrationDeaths ?? []) {
    const b = (dehydrationBehaviour[d.sp] ??= {});
    b[d.behaviour] = (b[d.behaviour] ?? 0) + 1;
  }
  return {
    deathTotals, medianCVdays183to365: cv, seedsWithCrashTo20pctOfPeak: crashSeeds, medianMinPopAfterDay30: minAfter30,
    dehydrationBehaviour, jackalExtinctSeeds: runs.filter((r) => r.endPops[2] === 0).map((r) => r.seed),
    allSixPersistSeeds: runs.filter((r) => r.endPops.every((p: number) => p > 0)).map((r) => r.seed),
  };
}

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
    ...dynamics(runs),
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
