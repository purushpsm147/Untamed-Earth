import { describe, expect, it } from 'vitest';
import { B, SPECIES_INDEX, Simulation } from '@untamed/ecology';

// Regression: a bird blocked on the ground could never take off, because the climb decision used the previous tick's
// speed, which the obstacle had reset to 0. At the 1000x tick (2 s) a myna walking to the river took a ~20 m ground
// step into deep water past a steep bank, was blocked, and stayed pinned until it died of thirst
// (docs/ECOLOGICAL_STABILITY_REPORT.md, "Ground-pinned birds").
describe('flying animals blocked on the ground take off', () => {
  it('a thirsty myna on a steep river bank reaches the water at the 2 s tick', () => {
    const sim = new Simulation(5);
    const site = sim.env.findWater(597, 465, 60)!;
    expect(site).not.toBeNull();
    // precondition: the remembered site is deep water ~20 m away, beyond a 6 m bank
    expect(sim.valley.waterDepth(site.x, site.z, sim.env.stage)).toBeGreaterThan(0.3);
    expect(Math.hypot(site.x - 597, site.z - 465)).toBeGreaterThan(15);
    const m = sim.animals.find((a) => a.sp === SPECIES_INDEX.myna && a.mother === 0)!;
    Object.assign(m, { x: 597, z: 465, alt: 0, speed: 0, thirst: 0.9, hunger: 0.2, energy: 1, fear: 0, beh: B.Idle, timer: 0, waterX: site.x, waterZ: site.z });
    sim.env.timeH = Math.floor(sim.env.timeH / 24) * 24 + 36; // noon: no darkness deferral
    let drank = false;
    for (let i = 0; i < 60 && !drank; i++) {
      sim.step(2);
      drank = m.beh === B.Drink;
    }
    expect(drank).toBe(true);
  });
});
