import { describe, expect, it } from 'vitest';
import { B, CHITAL_HIDE_DAYS, SPECIES, SPECIES_INDEX, Simulation, maturityDays, weanDays, type Animal } from '@untamed/ecology';

// Issue #31: maternal instincts and predator-prey encounters, from perception and mother-young relationships.
// Every scenario places real animals (cloned records) on open dry ground; everything after placement is the simulation.

const C = SPECIES_INDEX.chital;
const BO = SPECIES_INDEX.boar;
const J = SPECIES_INDEX.jackal;
type Priv = { decide(a: Animal, sp: unknown): void };
const priv = (s: Simulation): Priv => s as unknown as Priv;

/** A simulation with every animal removed, daytime, so a scene can be built by hand. */
function stage(seed = 5): { sim: Simulation; x: number; z: number } {
  const sim = new Simulation(seed);
  const protos = SPECIES.map((_, i) => sim.animals.find((a) => a.sp === i)!);
  (sim as unknown as { protos: Animal[] }).protos = protos;
  for (const a of sim.animals) a.alive = false;
  sim.territories.clear();
  (sim as unknown as { dead: boolean }).dead = true; // removed by hand: let the next step sweep them as kill() would
  sim.step(0.1);
  sim.env.timeH = Math.floor(sim.env.timeH / 24) * 24 + 12; // midday
  // a dry, open, gentle spot
  for (let z = 300; z < 1100; z += 37) for (let x = 300; x < 1100; x += 37) {
    let ok = true;
    for (let dz = -40; dz <= 40 && ok; dz += 10) for (let dx = -40; dx <= 40 && ok; dx += 10) if (sim.valley.waterDepth(x + dx, z + dz, sim.env.stage) > -0.3 || sim.valley.blocked(x + dx, z + dz, 1)) ok = false;
    if (ok) return { sim, x, z };
  }
  throw new Error('no open spot');
}

function put(sim: Simulation, sp: number, x: number, z: number, o: Partial<Animal> = {}): Animal {
  const proto = (sim as unknown as { protos: Animal[] }).protos[sp]!;
  const a: Animal = { ...proto, id: sim.nextId++, alive: true, x, z, px: x, pz: z, tx: x, tz: z, alt: 0, speed: 0, want: 0, beh: B.Idle, timer: 0.5, hunger: 0.2, thirst: 0.2, health: 1, energy: 0.9, stamina: 1, fear: 0, pregnantH: 0, cooldownH: 0, mother: 0, young: 0, controlled: false, group: sim.nextId++, homeX: x, homeZ: z, off: false, transit: 0, ...o };
  sim.animals.push(a);
  sim.byId.set(a.id, a);
  return a;
}

function mum(sim: Simulation, sp: number, x: number, z: number): Animal {
  return put(sim, sp, x, z, { sex: 0, age: maturityDays(SPECIES[sp]!) * 2 });
}
function child(sim: Simulation, m: Animal, x: number, z: number, age: number): Animal {
  const c = put(sim, m.sp, x, z, { age, mother: m.id, group: m.group, sex: 1 });
  m.young = c.id;
  return c;
}
function jackal(sim: Simulation, x: number, z: number, o: Partial<Animal> = {}): Animal {
  return put(sim, J, x, z, { age: maturityDays(SPECIES[J]!) * 2, hunger: 0.7, ...o });
}
function run(sim: Simulation, seconds: number, dt = 0.25, each?: () => void): void {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    each?.();
    sim.step(dt);
  }
}

