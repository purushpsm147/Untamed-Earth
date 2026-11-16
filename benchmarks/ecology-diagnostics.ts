/**
 * Ecological diagnostics runner (Mission 4). Usage:
 *   node --import tsx benchmarks/ecology-diagnostics.ts --days 365 --seeds 1,2,3 --dt 2 [--variant name] [--out file.json]
 * Runs the unmodified simulation (or a named experimental variant, see benchmarks/ecology/variants.ts) with the
 * simulation-neutral EcoObserver attached and writes raw daily samples plus summaries with full metadata.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { SPECIES, Simulation } from '@untamed/ecology';
import { EcoObserver } from './ecology/observer';
import { VARIANTS } from './ecology/variants';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const days = Number(arg('days', '365'));
const seeds = arg('seeds', '1,2,3').split(',').map(Number);
const dt = Number(arg('dt', '2'));
const variant = arg('variant', 'baseline');
const out = arg('out', `docs/evidence/ecology/diag-${variant}-dt${dt}-d${days}.json`);
const apply = VARIANTS[variant];
if (!apply) throw new Error(`unknown variant ${variant}; known: ${Object.keys(VARIANTS).join(', ')}`);
const ticksPerDay = Math.round((24 * 3600) / 60 / dt);
const runs = [];
const t0 = performance.now();
for (const seed of seeds) {
  const sim = new Simulation(seed);
  const restore = apply(sim);
  const obs = new EcoObserver(sim);
  const ts = performance.now();
  for (let d = 0; d < days * ticksPerDay; d++) {
    sim.step(dt);
    obs.afterStep(dt);
  }
  obs.detach();
  restore?.();
  const end = SPECIES.map((_, i) => sim.population(i));
  runs.push({ seed, wallS: +((performance.now() - ts) / 1000).toFixed(1), endPops: end, extinct: SPECIES.filter((_, i) => end[i] === 0).map((s) => s.id), hash: sim.stateHash(), summary: obs.summary(), days: obs.days });
  console.log(`${variant} dt=${dt} seed ${seed}: end ${end.join('/')} extinct [${runs.at(-1)!.extinct}] ${runs.at(-1)!.wallS}s`);
}
let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD').toString().trim(); } catch { /* */ }
writeFileSync(out, JSON.stringify({
  meta: { variant, dt, days, seeds, species: SPECIES.map((s) => s.id), lifeYearDays: 48, commit, node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, date: new Date().toISOString(), wallS: +((performance.now() - t0) / 1000).toFixed(1) },
  runs,
}));
console.log('wrote', out);
