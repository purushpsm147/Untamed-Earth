import { describe, expect, it } from 'vitest';
import { B, FAILED_TARGET_HOURS, SPECIES, SPECIES_INDEX, Simulation, maturityDays, type Animal } from '@untamed/ecology';

// Mission 3, first step: a destination given up on as unreachable is remembered (two decaying slots per animal) and not
// chosen again until the memory expires (docs/BEHAVIOUR_AUDIT.md, finding 9: jackals re-chose an unreachable carcass
// 10-32 times per day).

function adult(sim: Simulation, sp: number): Animal {
  return sim.animals.find((a) => a.sp === sp && a.alive && a.mother === 0 && a.age > maturityDays(SPECIES[a.sp]!))!;
}

/** A carcass inside a ruin's walls: perceivable, never reachable on foot. */
function unreachableCarcass(sim: Simulation, j: Animal): number {
  const b = sim.valley.buildings.find((x) => Math.hypot(x.x - j.x, x.z - j.z) < 400) ?? sim.valley.buildings[0]!;
  const id = sim.nextId++;
  sim.carcasses.push({ id, x: b.x, z: b.z, kg: 50, sp: SPECIES_INDEX.chital });
  // put the jackal 25 m from the ruin, within smell range
  j.x = j.px = b.x + 25 + (b.w + b.d) * 0.5;
  j.z = j.pz = b.z;
  return id;
}

describe('failed-target memory', () => {
  it('a jackal gives up on an unreachable carcass and does not choose it again while the memory lasts', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    const cid = unreachableCarcass(sim, j);
    sim.env.timeH = (Math.floor(sim.env.timeH / 24) + 1) * 24 + 20; // dusk: crepuscular jackal active
    Object.assign(j, { hunger: 0.9, thirst: 0, fear: 0, energy: 1, beh: B.Idle, timer: 0 });
    let gaveUpAt = -1;
    let retargets = 0;
    const ticks = Math.round((FAILED_TARGET_HOURS * 0.9 * 3600) / 60 / 0.5); // most of the memory span, 0.5 s ticks
    for (let i = 0; i < ticks; i++) {
      const before = j.beh === B.SeekCarrion && j.targetId === cid;
      sim.step(0.5);
      j.hunger = 0.9; // keep it hungry: the carcass stays attractive
      j.thirst = 0;
      const now = j.beh === B.SeekCarrion && j.targetId === cid;
      const exists = sim.carcasses.some((c) => c.id === cid && c.kg > 0.05);
      if (gaveUpAt < 0 && before && !now && exists && j.beh !== B.Feed) gaveUpAt = i;
      else if (gaveUpAt >= 0 && !before && now) retargets++;
    }
    expect(gaveUpAt).toBeGreaterThanOrEqual(0); // it tried, and gave up
    expect(retargets).toBe(0); // and did not go back while the memory lasted
  });

  it('the memory decays: after FAILED_TARGET_HOURS the place may be chosen again', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    const t0 = sim.env.timeH;
    (sim as unknown as { rememberFailure(a: Animal, x: number, z: number): void }).rememberFailure(j, 100, 200);
    expect(sim.recentlyFailed(j, 103, 202)).toBe(true);
    expect(sim.recentlyFailed(j, 120, 200)).toBe(false); // outside the radius
    sim.env.timeH = t0 + FAILED_TARGET_HOURS + 0.01;
    expect(sim.recentlyFailed(j, 103, 202)).toBe(false);
  });

  it('keeps two slots, replacing the older, and survives save/load', () => {
    const sim = new Simulation(3);
    const j = adult(sim, SPECIES_INDEX.jackal);
    const remember = (x: number, z: number): void => (sim as unknown as { rememberFailure(a: Animal, x: number, z: number): void }).rememberFailure(j, x, z);
    remember(100, 100);
    sim.env.timeH += 1;
    remember(300, 300);
    sim.env.timeH += 1;
    remember(500, 500); // replaces (100, 100), the older
    expect(sim.recentlyFailed(j, 100, 100)).toBe(false);
    expect(sim.recentlyFailed(j, 300, 300)).toBe(true);
    expect(sim.recentlyFailed(j, 500, 500)).toBe(true);
    const copy = new Simulation(3, sim.snapshot());
    const jc = copy.animals.find((a) => a.id === j.id)!;
    expect(copy.recentlyFailed(jc, 300, 300)).toBe(true);
    expect(copy.recentlyFailed(jc, 500, 500)).toBe(true);
  });
});