describe('jackal prey selection (perception-based)', () => {
  it('a healthy adult chital or adult boar is not a target; a small young is; a weak adult chital is', () => {
    const { sim, x, z } = stage();
    const j = jackal(sim, x, z);
    const adultC = put(sim, C, x + 20, z, { age: maturityDays(SPECIES[C]!) * 2 });
    const adultB = put(sim, BO, x + 20, z + 5, { age: maturityDays(SPECIES[BO]!) * 2 });
    const m = mum(sim, C, x + 60, z);
    const fawn = child(sim, m, x + 61, z, 2);
    const weak = put(sim, C, x + 25, z, { age: maturityDays(SPECIES[C]!) * 2, health: 0.3 });
    const v = (o: Animal): number => sim.preyValue(j, SPECIES[J]!, o, SPECIES[o.sp]!);
    expect(v(adultC)).toBe(0);
    expect(v(adultB)).toBe(0);
    expect(v(fawn)).toBeGreaterThan(0);
    expect(v(weak)).toBeGreaterThan(0);
  });

  it('young far from the mother are a better prospect than young beside her; a piglet beside its sow is a poor one', () => {
    const { sim, x, z } = stage();
    const j = jackal(sim, x, z);
    const m1 = mum(sim, C, x + 30, z);
    const near = child(sim, m1, x + 32, z, 3);
    const m2 = mum(sim, C, x + 30, z + 200);
    const far = child(sim, m2, x + 30, z + 140, 3);
    const sow = mum(sim, BO, x - 30, z);
    const piglet = child(sim, sow, x - 31, z, 3);
    const v = (o: Animal): number => sim.preyValue(j, SPECIES[J]!, o, SPECIES[o.sp]!);
    expect(v(far)).toBeGreaterThan(v(near));
    expect(v(piglet)).toBeLessThan(v(near));
  });
});

describe('chital mother and fawn', () => {
  it('a mobile fawn settles beside its resting mother and gets up to follow when she moves off', () => {
    const { sim, x, z } = stage();
    const m = mum(sim, C, x, z);
    const f = child(sim, m, x + 3, z, CHITAL_HIDE_DAYS + 3);
    Object.assign(m, { beh: B.Rest, timer: 1e9, energy: 0.3 });
    run(sim, 20, 0.25, () => Object.assign(m, { beh: B.Rest, timer: 1e9, want: 0, tx: m.x, tz: m.z }));
    expect(f.beh).toBe(B.Rest);
    // she gets up and walks away
    run(sim, 30, 0.25, () => Object.assign(m, { beh: B.Wander, timer: 1e9, tx: x + 60, tz: z, want: SPECIES[C]!.walk }));
    expect(f.beh).toBe(B.Follow);
    expect(Math.hypot(f.x - m.x, f.z - m.z)).toBeLessThan(15);
  });

  it('a newborn hider lies hidden while the mother is away, freezes at a distant jackal and bolts when it is close', () => {
    const { sim, x, z } = stage();
    const m = mum(sim, C, x + 80, z);
    const f = child(sim, m, x, z, 0.3);
    run(sim, 8, 0.25, () => Object.assign(m, { beh: B.Forage, timer: 1e9, tx: m.x, tz: m.z }));
    expect(f.beh).toBe(B.Hide);
    // a jackal passes at 15 m: the fawn stays frozen
    const j = jackal(sim, x + 15, z, { hunger: 0.1, beh: B.Wander, timer: 1e9, tx: x + 15, tz: z + 200, want: 1.7 });
    run(sim, 6, 0.25, () => Object.assign(m, { beh: B.Forage, timer: 1e9, tx: m.x, tz: m.z }));
    expect(f.beh).toBe(B.Hide);
    // the jackal is almost on it: it bolts
    Object.assign(j, { x: x + 3, z, px: x + 3, pz: z });
    let fled = false;
    run(sim, 6, 0.25, () => { Object.assign(m, { beh: B.Forage, timer: 1e9, tx: m.x, tz: m.z }); fled ||= f.beh === B.Flee; });
    expect(fled).toBe(true);
  });

  it('a hidden newborn is found only at close range', () => {
    const { sim, x, z } = stage();
    const m = mum(sim, C, x + 150, z);
    const f = child(sim, m, x, z, 0.3);
    f.beh = B.Hide;
    const j = jackal(sim, x + 40, z);
    const d = sim as unknown as { detectable(a: Animal, o: Animal, d2: number): boolean };
    expect(d.detectable(j, f, 40 * 40)).toBe(false);
    expect(d.detectable(j, f, 8 * 8)).toBe(true);
  });

  it('a mother that sees a jackal near her fawn steps between them and holds; the fawn is alerted', () => {
    const { sim, x, z } = stage();
    const m = mum(sim, C, x - 12, z);
    const f = child(sim, m, x, z, CHITAL_HIDE_DAYS + 4);
    const j = jackal(sim, x + 14, z, { beh: B.Idle, timer: 1e9, hunger: 0.1 });
    let defended = false;
    run(sim, 12, 0.25, () => { Object.assign(j, { beh: B.Idle, timer: 1e9, want: 0 }); defended ||= m.beh === B.Defend; });
    expect(defended).toBe(true);
    expect(sim.interactions.defends).toBeGreaterThanOrEqual(1);
    // she ends up on the jackal's side of the fawn
    expect(m.x).toBeGreaterThan(f.x - 1);
    expect(f.fear).toBeGreaterThan(0);
  });

  it('protection does not guarantee survival: a very hungry jackal is not turned back by a chital mother', () => {
    const { sim, x, z } = stage();
    const m = mum(sim, C, x, z);
    const f = child(sim, m, x + 2, z, CHITAL_HIDE_DAYS + 4);
    const j = jackal(sim, x + 6, z, { hunger: 0.95, beh: B.Chase, targetId: f.id, timer: 1e9 });
    Object.assign(m, { beh: B.Defend, targetId: j.id, timer: 1e9 });
    const before = sim.interactions.huntsAbandoned;
    sim.step(0.25);
    expect(sim.interactions.huntsAbandoned).toBe(before);
    // a moderately hungry one gives up
    const { sim: s2, x: x2, z: z2 } = stage();
    const m2 = mum(s2, C, x2, z2);
    const f2 = child(s2, m2, x2 + 2, z2, CHITAL_HIDE_DAYS + 4);
    const j2 = jackal(s2, x2 + 6, z2, { hunger: 0.5, beh: B.Chase, targetId: f2.id, timer: 1e9 });
    Object.assign(m2, { beh: B.Defend, targetId: j2.id, timer: 1e9 });
    s2.step(0.25);
    expect(s2.interactions.huntsAbandoned).toBe(1);
    expect(j2.beh).toBe(B.Flee);
  });
});

