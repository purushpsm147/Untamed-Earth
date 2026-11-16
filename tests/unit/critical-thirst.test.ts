import { describe, expect, it } from 'vitest';
import { B, CRITICAL_THIRST, SPECIES, SPECIES_INDEX, Simulation, maturityDays, type Animal } from '@untamed/ecology';

// Behavioural priority policy (docs/ECOLOGICAL_STABILITY_REPORT.md, "Behavioural priority policy"):
//   flood escape > flee > physiological emergency (critical thirst) > committed actions > dependent young > utilities
// with one activity-pattern deferral: a diurnal animal waits for first light before travelling to water.

function adult(sim: Simulation, sp: number): Animal {
  return sim.animals.find((a) => a.sp === sp && a.alive && a.mother === 0 && a.age > maturityDays(SPECIES[a.sp]!))!;
}

/** Move the clock to the given hour of the next day (environment only). */
function setHour(sim: Simulation, h: number): void {
  sim.env.timeH = (Math.floor(sim.env.timeH / 24) + 1) * 24 + h;
}

const GOES_TO_WATER = [B.SeekWater, B.Drink];

describe('critical thirst: the physiological emergency layer', () => {
  it('a starving, critically dehydrated jackal next to a carcass goes to water, not to the carcass', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    sim.carcasses.push({ id: sim.nextId++, x: j.x + 20, z: j.z, kg: 8, sp: SPECIES_INDEX.chital });
    Object.assign(j, { hunger: 0.95, thirst: 0.95, fear: 0, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    expect(j.beh).toBe(B.SeekWater);
  });

  it('ordinary (non-critical) thirst still competes: a starving, moderately thirsty jackal takes the carcass', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    sim.carcasses.push({ id: sim.nextId++, x: j.x + 20, z: j.z, kg: 8, sp: SPECIES_INDEX.chital });
    Object.assign(j, { hunger: 0.95, thirst: 0.6, fear: 0, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    expect(j.beh).toBe(B.SeekCarrion);
  });

  it('just below the threshold the emergency layer does not fire', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    sim.carcasses.push({ id: sim.nextId++, x: j.x + 20, z: j.z, kg: 8, sp: SPECIES_INDEX.chital });
    Object.assign(j, { hunger: 0.95, thirst: CRITICAL_THIRST - 0.02, fear: 0, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    expect(j.beh).toBe(B.SeekCarrion);
  });

  it('interrupts an animal that is already feeding (previously the Feed commitment kept it at the carcass)', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    const c = { id: sim.nextId++, x: j.x + 1, z: j.z, kg: 8, sp: SPECIES_INDEX.chital };
    sim.carcasses.push(c);
    Object.assign(j, { hunger: 0.5, thirst: 0.9, fear: 0, beh: B.Feed, targetId: c.id, timer: 0 });
    sim.step(0.1);
    expect(GOES_TO_WATER).toContain(j.beh);
  });

  it('a feeding animal with ordinary thirst keeps feeding (commitment preserved below the threshold)', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    const c = { id: sim.nextId++, x: j.x + 1, z: j.z, kg: 8, sp: SPECIES_INDEX.chital };
    sim.carcasses.push(c);
    Object.assign(j, { hunger: 0.5, thirst: 0.6, fear: 0, beh: B.Feed, targetId: c.id, timer: 0 });
    sim.step(0.1);
    expect(j.beh).toBe(B.Feed);
  });

  it('interrupts a hunting predator mid-chase', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    const prey = adult(sim, SPECIES_INDEX.hare);
    Object.assign(j, { hunger: 0.7, thirst: 0.9, fear: 0, beh: B.Chase, targetId: prey.id, stamina: 1, timer: 0 });
    sim.step(0.1);
    expect(GOES_TO_WATER).toContain(j.beh);
  });

  it('never interrupts drinking', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    const w = sim.env.findWater(j.x, j.z, 2000)!;
    expect(sim.env.waterHere(w.x, w.z)).toBeGreaterThan(0);
    Object.assign(j, { hunger: 0.9, thirst: 0.95, fear: 0, beh: B.Drink, tx: w.x, tz: w.z, timer: 0 });
    sim.step(0.1);
    expect(j.beh).toBe(B.Drink);
    expect(j.thirst).toBeLessThan(0.95);
  });

  it('escape still wins: a frightened, critically thirsty animal flees', () => {
    const sim = new Simulation(3);
    const c = adult(sim, SPECIES_INDEX.chital);
    Object.assign(c, { thirst: 0.95, fear: 0.9, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    expect(c.beh).toBe(B.Flee);
  });

  it('a diurnal bird roosting in darkness waits for first light, then goes to water', () => {
    // the review counterexample: exhausted crow at night, thirst 0.86 (roost utility 1.64 beat water 1.612)
    const sim = new Simulation(3);
    setHour(sim, 0);
    expect(sim.env.daylight()).toBeLessThan(0.1);
    const crow = adult(sim, SPECIES_INDEX.crow);
    Object.assign(crow, { hunger: 0.3, thirst: 0.86, energy: 0, fear: 0, beh: B.Roost, timer: 0 });
    sim.step(0.1);
    expect(crow.beh).toBe(B.Roost);

    setHour(sim, 12);
    expect(sim.env.daylight()).toBeGreaterThan(0.9);
    Object.assign(crow, { hunger: 0.3, thirst: 0.86, energy: 0, fear: 0, beh: B.Roost, timer: 0 });
    sim.step(0.1);
    expect(GOES_TO_WATER).toContain(crow.beh);
  });

  it('a diurnal bird that is awake at night goes to water, not to carrion (the deferral only covers roosting)', () => {
    const sim = new Simulation(3);
    setHour(sim, 0);
    const crow = adult(sim, SPECIES_INDEX.crow);
    sim.carcasses.push({ id: sim.nextId++, x: crow.x + 20, z: crow.z, kg: 8, sp: SPECIES_INDEX.chital });
    Object.assign(crow, { hunger: 0.95, thirst: 0.9, energy: 1, fear: 0, beh: B.Idle, timer: 0 });
    sim.step(0.1);
    expect(GOES_TO_WATER).toContain(crow.beh);
  });

  it('a nocturnal animal is not deferred at night', () => {
    const sim = new Simulation(3);
    setHour(sim, 0);
    const j = adult(sim, SPECIES_INDEX.jackal);
    Object.assign(j, { hunger: 0.3, thirst: 0.9, energy: 0, fear: 0, beh: B.Rest, timer: 0 });
    sim.step(0.1);
    expect(GOES_TO_WATER).toContain(j.beh);
  });
});
