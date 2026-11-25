import { describe, expect, it } from 'vitest';
import { B, EDGE_WALL, SPECIES_INDEX, Simulation, type Animal } from '@untamed/ecology';
import { CORRIDOR, REGION_SIZE } from '@untamed/worlds';

// Issue #29, owner decision 3: feasibility spike for a simulation-authoritative transit corridor outside the region.
// Only animals flagged as in transit may stand in the corridor; everything else still stops at the edge wall.

const SPEEDS = [0.1, 0.25, 1, 2];

/** A row z where the ground is dry and gently sloped from 20 m outside the west edge to 60 m inside. */
function dryRow(sim: Simulation): number {
  for (let z = 100; z < REGION_SIZE - 100; z += 9) {
    let ok = true;
    for (let x = -CORRIDOR + 2; x <= 60 && ok; x += 2) {
      if (sim.valley.waterDepth(x, z, sim.env.stage) > -0.3) ok = false;
      const g = Math.abs(sim.valley.height(x + 1, z) - sim.valley.height(x - 1, z)) / 2;
      if (g > 0.6) ok = false;
    }
    if (ok) return z;
  }
  throw new Error('no dry row');
}

function jackal(sim: Simulation): Animal {
  return sim.animals.find((a) => a.alive && a.sp === SPECIES_INDEX.jackal)!;
}

function put(a: Animal, x: number, z: number, transit: number, tx: number): void {
  Object.assign(a, { x, z, px: x, pz: z, alt: 0, speed: 0, transit, tx, tz: z, beh: B.Wander, timer: 0, hunger: 0.2, thirst: 0.2, fear: 0, controlled: false });
}

describe('boundary transit corridor (spike)', () => {
  it('simulation terrain height matches the rendered terrain inside the corridor and is unchanged inside the region', () => {
    const sim = new Simulation(7);
    const v = sim.valley;
    let maxErr = 0;
    for (let s = 30; s < REGION_SIZE - 30; s += 37) {
      for (const [x, z] of [[-CORRIDOR + 3, s], [-10, s], [REGION_SIZE + 10, s], [s, -15], [s, REGION_SIZE + CORRIDOR - 3]]) maxErr = Math.max(maxErr, Math.abs(v.height(x!, z!) - v.heightFast(x!, z!)));
    }
    expect(maxErr).toBeLessThan(1); // bilinear 4 m lattice vs exact on ridge slopes (measured 0.61 m); clamped grid was 7.7-8.5 m mean, 25.7 m max
    // inside the region the lattice and interpolation are those of the original 0..R grid
    const lat = (x: number, z: number): number => v.sample(x, z).h;
    for (const [x, z] of [[100.3, 200.7], [720, 720], [1201.9, 333.1], [8.2, 1430.5]]) {
      const i = Math.floor(x! / 4), j = Math.floor(z! / 4), u = x! / 4 - i, w = z! / 4 - j;
      const a = lat(i * 4, j * 4), b = lat(i * 4 + 4, j * 4), c = lat(i * 4, j * 4 + 4), d = lat(i * 4 + 4, j * 4 + 4);
      expect(v.heightFast(x!, z!)).toBeCloseTo(a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w, 3);
    }
  });

  for (const dt of SPEEDS) {
    it(`an entering animal walks continuously from the corridor into the valley (tick ${dt} s)`, () => {
      const sim = new Simulation(7);
      const z = dryRow(sim);
      const j = jackal(sim);
      put(j, -CORRIDOR + 2, z, 1, 40);
      let maxStep = 0;
      let doneAt = -1;
      for (let i = 0; i < Math.ceil(120 / dt); i++) {
        const x0 = j.x, z0 = j.z;
        sim.step(dt);
        maxStep = Math.max(maxStep, Math.hypot(j.x - x0, j.z - z0));
        if (doneAt < 0 && !j.transit) doneAt = i;
      }
      expect(doneAt).toBeGreaterThanOrEqual(0);
      expect(j.x).toBeGreaterThanOrEqual(EDGE_WALL);
      expect(maxStep).toBeLessThanOrEqual(Math.max(8, 9 * dt)); // continuous: no jump across the corridor
    });
  }

  for (const dt of SPEEDS) {
    it(`an exiting animal walks out to the corridor's outer line (tick ${dt} s)`, () => {
      const sim = new Simulation(7);
      const z = dryRow(sim);
      const j = jackal(sim);
      put(j, 30, z, -1, -CORRIDOR - 5);
      for (let i = 0; i < Math.ceil(120 / dt) && j.transit !== -2; i++) sim.step(dt);
      expect(j.transit).toBe(-2);
      expect(j.x).toBeLessThanOrEqual(-CORRIDOR + 2.5); // arrival is judged 2.5 m inside the outer line
      expect(j.x).toBeGreaterThanOrEqual(-CORRIDOR - 0.01);
    });
  }

  it('animals not in transit never enter the corridor or the wall strip', () => {
    const sim = new Simulation(3);
    let minEdge = Infinity;
    for (let i = 0; i < 4 * 720; i++) {
      sim.step(2);
      for (const a of sim.animals) if (a.alive && a.alt < 0.25) minEdge = Math.min(minEdge, a.x, a.z, REGION_SIZE - a.x, REGION_SIZE - a.z);
    }
    expect(minEdge).toBeGreaterThanOrEqual(EDGE_WALL);
  });

  it('save/load in mid-transit continues identically', () => {
    const sim = new Simulation(7);
    const z = dryRow(sim);
    const j = jackal(sim);
    put(j, -CORRIDOR + 2, z, 1, 40);
    for (let i = 0; i < 4; i++) sim.step(1);
    expect(j.transit).toBe(1);
    expect(j.x).toBeLessThan(0);
    const copy = new Simulation(7, sim.snapshot());
    expect(copy.byId.get(j.id)!.transit).toBe(1);
    for (let i = 0; i < 200; i++) {
      sim.step(1);
      copy.step(1);
    }
    expect(copy.stateHash()).toBe(sim.stateHash());
    expect(copy.byId.get(j.id)!.transit).toBe(j.transit);
  });
});
