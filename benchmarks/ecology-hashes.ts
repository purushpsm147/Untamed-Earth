/**
 * State-hash checkpoints for recording intentional simulation changes.
 *   node --import tsx benchmarks/ecology-hashes.ts [--seeds 1,2,3] [--days 120,240,360] [--dt 2]
 * Prints `seed <s>: h1/h2/h3` (state hash after each listed game day at the given fixed tick).
 */
import { Simulation } from '@untamed/ecology';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const seeds = arg('seeds', '1,2,3').split(',').map(Number);
const checkpoints = arg('days', '120,240,360').split(',').map(Number);
const dt = Number(arg('dt', '2'));
const ticksPerDay = Math.round((24 * 3600) / 60 / dt);
for (const seed of seeds) {
  const sim = new Simulation(seed);
  const out: number[] = [];
  let tick = 0;
  for (const day of checkpoints) {
    for (; tick < day * ticksPerDay; tick++) sim.step(dt);
    out.push(sim.stateHash());
  }
  console.log(`seed ${seed}: ${out.join('/')}`);
}
