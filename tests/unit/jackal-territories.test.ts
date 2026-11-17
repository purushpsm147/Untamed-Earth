import { describe, expect, it } from 'vitest';
import { SPECIES, SPECIES_INDEX, Simulation, maturityDays, type Animal, type Territory } from '@untamed/ecology';
import { LIFE_COMPRESSION } from '@untamed/ecology';

// Gate 2: territorial pair breeding (docs/JACKAL_TERRITORIES.md). Each rule is exercised directly and deterministically.

const J = SPECIES_INDEX.jackal;
const sp = SPECIES[J]!;
const terr = sp.territory!;
const mat = maturityDays(sp);
type Priv = { updateTerritories(): void; receptive(a: Animal, s: typeof sp): boolean };
const priv = (sim: Simulation): Priv => sim as unknown as Priv;
const jackals = (sim: Simulation): Animal[] => sim.animals.filter((a) => a.alive && a.sp === J);

/** A simulation with all founding jackals removed, so a scenario can be built by hand. */
function emptyOfJackals(seed = 5): Simulation {
  const sim = new Simulation(seed);
  for (const a of jackals(sim)) a.alive = false;
  sim.territories.clear();
  return sim;
}
/** Clone an existing jackal as a new individual at (x, z) with the given sex, age (days) and group. */
function place(sim: Simulation, x: number, z: number, sex: 0 | 1, age: number, group: number, mother = 0): Animal {
  const proto = sim.animals.find((a) => a.sp === J)!;
  const a: Animal = { ...proto, id: sim.nextId++, alive: true, x, z, px: x, pz: z, sex, age, group, mother, homeX: x, homeZ: z, hunger: 0.1, thirst: 0.1, health: 1, pregnantH: 0, cooldownH: 0, controlled: false };
  sim.animals.push(a);
  sim.byId.set(a.id, a);
  return a;
}

