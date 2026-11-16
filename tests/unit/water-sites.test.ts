import { describe, expect, it } from 'vitest';
import { B, SPECIES_INDEX, Simulation } from '@untamed/ecology';

// Regression: findWater returned water points an animal cannot stand at (a dump pool inside a ruin's walls, where
// birds are held at roof height; a river cell beyond the 6 m region margin). A thirsty animal gave up on the site,
// re-found the same site, and repeated until it died of thirst (docs/ECOLOGICAL_STABILITY_REPORT.md).
function thirstyCrowAt(seed: number, x: number, z: number) {
  const sim = new Simulation(seed);
  const crow = sim.animals.find((a) => a.sp === SPECIES_INDEX.crow && a.mother === 0)!;
  sim.env.timeH = Math.floor(sim.env.timeH / 24) * 24 + 36; // noon
  Object.assign(crow, { x, z, alt: 0, thirst: 0.9, hunger: 0.2, energy: 1, fear: 0, beh: B.Idle, timer: 0, waterX: NaN, waterZ: NaN });
  return { sim, crow };
}

describe('water sites must be reachable', () => {
  it('ignores water inside a ruin', () => {
    const { sim, crow } = thirstyCrowAt(15, 1023, 912);
    const raw = sim.env.findWater(1023, 912, 30)!;
    expect(sim.valley.blocked(raw.x, raw.z, 0.6)).toBe(true); // precondition: the nearest water is inside walls
    sim.step(0.1);
    if (crow.beh === B.SeekWater) expect(sim.valley.blocked(crow.tx, crow.tz, 0.6)).toBe(false);
    expect(Math.hypot(crow.waterX - raw.x, crow.waterZ - raw.z) > 1 || Number.isNaN(crow.waterX)).toBe(true);
  });

  it('ignores water beyond the region margin', () => {
    const { sim, crow } = thirstyCrowAt(15, 778, 8);
    const raw = sim.env.findWater(778, 8, 30)!;
    expect(raw.z).toBeLessThan(6); // precondition: the nearest water is outside the passable region
    sim.step(0.1);
    if (!Number.isNaN(crow.waterZ)) expect(crow.waterZ).toBeGreaterThanOrEqual(6);
  });

  it('the filter is optional and does not change unfiltered queries', () => {
    const sim = new Simulation(15);
    expect(sim.env.findWater(778, 8, 30)).toEqual(sim.env.findWater(778, 8, 30, () => true));
  });
});
