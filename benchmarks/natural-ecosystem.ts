/**
 * Naturally evolving ecosystem (Mission 2, experiment 2). Usage:
 *   node --expose-gc --import tsx benchmarks/natural-ecosystem.ts [days] [seeds...] [--out file.json]
 * Runs the unmodified Simulation from its natural starting population at the 1000x tick (2 s), with no fixtures, no
 * levers and no rule changes, and records per game day: population by species, births, deaths by cause, and the
 * tick cost. Answers how large a population the real food web produces and sustains, and what it costs.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { DEATH_CAUSES, SPECIES, Simulation } from '@untamed/ecology';

const args = process.argv.slice(2);
const outI = args.indexOf('--out');
const out = outI >= 0 ? args.splice(outI, 2)[1]! : 'docs/evidence/tech-experiments/natural-ecosystem.json';
const days = Number(args[0] ?? 365);
const seeds = args.slice(1).map(Number);
const SEEDS = seeds.length ? seeds : [1, 2, 3];
const DT = 2;
const TICKS_PER_DAY = (24 * 3600) / 60 / DT; // 720
const runs = [];
for (const seed of SEEDS) {
  const sim = new Simulation(seed);
  const t0 = performance.now();
  const daily: { day: number; pops: number[]; total: number; births: number; deaths: number; tickMsMean: number; tickMsP99: number }[] = [];
  let peak = 0;
  for (let d = 1; d <= days; d++) {
    const b0 = sim.births.reduce((s, x) => s + x, 0);
    const d0 = sim.deaths.flat().reduce((s, x) => s + x, 0);
    const t: number[] = [];
    for (let i = 0; i < TICKS_PER_DAY; i++) {
      const a = performance.now();
      sim.step(DT);
      t.push(performance.now() - a);
    }
    t.sort((x, y) => x - y);
    const pops = SPECIES.map((_, i) => sim.population(i));
    const total = pops.reduce((s, x) => s + x, 0);
    peak = Math.max(peak, total);
    daily.push({
      day: d, pops, total, births: sim.births.reduce((s, x) => s + x, 0) - b0, deaths: sim.deaths.flat().reduce((s, x) => s + x, 0) - d0,
      tickMsMean: Math.round((t.reduce((s, x) => s + x, 0) / t.length) * 1000) / 1000, tickMsP99: Math.round(t[Math.floor(t.length * 0.99)]! * 1000) / 1000,
    });
    if (d % 30 === 0) console.log(`seed ${seed} day ${d}: ${pops.join('/')} = ${total}  tick mean ${daily.at(-1)!.tickMsMean} ms`);
  }
  const extinct = SPECIES.filter((_, i) => sim.population(i) === 0).map((s) => s.id);
  runs.push({
    seed, days, wallS: Math.round((performance.now() - t0) / 100) / 10, start: daily[0]!.total, end: daily.at(-1)!.total, peak, extinct,
    births: Object.fromEntries(SPECIES.map((s, i) => [s.id, sim.births[i]])),
    deaths: Object.fromEntries(SPECIES.map((s, i) => [s.id, Object.fromEntries(DEATH_CAUSES.map((c, j) => [c, sim.deaths[i]![j]]))])),
    hash: sim.stateHash(), daily,
  });
}
let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD').toString().trim(); } catch { /* */ }
writeFileSync(out, JSON.stringify({
  env: { label: process.env.BENCH_LABEL ?? 'container', commit, node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, date: new Date().toISOString() },
  species: SPECIES.map((s) => s.id), dt: DT, runs,
}, null, 1));
console.log('wrote', out);
