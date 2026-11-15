import { describe, expect, it } from 'vitest';
import { Animal, B, SPECIES, SPECIES_INDEX, Simulation, maturityDays } from '@untamed/ecology';

const adult = (sim: Simulation, sp: number): Animal => sim.animals.find((a) => a.sp === sp && a.alive && a.age > maturityDays(SPECIES[sp]!) * 1.1)!;
/** Freeze an animal's motivation so only steering is exercised: no needs, no fear, no re-decisions. */
const pin = (a: Animal, beh: number, tx: number, tz: number): void => {
  Object.assign(a, { hunger: 0, thirst: 0, energy: 1, fear: 0, timer: 1e9, beh, tx, tz, stuck: 0, chkT: 0 });
};

describe('navigation: steering, termination, obstacles', () => {
  it('walks around a ruin to a destination on its far side, never entering it, by a reasonable path', () => {
    const sim = new Simulation(1);
    const v = sim.valley;
    // a large rectangular building; start and goal 25 m either side of it along its long axis normal
    const b = v.buildings.filter((x) => x.kind !== 'tower' && x.w > 8).sort((p, q) => q.w * q.d - p.w * p.d)[0]!;
    const nx = Math.sin(b.rot);
    const nz = Math.cos(b.rot);
    const start = { x: b.x - nx * 25, z: b.z - nz * 25 };
    const goal = { x: b.x + nx * 25, z: b.z + nz * 25 };
    expect(v.blocked(start.x, start.z, 1)).toBe(false);
    expect(v.blocked(goal.x, goal.z, 1)).toBe(false);
    const deer = adult(sim, SPECIES_INDEX.chital);
    Object.assign(deer, { x: start.x, z: start.z, px: start.x, pz: start.z, heading: Math.atan2(nx, nz), speed: 0 });
    pin(deer, B.Wander, goal.x, goal.z);
    let path = 0;
    let arrived = -1;
    for (let i = 0; i < 1200 && arrived < 0; i++) {
      const px = deer.x;
      const pz = deer.z;
      pin(deer, B.Wander, goal.x, goal.z);
      sim.step(0.1);
      path += Math.hypot(deer.x - px, deer.z - pz);
      expect(v.blocked(deer.x, deer.z, 0), `inside the building at tick ${i}`).toBe(false);
      if (Math.hypot(deer.x - goal.x, deer.z - goal.z) < 2) arrived = i;
    }
    expect(arrived, 'reached the far side within 120 s').toBeGreaterThan(0);
    expect(path / 50).toBeLessThan(2.2); // a detour, not a wander
  });

  it('turns and accelerates within physical limits: no instant swivels or 0-to-sprint in one tick', () => {
    const sim = new Simulation(4);
    const last = new Map<number, { h: number; s: number }>();
    let worstTurn = 0;
    let worstAccel = 0;
    for (let t = 0; t < 7200; t++) {
      sim.step(0.1);
      for (const a of sim.animals) {
        const sp = SPECIES[a.sp]!;
        if (sp.flies || a.controlled) continue;
        const p = last.get(a.id);
        if (p) {
          let dh = Math.abs(a.heading - p.h) % (Math.PI * 2);
          if (dh > Math.PI) dh = Math.PI * 2 - dh;
          worstTurn = Math.max(worstTurn, dh);
          worstAccel = Math.max(worstAccel, (a.speed - p.s) / 0.1); // speeding up; stopping at an obstacle may be abrupt
        }
        last.set(a.id, { h: a.heading, s: a.speed });
      }
    }
    expect(worstTurn).toBeLessThanOrEqual(1.6 * 4.5 * 0.1 + 1e-6); // most agile species pivoting at walking pace
    expect(worstAccel).toBeLessThanOrEqual(9 + 1e-6); // hare-class acceleration, m/s^2
  });

  it('keeps ground animals off cliffs and jackals out of deep water', () => {
    const sim = new Simulation(9);
    let moves = 0;
    let cliffs = 0;
    let jackal = 0;
    let wet = 0;
    const last = new Map<number, { x: number; z: number }>();
    for (let t = 0; t < 7200; t++) {
      sim.step(0.1);
      for (const a of sim.animals) {
        if (SPECIES[a.sp]!.flies) continue;
        const p = last.get(a.id);
        if (p) {
          const d = Math.hypot(a.x - p.x, a.z - p.z);
          if (d > 0.05) {
            moves++;
            if ((sim.valley.heightFast(a.x, a.z) - sim.valley.heightFast(p.x, p.z)) / d > 1.5) cliffs++;
          }
        }
        last.set(a.id, { x: a.x, z: a.z });
        if (a.sp === SPECIES_INDEX.jackal) {
          jackal++;
          if (sim.valley.waterDepth(a.x, a.z, sim.env.stage) > 0.45) wet++;
        }
      }
    }
    expect(cliffs / moves).toBeLessThan(0.001);
    expect(wet / jackal).toBeLessThan(0.03); // was 7.4% on this seed before look-ahead steering
  });

  it('abandons an unreachable destination instead of pressing against it forever', () => {
    const sim = new Simulation(1);
    const hare = adult(sim, SPECIES_INDEX.hare);
    // put the hare on the bank and its goal in the middle of the river (hares cannot enter deep water)
    const z = 640;
    const rx = sim.valley.riverX(z);
    let bank = rx + 30;
    while (sim.valley.waterDepth(bank, z, sim.env.stage) > -0.2) bank += 2;
    Object.assign(hare, { x: bank, z, px: bank, pz: z, speed: 0 });
    Object.assign(hare, { hunger: 0, thirst: 0, energy: 1, fear: 0, timer: 1e9, beh: B.Wander, tx: rx, tz: z });
    let gaveUp = -1;
    for (let i = 0; i < 600 && gaveUp < 0; i++) {
      sim.step(0.1);
      expect(sim.valley.waterDepth(hare.x, hare.z, sim.env.stage)).toBeLessThan(0.31);
      if (hare.beh !== B.Wander) gaveUp = i;
    }
    expect(gaveUp, 'gave up within 60 s').toBeGreaterThan(0);
  });

  it('save and reload mid-movement continues identically (new steering state persists)', () => {
    const a = new Simulation(6);
    for (let i = 0; i < 900; i++) a.step(0.1);
    const b = new Simulation(6, structuredClone(a.snapshot()));
    for (let i = 0; i < 900; i++) {
      a.step(0.1);
      b.step(0.1);
    }
    expect(b.stateHash()).toBe(a.stateHash());
    // saves made before the steering fields existed still load
    const snap = structuredClone(a.snapshot());
    for (const x of snap.animals as unknown as Record<string, unknown>[]) for (const k of ['want', 'steer', 'chkT', 'chkD', 'stuck', 'cx', 'cz', 'ctx', 'ctz', 'bestD']) delete x[k];
    const c = new Simulation(6, snap);
    for (let i = 0; i < 300; i++) c.step(0.1);
    expect(c.animals.every((x) => Number.isFinite(x.x + x.z + x.speed))).toBe(true);
  });
});

