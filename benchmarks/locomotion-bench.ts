/**
 * Simulation step cost at high population counts (for movement/locomotion changes).
 *   node --import tsx benchmarks/locomotion-bench.ts [--sizes 250,1000,5000,10000] [--ticks 600]
 * Adds animals in the default species proportions with Simulation.addAnimals, warms up, then times sim.step at the
 * 1x (0.1 s) and 1000x (2 s) ticks. Single thread, wall clock; compare runs on the same machine only.
 */
import { SPECIES, Simulation } from '@untamed/ecology';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const sizes = arg('sizes', '250,1000,5000,10000').split(',').map(Number);
const ticks = Number(arg('ticks', '600'));
const total0 = SPECIES.reduce((t, s) => t + s.initial, 0);
for (const n of sizes) {
  for (const dt of [0.1, 2]) {
    const sim = new Simulation(1);
    if (n > total0) for (const s of SPECIES) sim.addAnimals(s.id, Math.round(((n - total0) * s.initial) / total0));
    for (let i = 0; i < 100; i++) sim.step(dt);
    const alive = sim.animals.filter((a) => a.alive).length;
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) sim.step(dt);
    const ms = (performance.now() - t0) / ticks;
    console.log(JSON.stringify({ target: n, alive, dt, msPerTick: +ms.toFixed(3), usPerAnimalTick: +((ms * 1000) / alive).toFixed(2) }));
  }
}
