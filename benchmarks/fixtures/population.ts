/**
 * Deterministic population stress fixtures (TEST/BENCHMARK ONLY).
 *
 * Built through the supported Experiment API (Simulation.addAnimals): every animal is a normal adult with a unique ID,
 * a real group, habitat-appropriate placement inside the valley and the full state structure, drawn from the
 * simulation's own seeded random stream. The species mix keeps the proportions of the natural starting population.
 *
 * A fixture measures COMPUTATIONAL scalability at a controlled entity count. It is NOT a sustainable ecosystem:
 * food, water and social structure were never sized for these numbers, so populations will crash or starve.
 */
import { SPECIES, Simulation, type SpeciesId } from '@untamed/ecology';

export function stressFixture(seed: number, target: number): Simulation {
  const sim = new Simulation(seed);
  const base = SPECIES.map((_, i) => sim.population(i));
  const total = base.reduce((s, n) => s + n, 0);
  if (target > total) {
    const extra = target - total;
    let added = 0;
    SPECIES.forEach((sp, i) => {
      const n = i === SPECIES.length - 1 ? extra - added : Math.round((extra * base[i]!) / total);
      if (n > 0) sim.addAnimals(sp.id as SpeciesId, n);
      added += Math.max(0, n);
    });
  }
  return sim;
}

/** Fixture invariants: unique IDs, byId consistent, everyone inside the valley. Throws on violation. */
export function checkFixture(sim: Simulation): void {
  const ids = new Set<number>();
  for (const a of sim.animals) {
    if (ids.has(a.id)) throw new Error(`duplicate id ${a.id}`);
    ids.add(a.id);
    if (sim.byId.get(a.id) !== a) throw new Error(`byId mismatch ${a.id}`);
    if (!(a.x >= 0 && a.z >= 0 && a.x <= sim.valley.size && a.z <= sim.valley.size)) throw new Error(`out of bounds ${a.id}`);
    if (a.id >= sim.nextId) throw new Error(`id ${a.id} >= nextId ${sim.nextId}`);
  }
}