describe('wild boar sow and piglets', () => {
  it('a sow defends her piglets against a jackal and drives it off (it withdraws: it is faster than her)', () => {
    const { sim, x, z } = stage();
    const sow = mum(sim, BO, x - 8, z);
    child(sim, sow, x, z, 3);
    const j = jackal(sim, x + 12, z, { beh: B.Idle, timer: 1e9, hunger: 0.1 });
    let charged = false;
    let fled = false;
    run(sim, 15, 0.25, () => { if (j.beh !== B.Flee) Object.assign(j, { beh: B.Idle, timer: 1e9, want: 0 }); charged ||= sow.beh === B.Defend; fled ||= j.beh === B.Flee; });
    expect(charged).toBe(true);
    expect(fled).toBe(true);
    expect(sim.interactions.defends).toBeGreaterThanOrEqual(1);
  });

  it('a charge that reaches the jackal drives it off and counts the contact (injury on half of contacts)', () => {
    const { sim, x, z } = stage();
    const sow = mum(sim, BO, x, z);
    child(sim, sow, x - 3, z, 3);
    const j = jackal(sim, x + 1.2, z, { beh: B.Stalk, timer: 1e9 });
    Object.assign(sow, { beh: B.Defend, targetId: j.id, timer: 1e9 });
    sim.step(0.1);
    expect(sim.interactions.chargeContacts).toBe(1);
    expect(j.beh).toBe(B.Flee);
    expect(sim.interactions.jackalInjuries).toBeLessThanOrEqual(1);
  });

  it('a jackal hunting a piglet abandons the hunt when the sow confronts it', () => {
    const { sim, x, z } = stage();
    const sow = mum(sim, BO, x, z);
    const pig = child(sim, sow, x + 2, z, 3);
    const j = jackal(sim, x + 10, z, { hunger: 0.95, beh: B.Stalk, targetId: pig.id, timer: 1e9 });
    Object.assign(sow, { beh: B.Defend, targetId: j.id, timer: 1e9 });
    sim.step(0.25);
    expect(sim.interactions.huntsAbandoned).toBe(1);
    expect(j.beh).toBe(B.Flee);
  });

  it('an unrelated adult boar has no maternal ability: it does not defend someone else’s piglet', () => {
    const { sim, x, z } = stage();
    const sow = mum(sim, BO, x + 300, z);
    const pig = child(sim, sow, x, z, 3);
    const other = put(sim, BO, x - 6, z, { sex: 1, age: maturityDays(SPECIES[BO]!) * 2 });
    jackal(sim, x + 10, z, { beh: B.Idle, timer: 1e9, hunger: 0.1 });
    run(sim, 8);
    expect(other.beh).not.toBe(B.Defend);
    void pig;
  });
});

