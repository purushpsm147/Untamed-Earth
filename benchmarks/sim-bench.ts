/** Simulation throughput benchmark. Usage: npm run bench */
import { Simulation } from '@untamed/ecology';

for (const [label, dt, ticks] of [['1x step (0.1 s)', 0.1, 6000], ['100x step (1 s)', 1, 6000], ['1000x step (2 s)', 2, 6000]] as const) {
  const sim = new Simulation(1);
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) sim.step(dt);
  const ms = performance.now() - t0;
  const perTick = ms / ticks;
  console.log(`${label.padEnd(18)} ${perTick.toFixed(3)} ms/tick  ${(1000 / perTick).toFixed(0)} ticks/s  (${sim.animals.length} animals)  max sustainable rate ~${((1000 / perTick) * dt).toFixed(0)}x of real time on one core`);
}