describe('chital herd threat response', () => {
  it('a jackal close to one deer alarms the herd; herd mates flee too, then the herd re-forms', () => {
    const sim = new Simulation(1);
    // the largest chital herd
    const groups = new Map<number, Animal[]>();
    for (const a of sim.animals) if (a.sp === SPECIES_INDEX.chital) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
    const herd = [...groups.values()].sort((p, q) => q.length - p.length)[0]!.filter((a) => a.age > maturityDays(SPECIES[0]!) * 0.5);
    expect(herd.length).toBeGreaterThanOrEqual(5);
    // gather the herd loosely on open ground and let it settle
    const cx = 800;
    const cz = 660;
    herd.forEach((a, i) => {
      const ang = (i / herd.length) * Math.PI * 2;
      Object.assign(a, { x: cx + Math.cos(ang) * 8, z: cz + Math.sin(ang) * 8, px: cx, pz: cz, homeX: cx, homeZ: cz, fear: 0, hunger: 0.1, thirst: 0.1, energy: 1, beh: B.Idle, timer: 0 });
    });
    const spread = (): number => {
      const gx = herd.reduce((s, a) => s + a.x, 0) / herd.length;
      const gz = herd.reduce((s, a) => s + a.z, 0) / herd.length;
      return herd.reduce((s, a) => s + Math.hypot(a.x - gx, a.z - gz), 0) / herd.length;
    };
    for (let i = 0; i < 100; i++) sim.step(0.1);
    const before = spread();
    // a jackal appears beside one deer (resting, so the deer react to presence, not to an attack)
    const victim = herd[0]!;
    const jackal = adult(sim, SPECIES_INDEX.jackal);
    let alarms = 0;
    const off = sim.events.on((e) => {
      if (e.type === 'alarm' && e.sp === SPECIES_INDEX.chital) alarms++;
    });
    Object.assign(jackal, { x: victim.x + 7, z: victim.z, px: victim.x + 7, pz: victim.z, hunger: 0, beh: B.Rest, timer: 1e9, speed: 0, want: 0 });
    const fled = new Set<number>();
    for (let i = 0; i < 150; i++) {
      jackal.timer = 1e9;
      sim.step(0.1);
      for (const a of herd) if (a.alive && a.beh === B.Flee) fled.add(a.id);
    }
    expect(alarms).toBeGreaterThan(0);
    expect(fled.size, `herd members that fled out of ${herd.length}`).toBeGreaterThanOrEqual(Math.ceil(herd.length / 2));
    // the jackal leaves; the herd should come back together within ten minutes
    Object.assign(jackal, { x: 200, z: 1300, px: 200, pz: 1300 });
    let regrouped = false;
    let worst = 0;
    for (let i = 0; i < 6000; i++) {
      sim.step(0.1);
      if (herd.some((a) => a.alive && a.beh === B.Regroup)) regrouped = true;
      if (i === 200) worst = spread();
    }
    off();
    const after = spread();
    expect(regrouped).toBe(true);
    expect(worst).toBeGreaterThan(before); // the flight did scatter them
    expect(after).toBeLessThan(Math.max(before * 2, 25)); // and they gathered again
  });
});
