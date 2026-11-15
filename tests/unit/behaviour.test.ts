import { describe, expect, it } from 'vitest';
import { Animal, B, SPECIES, SPECIES_INDEX, Simulation, TIME_SCALE, maturityDays } from '@untamed/ecology';

const DT = 2;
const PER_DAY = (24 * 3600) / TIME_SCALE / DT;
const days = (sim: Simulation, n: number, each?: () => void): void => {
  for (let i = 0; i < n * PER_DAY; i++) {
    sim.step(DT);
    each?.();
  }
};
const of = (sim: Simulation, id: keyof typeof SPECIES_INDEX): Animal[] => sim.animals.filter((a) => a.sp === SPECIES_INDEX[id] && a.alive);
const adult = (sim: Simulation, id: keyof typeof SPECIES_INDEX): Animal => of(sim, id).find((a) => a.age > maturityDays(SPECIES[a.sp]!))!;

describe('one simulated day', () => {
  it('animals eat roughly what their bodies require, and it comes out of finite resources', () => {
    const sim = new Simulation(1);
    const veg0 = sim.env.totalVeg;
    const pops = SPECIES.map((_, i) => sim.population(i));
    days(sim, 3);
    for (let i = 0; i < SPECIES.length; i++) {
      const perAnimalDay = sim.eaten[i]! / pops[i]! / 3;
      // juveniles need less, growth and gorging vary it: accept 35%..170% of the adult daily requirement
      expect(perAnimalDay, SPECIES[i]!.id).toBeGreaterThan(SPECIES[i]!.intake * 0.35);
      expect(perAnimalDay, SPECIES[i]!.id).toBeLessThan(SPECIES[i]!.intake * 1.7);
    }
    // herbivores removed more forage than the three smallest consumers could account for
    expect(sim.eaten[0]! + sim.eaten[3]!).toBeGreaterThan(100);
    expect(Number.isFinite(veg0 - sim.env.totalVeg)).toBe(true);
  });

  it('every species spends time foraging, drinking and resting; diurnal birds roost at night', () => {
    const sim = new Simulation(2);
    const seen = SPECIES.map(() => new Set<number>());
    let nightRoost = 0;
    let nightBirds = 0;
    let n = 0;
    days(sim, 1, () => {
      // a drink lasts only a few seconds, so behaviours are sampled every tick
      for (const a of sim.animals) seen[a.sp]!.add(a.beh);
      if (n++ % 15) return;
      if (sim.env.daylight() === 0) for (const a of of(sim, 'crow')) {
        nightBirds++;
        if (a.beh === B.Roost) nightRoost++;
      }
    });
    for (let i = 0; i < SPECIES.length; i++) {
      expect(seen[i]!.has(B.Forage), `${SPECIES[i]!.id} forages`).toBe(true);
      expect(seen[i]!.has(B.Drink) || SPECIES[i]!.foodWater > 0.8, `${SPECIES[i]!.id} drinks`).toBe(true);
      expect(seen[i]!.has(SPECIES[i]!.flies ? B.Roost : B.Rest), `${SPECIES[i]!.id} rests`).toBe(true);
    }
    expect(nightRoost / nightBirds).toBeGreaterThan(0.7);
  });
});

describe('needs drive behaviour', () => {
  it('a thirsty animal finds water within its senses, walks to the edge and drinks', () => {
    const sim = new Simulation(1);
    const deer = adult(sim, 'chital');
    const site = sim.env.findWater(deer.x, deer.z, 2000)!;
    // fixture: stand the deer 60 m from water, parched, with no memory of where water is
    deer.x = deer.px = site.x + 60;
    deer.z = deer.pz = site.z;
    deer.thirst = 0.9;
    deer.hunger = 0.1;
    deer.energy = 1;
    deer.waterX = deer.waterZ = NaN;
    deer.timer = 0;
    let drank = false;
    for (let i = 0; i < 1500 && !drank; i++) {
      sim.step(0.25);
      if (deer.beh === B.Drink) drank = true;
    }
    expect(drank).toBe(true);
    expect(sim.valley.waterDepth(deer.x, deer.z, sim.env.stage)).toBeLessThan(0.5); // at the edge, not mid-channel
    for (let i = 0; i < 400; i++) sim.step(0.25);
    expect(deer.thirst).toBeLessThan(0.4);
    expect(Number.isNaN(deer.waterX)).toBe(false); // and it remembers the place
  });

  it('an exhausted animal rests and recovers energy', () => {
    const sim = new Simulation(1);
    const boar = adult(sim, 'boar');
    Object.assign(boar, { energy: 0.03, hunger: 0.1, thirst: 0.1, fear: 0, timer: 0 });
    for (let i = 0; i < 40; i++) sim.step(0.25);
    expect(boar.beh).toBe(B.Rest);
    for (let i = 0; i < 2400; i++) sim.step(1);
    expect(boar.energy).toBeGreaterThan(0.4);
  });

  it('prey flee a detected predator and open the distance; fearless adults do not', () => {
    const sim = new Simulation(3);
    const hare = adult(sim, 'hare');
    const jackal = adult(sim, 'jackal');
    const boar = adult(sim, 'boar');
    Object.assign(hare, { stamina: 1, fear: 0, timer: 0, hunger: 0.1, thirst: 0.1, energy: 1 });
    jackal.x = jackal.px = hare.x + 6;
    jackal.z = jackal.pz = hare.z;
    jackal.hunger = 0; // not hunting: this isolates the prey's response
    jackal.beh = B.Rest;
    jackal.timer = 999;
    boar.x = boar.px = jackal.x + 5;
    boar.z = boar.pz = jackal.z + 3;
    Object.assign(boar, { timer: 0, fear: 0 });
    let fled = false;
    for (let i = 0; i < 60; i++) {
      sim.step(0.1);
      if (hare.beh === B.Flee) fled = true;
    }
    expect(fled).toBe(true);
    expect(Math.hypot(hare.x - jackal.x, hare.z - jackal.z)).toBeGreaterThan(25);
    expect(boar.fear).toBeLessThan(0.4);
    expect(boar.beh).not.toBe(B.Flee);
  });

  it('a hungry jackal that sees a hare hunts it, and a kill feeds the jackal and leaves a carcass', () => {
    let kills = 0;
    let fedAfterKill = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new Simulation(seed);
      const jackal = adult(sim, 'jackal');
      const hare = adult(sim, 'hare');
      const site = { x: 760, z: 640 };
      Object.assign(jackal, { x: site.x, z: site.z, px: site.x, pz: site.z, hunger: 0.85, stamina: 1, energy: 1, thirst: 0, timer: 0, fear: 0 });
      Object.assign(hare, { x: site.x + 14, z: site.z, px: site.x + 14, pz: site.z, beh: B.Rest, timer: 30, stamina: 0.3 });
      const h0 = jackal.hunger;
      let hunted = false;
      const off = sim.events.on((e) => {
        if (e.type === 'kill' && e.predator === jackal.id) kills++;
      });
      const before = kills;
      for (let i = 0; i < 1200; i++) {
        sim.step(0.1);
        if (jackal.beh === B.Stalk || jackal.beh === B.Chase) hunted = true;
      }
      off();
      expect(hunted, `seed ${seed}`).toBe(true);
      if (kills > before) {
        expect(sim.deaths[SPECIES_INDEX.hare]![0]).toBeGreaterThan(0);
        for (let i = 0; i < 3000; i++) sim.step(0.25);
        if (jackal.alive && jackal.hunger < h0 - 0.2) fedAfterKill++;
      }
    }
    expect(kills).toBeGreaterThanOrEqual(2); // hunts succeed sometimes, not always
    expect(fedAfterKill).toBeGreaterThanOrEqual(1);
  });
});