describe('jackal awareness', () => {
  it('watches an adult chital walking toward it (also when the chital is player-controlled)', () => {
    for (const controlled of [false, true]) {
      const { sim, x, z } = stage();
      const j = jackal(sim, x, z, { hunger: 0.1 });
      const c = put(sim, C, x + 22, z, { age: maturityDays(SPECIES[C]!) * 2 });
      if (controlled) sim.setControlled(c.id);
      let alert = false;
      run(sim, 10, 0.25, () => {
        if (controlled) sim.control = { mx: -1, mz: 0, run: false, action: null };
        else Object.assign(c, { beh: B.Wander, timer: 1e9, tx: x - 50, tz: z, want: SPECIES[C]!.walk });
        alert ||= j.beh === B.Alert;
      });
      expect(alert).toBe(true);
    }
  });

  it('withdraws from an adult boar at close range', () => {
    const { sim, x, z } = stage();
    const j = jackal(sim, x, z, { hunger: 0.1 });
    put(sim, BO, x + 8, z, { age: maturityDays(SPECIES[BO]!) * 2, beh: B.Idle, timer: 1e9 });
    let fled = false;
    run(sim, 6, 0.25, () => { fled ||= j.beh === B.Flee; });
    expect(fled).toBe(true);
    expect(sim.interactions.withdrawals).toBeGreaterThanOrEqual(1);
  });

  it('a satiated jackal does not start hunting a fawn; a hungry one does', () => {
    for (const [hunger, expectHunt] of [[0.1, false], [0.9, true]] as const) {
      const { sim, x, z } = stage();
      const m = mum(sim, C, x + 200, z);
      const f = child(sim, m, x + 30, z, CHITAL_HIDE_DAYS + 3);
      Object.assign(f, { beh: B.Idle, timer: 1e9 });
      const j = jackal(sim, x, z, { hunger });
      let hunted = false;
      run(sim, 10, 0.25, () => { Object.assign(f, { beh: B.Idle, timer: 1e9, want: 0 }); hunted ||= (j.beh === B.Stalk || j.beh === B.Chase) && j.targetId === f.id; });
      expect(hunted).toBe(expectHunt);
    }
  });
});

describe('player-controlled mother and persistence', () => {
  it('a player-controlled chital mother can defend her fawn with the contextual action; the fawn stays autonomous', () => {
    const { sim, x, z } = stage();
    const m = mum(sim, C, x - 10, z);
    const f = child(sim, m, x, z, CHITAL_HIDE_DAYS + 4);
    jackal(sim, x + 15, z, { beh: B.Idle, timer: 1e9, hunger: 0.1 });
    sim.setControlled(m.id);
    run(sim, 1);
    expect(sim.youngThreat(m)).not.toBeNull();
    sim.control = { mx: 0, mz: 0, run: false, action: 'defend' };
    run(sim, 2);
    expect(m.beh).toBe(B.Defend);
    expect(f.controlled).toBe(false);
  });

  it('defence and hiding state survive save/load with an identical continuation', () => {
    const { sim, x, z } = stage();
    const m = mum(sim, C, x - 12, z);
    child(sim, m, x, z, CHITAL_HIDE_DAYS + 4);
    jackal(sim, x + 14, z, { hunger: 0.1 });
    const h = mum(sim, C, x + 200, z + 40);
    child(sim, h, x + 120, z + 40, 0.2);
    run(sim, 6);
    const copy = new Simulation(5, structuredClone(sim.snapshot()));
    expect(copy.interactions).toEqual(sim.interactions);
    for (let i = 0; i < 200; i++) {
      sim.step(0.25);
      copy.step(0.25);
    }
    expect(copy.stateHash()).toBe(sim.stateHash());
    void weanDays;
    void priv;
  });
});
