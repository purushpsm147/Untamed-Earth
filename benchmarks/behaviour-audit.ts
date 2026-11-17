/**
 * Common-sense behaviour audit across simulation speeds (read-only; see benchmarks/ecology/plausibility.ts).
 *   node --import tsx benchmarks/behaviour-audit.ts --seeds 1,2,3 --days 10 --dts 0.1,0.25,1,2 [--out file.json]
 * dt 0.1 / 0.25 / 1 / 2 s are the fixed ticks used at 1x / 10x / 100x / 1000x.
 */
import { writeFileSync } from 'node:fs';
import { SPECIES, Simulation } from '@untamed/ecology';
import { PlausibilityAudit } from './ecology/plausibility';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const seeds = arg('seeds', '1,2,3').split(',').map(Number);
const days = Number(arg('days', '10'));
const dts = arg('dts', '0.1,0.25,1,2').split(',').map(Number);
const out = arg('out', '');
const SPEED: Record<string, string> = { '0.1': '1x', '0.25': '10x', '1': '100x', '2': '1000x' };
const runs = [];
for (const dt of dts) {
  for (const seed of seeds) {
    const sim = new Simulation(seed);
    const audit = new PlausibilityAudit(sim);
    const ticks = Math.round((days * 24 * 3600) / 60 / dt);
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      sim.step(dt);
      audit.afterStep(dt);
    }
    const wallS = +((performance.now() - t0) / 1000).toFixed(1);
    const pops = SPECIES.map((_, i) => sim.population(i));
    console.log(`dt ${dt} (${SPEED[String(dt)] ?? '?'}) seed ${seed}: ${ticks} ticks, ${wallS} s, end pops ${pops.join('/')}`);
    runs.push({ dt, speed: SPEED[String(dt)] ?? null, seed, days, ticks, wallS, endPops: pops, hash: sim.stateHash(), audit: audit.summary() });
  }
}
if (out) {
  writeFileSync(out, JSON.stringify({ meta: { seeds, days, dts, generated: new Date().toISOString(), node: process.version }, runs }, null, 1));
  console.log('wrote', out);
}
