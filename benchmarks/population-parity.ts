/**
 * State-hash checkpoints for parity checks of performance changes (same engine). Usage:
 *   node --import tsx benchmarks/population-parity.ts > before.json   (then again after a change, and diff)
 * Natural worlds (seeds 1, 2, 4) and stress fixtures (1,000 and 2,500), at 1x/10x/100x/1000x tick sizes.
 */
import { Simulation } from '@untamed/ecology';
import { stressFixture } from './fixtures/population';

const out: Record<string, number[]> = {};
const run = (name: string, make: () => Simulation, dt: number, ticks: number, every: number): void => {
  const sim = make();
  sim.focus = { x: 768, z: 768 };
  const h: number[] = [];
  for (let i = 1; i <= ticks; i++) {
    sim.step(dt);
    if (i % every === 0) h.push(sim.stateHash(), sim.animals.length, sim.rng.state);
  }
  out[name] = h;
};
for (const seed of [1, 2, 4]) for (const dt of [0.1, 0.25, 1, 2]) run(`natural-s${seed}-dt${dt}`, () => new Simulation(seed), dt, 3000, 500);
for (const n of [1000, 2500]) for (const dt of [0.25, 2]) run(`fixture-${n}-dt${dt}`, () => stressFixture(3, n), dt, 800, 200);
console.log(JSON.stringify(out));
