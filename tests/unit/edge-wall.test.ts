import { describe, expect, it } from 'vitest';
import { B, EDGE_WALL, SPECIES, SPECIES_INDEX, Simulation, type Animal } from '@untamed/ecology';
import { REGION_SIZE } from '@untamed/worlds';

// Finding B1 (docs/OPEN_BOUNDARY_AUDIT.md): flight clamped at 4 m from the edge, ground movement refused anything
// within 6 m, so a bird that landed in the strip could never take a ground step and died of thirst or hunger there.
// The edge is now one wall (EDGE_WALL) for every movement mode, and anything on the ground inside it walks inward.

const SPEEDS = [0.1, 0.25, 1, 2]; // fixed ticks at 1x, 10x, 100x, 1000x

/** A dry spot in the edge strip along the south edge (z = 4.5), away from ruins and water. */
function dryStripSpot(sim: Simulation): { x: number; z: number } {
  for (let x = 100; x < REGION_SIZE - 100; x += 7) {
    if (sim.valley.waterDepth(x, 4.5, sim.env.stage) < -0.2 && sim.valley.waterDepth(x, 12, sim.env.stage) < -0.2 && !sim.valley.blocked(x, 4.5, 2)) return { x, z: 4.5 };
  }
  throw new Error('no dry edge spot');
}

function myna(sim: Simulation): Animal {
  return sim.animals.find((a) => a.alive && a.sp === SPECIES_INDEX.myna)!;
}

describe('region edge wall (B1)', () => {
  for (const dt of SPEEDS) {
    it(`a bird on the ground inside the edge strip walks out toward its target (tick ${dt} s)`, () => {
      const sim = new Simulation(21);
      const b = myna(sim);
      const p = dryStripSpot(sim);
      Object.assign(b, { x: p.x, z: p.z, px: p.x, pz: p.z, alt: 0, tAlt: 0, palt: 0, speed: 0, beh: B.SeekWater, tx: p.x - 2, tz: 10.6, want: SPECIES[SPECIES_INDEX.myna]!.walk, timer: 1e9, thirst: 0.5, hunger: 0.2 });
      let outAt = -1;
      const ticks = Math.ceil(120 / (dt * 60)); // two game minutes
      for (let i = 0; i < ticks; i++) {
        sim.step(dt);
        if (!b.alive) break;
        if (outAt < 0 && b.z >= EDGE_WALL) outAt = i;
      }
      expect(b.alive).toBe(true);
      expect(outAt).toBeGreaterThanOrEqual(0);
    });
  }

  for (const dt of SPEEDS) {
    it(`flight never takes a bird closer to the edge than the ground wall (tick ${dt} s)`, () => {
      const sim = new Simulation(4);
      const b = myna(sim);
      Object.assign(b, { x: 700, z: 14, px: 700, pz: 14, alt: 8, palt: 8, tAlt: 0, speed: 6, want: 6, beh: B.Wander, tx: 700, tz: -50, timer: 1e9 });
      let minZ = Infinity;
      for (let i = 0; i < Math.ceil(240 / (dt * 60)); i++) {
        Object.assign(b, { tx: 700, tz: -50, tAlt: 0, want: 6, beh: B.Wander, timer: 1e9, fear: 0 }); // keep aiming past the edge
        sim.step(dt);
        minZ = Math.min(minZ, b.z);
      }
      expect(minZ).toBeGreaterThanOrEqual(EDGE_WALL);
      expect(minZ).toBeLessThan(EDGE_WALL + 1); // it did press against the edge
    });
  }
});
