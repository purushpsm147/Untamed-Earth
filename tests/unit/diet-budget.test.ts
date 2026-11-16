import { describe, expect, it } from 'vitest';
import { SPECIES, Simulation } from '@untamed/ecology';

// The source-split intake (eatenBy) is a diagnostic: it must account for every kg in `eaten`, survive save/load, and
// never touch the state hash.
describe('diet budget diagnostic', () => {
  it('sums to the total intake for every species', () => {
    const sim = new Simulation(4);
    for (let i = 0; i < 20 * 720; i++) sim.step(2);
    SPECIES.forEach((_, s) => {
      const b = sim.eatenBy[s]!;
      expect(b.veg + b.invert + b.fauna + b.kill + b.carrion).toBeCloseTo(sim.eaten[s]!, 6);
    });
    // jackals have eaten something, and predation has left carcass mass
    const j = sim.eatenBy[2]!;
    expect(j.veg + j.invert + j.fauna + j.kill + j.carrion).toBeGreaterThan(0);
    expect(sim.killKg).toBeGreaterThanOrEqual(j.kill);
  });

  it('is saved and restored, and is not part of the state hash', () => {
    const sim = new Simulation(4);
    for (let i = 0; i < 10 * 720; i++) sim.step(2);
    const copy = new Simulation(4, sim.snapshot());
    expect(copy.eatenBy).toEqual(sim.eatenBy);
    expect(copy.killKg).toBe(sim.killKg);
    const h = sim.stateHash();
    sim.eatenBy[2]!.fauna += 5;
    expect(sim.stateHash()).toBe(h);
  });
});
