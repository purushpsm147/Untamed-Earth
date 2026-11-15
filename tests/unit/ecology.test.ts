import { describe, expect, it } from 'vitest';
import { SPECIES, SPECIES_INDEX, Simulation, TIME_SCALE } from '@untamed/ecology';
import { openEnvelope, sealEnvelope, SaveError } from '@untamed/persistence';
import { REGION_SIZE } from '@untamed/worlds';

const DT = 2;
const TICKS_PER_DAY = (24 * 3600) / TIME_SCALE / DT;
const runDays = (sim: Simulation, days: number): void => {
  for (let i = 0; i < days * TICKS_PER_DAY; i++) sim.step(DT);
};

function checkInvariants(sim: Simulation): void {
  const ids = new Set<number>();
  for (const a of sim.animals) {
    expect(a.alive).toBe(true);
    expect(ids.has(a.id)).toBe(false);
    ids.add(a.id);
    for (const v of [a.x, a.z, a.alt, a.heading, a.health, a.hunger, a.thirst, a.energy, a.stamina, a.fear, a.age]) expect(Number.isFinite(v)).toBe(true);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThanOrEqual(REGION_SIZE);
    expect(a.z).toBeGreaterThanOrEqual(0);
    expect(a.z).toBeLessThanOrEqual(REGION_SIZE);
    for (const v of [a.hunger, a.thirst, a.energy, a.stamina, a.fear]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(a.health).toBeGreaterThan(0);
    expect(a.alt).toBeGreaterThanOrEqual(0);
    if (!SPECIES[a.sp]!.flies) expect(a.alt).toBe(0);
  }
  for (const c of sim.carcasses) expect(c.kg).toBeGreaterThan(0);
}

describe('ecosystem simulation (headless)', () => {
  it('runs 100 in-game days with valid state, a working food web and no runaway populations', () => {
    const sim = new Simulation(1);
    const start = SPECIES.map((_, i) => sim.population(i));
    for (let d = 0; d < 100; d += 10) {
      runDays(sim, 10);
      checkInvariants(sim);
    }
    expect(sim.env.day).toBeGreaterThanOrEqual(134);
    const births = sim.births.reduce((a, b) => a + b, 0);
    const deaths = sim.deaths.flat().reduce((a, b) => a + b, 0);
    // population accounting is exact: nobody appears or vanishes outside births and deaths
    expect(sim.animals.length).toBe(start.reduce((a, b) => a + b, 0) + births - deaths);
    expect(births).toBeGreaterThan(50);
    expect(sim.deaths.reduce((n, row) => n + row[0]!, 0)).toBeGreaterThan(5); // predation happened
    expect(sim.deaths[SPECIES_INDEX.jackal]![0]).toBe(0); // nothing preys on jackals
    for (let i = 0; i < SPECIES.length; i++) expect(sim.population(i)).toBeLessThan(start[i]! * 8 + 40);
    // herbivory removed forage, and the stats history recorded the run
    expect(sim.history.length).toBeGreaterThan(1000);
    expect(sim.history.every((h) => h.veg > 0 && h.veg <= 1.01)).toBe(true);
  });

  it('is reproducible for a fixed seed and differs across seeds', () => {
    const a = new Simulation(5);
    const b = new Simulation(5);
    const c = new Simulation(6);
    runDays(a, 12);
    runDays(b, 12);
    runDays(c, 12);
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.animals.length).toBe(b.animals.length);
    expect(a.stateHash()).not.toBe(c.stateHash());
  });

  it('continues identically after a save/load round trip', () => {
    const a = new Simulation(3);
    runDays(a, 4);
    const env = sealEnvelope({ sim: a.snapshot() }, 'untamed-earth', 1, 0);
    const copy = structuredClone(env);
    const b = new Simulation(3, openEnvelope<{ sim: ReturnType<Simulation['snapshot']> }>(copy, 'untamed-earth', 1).sim);
    expect(b.stateHash()).toBe(a.stateHash());
    runDays(a, 3);
    runDays(b, 3);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(() => openEnvelope({ format: 'other', version: 1, data: {} }, 'untamed-earth', 1)).toThrow(SaveError);
    expect(() => openEnvelope({ format: 'untamed-earth', version: 9, data: {} }, 'untamed-earth', 1)).toThrow(/newer version/);
  });

  it('experiments propagate causally: drought reduces forage and herbivore condition', () => {
    const control = new Simulation(4);
    const drought = new Simulation(4);
    drought.env.params.weatherMode = 'drought';
    runDays(control, 30);
    runDays(drought, 30);
    expect(drought.env.totalVeg).toBeLessThan(control.env.totalVeg * 0.85);
    expect(drought.env.stage).toBeLessThan(control.env.stage);
    const meanHunger = (s: Simulation): number => {
      const h = s.animals.filter((a) => a.sp === SPECIES_INDEX.chital);
      return h.reduce((n, a) => n + a.hunger, 0) / Math.max(1, h.length);
    };
    const stress = (s: Simulation): number => s.deaths.reduce((n, r) => n + r[1]! + r[2]!, 0) + meanHunger(s) * 100;
    expect(stress(drought)).toBeGreaterThan(stress(control));
  });

  it('population levers act on real individuals, and a controlled animal keeps its identity and state', () => {
    const sim = new Simulation(2);
    const before = sim.population(SPECIES_INDEX.hare);
    sim.addAnimals('hare', 10);
    expect(sim.population(SPECIES_INDEX.hare)).toBe(before + 10);
    expect(sim.cull('hare', 4)).toBe(4);
    expect(sim.population(SPECIES_INDEX.hare)).toBe(before + 6);

    const deer = sim.animals.find((a) => a.sp === SPECIES_INDEX.chital)!;
    const { id, age, hunger } = deer;
    sim.setControlled(id);
    sim.control = { mx: 1, mz: 0, run: false, action: null };
    const x0 = deer.x;
    for (let i = 0; i < 50; i++) sim.step(0.1);
    expect(deer.id).toBe(id);
    expect(deer.x).toBeGreaterThan(x0 + 3); // it went where it was steered
    expect(deer.age).toBeGreaterThan(age);
    expect(deer.hunger).toBeGreaterThan(hunger); // metabolism never paused
    sim.control = { mx: 0, mz: 0, run: false, action: 'eat' };
    const h1 = deer.hunger;
    const cell = sim.env.cellIndex(deer.x, deer.z);
    const veg0 = sim.env.veg[cell]!;
    for (let i = 0; i < 600; i++) sim.step(0.1);
    if (veg0 > sim.env.cap[cell]! * 0.2) {
      expect(deer.hunger).toBeLessThan(h1); // grazing fed the deer...
      expect(sim.env.veg[cell]).toBeLessThan(veg0 + 1); // ...out of the cell's finite forage
    }
    sim.setControlled(null);
    expect(deer.controlled).toBe(false);
    expect(sim.byId.get(id)).toBe(deer);
  });
});