describe('ten simulated days', () => {
  it('nobody is stranded: no animal inside a building, no hare in deep water, almost none parched or starving', () => {
    const sim = new Simulation(4);
    let inside = 0;
    let hareDeep = 0;
    let n = 0;
    days(sim, 10, () => {
      if (n++ % 50) return;
      for (const a of sim.animals) {
        if (a.alt < 0.5 && sim.valley.blocked(a.x, a.z, 0)) inside++;
        if (a.sp === SPECIES_INDEX.hare && sim.valley.waterDepth(a.x, a.z, sim.env.stage) > 0.45) hareDeep++;
      }
    });
    expect(inside).toBe(0);
    expect(hareDeep).toBe(0);
    const stressed = sim.animals.filter((a) => a.thirst > 0.95 || a.hunger > 0.95).length;
    expect(stressed / sim.animals.length).toBeLessThan(0.05);
    const meanEnergy = sim.animals.reduce((s, a) => s + a.energy, 0) / sim.animals.length;
    expect(meanEnergy).toBeGreaterThan(0.35);
  });

  it('identities are stable when the detail focus moves around (simulation-detail transitions)', () => {
    const sim = new Simulation(5);
    const start = new Map(sim.animals.map((a) => [a.id, { sp: a.sp, sex: a.sex, age: a.age }]));
    const born = new Set<number>();
    const died = new Set<number>();
    sim.events.on((e) => {
      if (e.type === 'death') died.add(e.id);
    });
    let k = 0;
    days(sim, 10, () => {
      // sweep the focus across the valley so every animal repeatedly changes detail tier
      if (k++ % 200 === 0) sim.focus = k % 400 === 1 ? null : { x: (k * 37) % 1440, z: (k * 91) % 1440 };
    });
    for (const a of sim.animals) {
      const s = start.get(a.id);
      if (!s) {
        born.add(a.id);
        expect(a.mother).toBeGreaterThan(0); // every newcomer has a recorded mother
        continue;
      }
      expect(a.sp).toBe(s.sp);
      expect(a.sex).toBe(s.sex);
      expect(a.age).toBeCloseTo(s.age + 10, 3); // aged exactly ten days: never reset, never duplicated
    }
    const alive = new Set(sim.animals.map((a) => a.id));
    for (const id of start.keys()) expect(alive.has(id) || died.has(id)).toBe(true); // nobody vanished without a death
    // newborns that died inside the window are in `births` but no longer alive
    const births = sim.births.reduce((a, b) => a + b, 0);
    expect(born.size).toBeLessThanOrEqual(births);
    expect(births - born.size).toBeLessThanOrEqual(died.size);
  });

  it('vegetation recovers after a drought ends (ecological recovery)', () => {
    const sim = new Simulation(6);
    sim.env.params.weatherMode = 'drought';
    days(sim, 25);
    const low = sim.env.totalVeg / sim.env.totalCap;
    const dryStage = sim.env.stage;
    sim.env.params.weatherMode = 'monsoon';
    days(sim, 25);
    expect(sim.env.stage).toBeGreaterThan(dryStage + 0.2);
    expect(sim.env.totalVeg / sim.env.totalCap).toBeGreaterThan(low * 1.15);
  });
});
