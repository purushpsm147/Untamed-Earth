import { describe, expect, it } from 'vitest';
import { B, SPECIES, SPECIES_INDEX, Simulation, maturityDays } from '@untamed/ecology';

describe('critical thirst outranks feeding', () => {
  it('a starving, critically dehydrated jackal next to a carcass goes to water, not to the carcass', () => {
    const sim = new Simulation(3);
    const j = sim.animals.find((a) => a.sp === SPECIES_INDEX.jackal && a.age > maturityDays(SPECIES[a.sp]!))!;
    // a fresh carcass 20 m away, well within smell range
    sim.carcasses.push({ id: sim.nextId++, x: j.x + 20, z: j.z, kg: 8, sp: SPECIES_INDEX.chital });
    Object.assign(j, { hunger: 0.95, thirst: 0.95, fear: 0, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    expect(j.beh).toBe(B.SeekWater);
  });

  it('a hungry animal that is only moderately thirsty still feeds first (the rule only applies above 0.85)', () => {
    const sim = new Simulation(3);
    const j = sim.animals.find((a) => a.sp === SPECIES_INDEX.jackal && a.age > maturityDays(SPECIES[a.sp]!))!;
    sim.carcasses.push({ id: sim.nextId++, x: j.x + 20, z: j.z, kg: 8, sp: SPECIES_INDEX.chital });
    Object.assign(j, { hunger: 0.95, thirst: 0.6, fear: 0, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    expect(j.beh).toBe(B.SeekCarrion);
  });
});