describe('territorial jackal breeding', () => {
  it('founders claim exclusive territories at least `spacing` apart; only jackals hold territories', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new Simulation(seed);
      for (let i = 0; i < 30 * 720; i++) sim.step(2);
      const t = [...sim.territories.values()];
      expect(t.length).toBeGreaterThan(0);
      for (const x of t) expect(x.sp).toBe(J);
      for (let i = 0; i < t.length; i++) for (let k = i + 1; k < t.length; k++) expect(Math.hypot(t[i]!.x - t[k]!.x, t[i]!.z - t[k]!.z)).toBeGreaterThanOrEqual(terr.spacing - 1e-6);
    }
  });

  it('only the resident female breeds, and only with a resident male', () => {
    const sim = emptyOfJackals();
    const g = sim.nextId++;
    const f = place(sim, 700, 700, 0, mat * 2, g);
    const helper = place(sim, 702, 700, 0, mat * 1.5, g, f.id);
    priv(sim).updateTerritories(); // f claims (founder); no male yet
    const t = sim.territories.get(g)!;
    expect(t.female).toBe(f.id);
    sim.env.timeH = Math.floor(sim.env.timeH / 24) * 24; // breeding season check is seasonal: find one
    const inSeason = (): boolean => (sp.breedSeasons ?? [sim.env.season]).includes(sim.env.season);
    for (let d = 0; d < 48 && !inSeason(); d++) sim.env.timeH += 24;
    expect(priv(sim).receptive(f, sp)).toBe(false); // no resident male
    const m = place(sim, 704, 700, 1, mat * 2, g);
    priv(sim).updateTerritories(); // founder male fills the male slot
    expect(t.male).toBe(m.id);
    expect(priv(sim).receptive(f, sp)).toBe(true);
    expect(priv(sim).receptive(helper, sp)).toBe(false); // a daughter in the group does not breed
  });

  it('a natal adult does not take a slot while a parent still breeds, and inherits once both are gone', () => {
    const sim = emptyOfJackals();
    const g = sim.nextId++;
    const f = place(sim, 700, 700, 0, mat * 3, g);
    const m = place(sim, 702, 700, 1, mat * 3, g);
    priv(sim).updateTerritories();
    const son = place(sim, 701, 701, 1, mat * 1.2, g, f.id);
    m.alive = false; // the father dies
    priv(sim).updateTerritories();
    const t = sim.territories.get(g)!;
    expect(t.male).toBe(0); // the son does not pair with his mother
    expect(son.group).toBe(g); // still a helper (helper period not over)
    f.alive = false; // the mother dies too
    priv(sim).updateTerritories();
    expect(t.male).toBe(son.id); // inheritance
    expect(sim.territoryStats.inherited).toBe(1);
  });

  it('a helper disperses as a floater after the helper period', () => {
    const sim = emptyOfJackals();
    const g = sim.nextId++;
    const f = place(sim, 700, 700, 0, mat * 3, g);
    place(sim, 702, 700, 1, mat * 3, g);
    const young = place(sim, 701, 701, 0, mat + (terr.helperYears * 365) / LIFE_COMPRESSION - 1, g, f.id);
    priv(sim).updateTerritories();
    expect(young.group).toBe(g);
    young.age += 2;
    priv(sim).updateTerritories();
    expect(young.group).not.toBe(g);
    expect(sim.territories.has(young.group)).toBe(false);
    expect(sim.territoryStats.dispersed).toBe(1);
  });

  it('a floater joins a territory missing a breeder of its sex, unless the resident female is its mother', () => {
    const sim = emptyOfJackals();
    const g = sim.nextId++;
    const f = place(sim, 700, 700, 0, mat * 3, g);
    priv(sim).updateTerritories();
    const t: Territory = sim.territories.get(g)!;
    const son = place(sim, 720, 700, 1, mat * 2, sim.nextId++, f.id); // a dispersed son, now a floater nearby
    priv(sim).updateTerritories();
    expect(t.male).toBe(0);
    expect(son.group).not.toBe(g);
    const stranger = place(sim, 730, 700, 1, mat * 2, sim.nextId++);
    priv(sim).updateTerritories();
    expect(t.male).toBe(stranger.id);
    expect(stranger.group).toBe(g);
    expect(sim.territoryStats.joined).toBe(1);
  });

  it('a floater claims only where it is at least `spacing` from every held centre', () => {
    const sim = emptyOfJackals();
    const g = sim.nextId++;
    place(sim, 400, 400, 0, mat * 3, g);
    place(sim, 402, 400, 1, mat * 3, g);
    priv(sim).updateTerritories();
    const near = place(sim, 400 + terr.spacing * 0.7, 400, 0, mat * 2, sim.nextId++);
    priv(sim).updateTerritories();
    expect(sim.territories.has(near.group)).toBe(false); // too close to claim, not inside (> half spacing) to join
    const far = place(sim, 400 + terr.spacing + 10, 400, 1, mat * 2, sim.nextId++);
    if (sim.valley.waterDepth(far.x, far.z, sim.env.stage) < -0.3 && sim.valley.inBounds(far.x, far.z, 60)) {
      priv(sim).updateTerritories();
      expect(sim.territories.has(far.group)).toBe(true);
    }
  });

  it('a territory with no living adult member is vacated', () => {
    const sim = emptyOfJackals();
    const g = sim.nextId++;
    const f = place(sim, 700, 700, 0, mat * 3, g);
    const m = place(sim, 702, 700, 1, mat * 3, g);
    priv(sim).updateTerritories();
    expect(sim.territories.has(g)).toBe(true);
    f.alive = false;
    m.alive = false;
    priv(sim).updateTerritories();
    expect(sim.territories.has(g)).toBe(false);
    expect(sim.territoryStats.vacated).toBe(1);
  });

  it('territories and their statistics survive save/load', () => {
    const sim = new Simulation(2);
    for (let i = 0; i < 20 * 720; i++) sim.step(2);
    const copy = new Simulation(2, sim.snapshot());
    expect([...copy.territories.values()]).toEqual([...sim.territories.values()]);
    expect(copy.territoryStats).toEqual(sim.territoryStats);
    for (let i = 0; i < 720; i++) {
      sim.step(2);
      copy.step(2);
    }
    expect(copy.stateHash()).toBe(sim.stateHash());
  });
});
