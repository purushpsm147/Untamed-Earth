/** Headless ecosystem run: prints population trajectories and mortality causes. Usage: npm run sim -- [days] [seed] */
import { DEATH_CAUSES, SPECIES, Simulation, TIME_SCALE } from '@untamed/ecology';

const days = Number(process.argv[2] ?? 100);
const seed = Number(process.argv[3] ?? 1);
const sim = new Simulation(seed);
const dt = 2;
const ticksPerDay = (24 * 3600) / TIME_SCALE / dt;
const t0 = performance.now();
console.log('day  ' + SPECIES.map((s) => s.id.padStart(7)).join('') + '    veg  moist  stage weather');
for (let d = 0; d <= days; d++) {
  if (d % 5 === 0) {
    const pops = SPECIES.map((_, i) => String(sim.population(i)).padStart(7)).join('');
    console.log(`${String(d).padStart(4)} ${pops}  ${(sim.env.totalVeg / sim.env.totalCap).toFixed(2)}  ${sim.env.meanMoisture.toFixed(2)}  ${sim.env.stage.toFixed(2)}  ${sim.env.weather} S${sim.env.season}`);
  }
  for (let i = 0; i < ticksPerDay; i++) sim.step(dt);
}
const ms = performance.now() - t0;
console.log(`\n${days} days in ${(ms / 1000).toFixed(1)} s (${((days * ticksPerDay) / (ms / 1000)).toFixed(0)} ticks/s)`);
console.log('births:', SPECIES.map((s, i) => `${s.id}=${sim.births[i]}`).join(' '));
for (let i = 0; i < SPECIES.length; i++) console.log(`deaths ${SPECIES[i]!.id}:`, DEATH_CAUSES.map((c, k) => `${c}=${sim.deaths[i]![k]}`).join(' '));
console.log('carcasses:', sim.carcasses.length, 'hash:', sim.stateHash());
