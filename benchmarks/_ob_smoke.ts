import { SPECIES, Simulation } from '@untamed/ecology';
const sim = new Simulation(3);
sim.configureBoundary({ open: true });
const sum = (r: number[]) => r.reduce((a, b) => a + b, 0);
const check = (): string => {
  const m = sim.migration!;
  const live = sim.animals.filter((a) => a.alive).length + sim.regional.filter((a) => a.alive).length;
  const deaths = sum(sim.deaths.map(sum));
  const expect = sim.founders + sum(m.initialRegional) + sum(sim.births) + sum(m.offBirths) - deaths - sum(m.offDeathsBackground) - sum(m.offDeathsAge) - sum(m.offDeathsPredation) - sum(m.departed);
  return `${live} vs ${expect}`;
};
console.log('regional at start', SPECIES.map((s, i) => `${s.id}:${sim.regional.filter((a) => a.sp === i).length}`).join(' '), 'territories', sim.territories.size, check());
const t0 = performance.now();
for (let d = 1; d <= 60; d++) {
  for (let i = 0; i < 720; i++) sim.step(2);
  if (d % 10 === 0) {
    const m = sim.migration!;
    const f = (k: keyof typeof m) => (m[k] as number[]).filter((_, i) => i === 2 || i === 3).join('/');
    console.log(`day ${d} on-map J/H ${sim.population(2)}/${sim.population(3)} regional J/H ${sim.regional.filter((a) => a.sp === 2).length}/${sim.regional.filter((a) => a.sp === 3).length} exc ${f('exitExcursion')} emi ${f('exitEmigration')} flee ${f('exitFlee')} visit ${f('entryVisit')} ret ${f('entryReturn')} settled ${f('settled')} dep ${f('departed')} offB ${f('offBirths')} offD ${f('offDeathsBackground')} pursuit ${f('pursuitCaptured')}:${f('pursuitEscaped')} refused ${f('refused')} | ${check()} | ${((performance.now() - t0) / d / 1000).toFixed(2)} s/day`);
  }
}
