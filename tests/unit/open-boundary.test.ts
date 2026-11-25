import { describe, expect, it } from 'vitest';
import { B, SPECIES, SPECIES_INDEX, Simulation, edgeSigned, insideRegion, type Animal } from '@untamed/ecology';
import { CORRIDOR, REGION_SIZE } from '@untamed/worlds';

// Issue #29: open valley boundary with identity-preserving regional individuals (docs/OPEN_BOUNDARY_DESIGN.md).

const H = SPECIES_INDEX.hare;
const J = SPECIES_INDEX.jackal;
const sum = (r: number[]): number => r.reduce((a, b) => a + b, 0);
type Priv = { stepRegional(): void; crossingOk(sp: unknown, x: number, z: number, f: boolean): boolean; enterValley(a: Animal, x: number, z: number): void };
const priv = (s: Simulation): Priv => s as unknown as Priv;

function open(seed: number, o: Record<string, unknown> = {}): Simulation {
  const sim = new Simulation(seed);
  sim.configureBoundary({ open: true, ...o });
  return sim;
}

/** on-map + off-map + deaths + departures = founders + births (local and off-map). */
function balance(sim: Simulation): [number, number] {
  const m = sim.migration!;
  const live = sim.animals.filter((a) => a.alive).length + sim.regional.filter((a) => a.alive).length;
  const expect = sim.founders + sum(m.initialRegional) + sum(sim.births) + sum(m.offBirths) - sum(sim.deaths.map(sum)) - sum(m.offDeathsBackground) - sum(m.offDeathsAge) - sum(m.offDeathsPredation) - sum(m.departed);
  return [live, expect];
}

/** A dry, gently sloped row from 40 m inside the west edge to the corridor's outer line, passable for hares. */
function crossingRow(sim: Simulation): number {
  for (let z = 100; z < REGION_SIZE - 100; z += 9) if (priv(sim).crossingOk(SPECIES[H], 7, z, false) && sim.valley.waterDepth(40, z, sim.env.stage) < -0.3) return z;
  throw new Error('no crossing row');
}

describe('open boundary', () => {
  it('closed configuration is the #28 simulation, hash for hash', () => {
    const a = new Simulation(4);
    const b = new Simulation(4);
    b.configureBoundary({ open: false });
    for (let i = 0; i < 2 * 720; i++) {
      a.step(2);
      b.step(2);
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.migRng).toBeNull();
  });

  it('the regional landscape is finite, outside the valley, and only jackals and hares live there', () => {
    const sim = open(3);
    expect(sim.regional.length).toBeGreaterThan(0);
    for (const a of sim.regional) {
      expect([J, H]).toContain(a.sp);
      expect(insideRegion(a.x, a.z)).toBe(false);
      expect(a.origin).toBe(1);
    }
    const t = [...sim.territories.values()].filter((x) => !insideRegion(x.x, x.z));
    for (let i = 0; i < t.length; i++) for (let k = i + 1; k < t.length; k++) expect(Math.hypot(t[i]!.x - t[k]!.x, t[i]!.z - t[k]!.z)).toBeGreaterThanOrEqual(SPECIES[J]!.territory!.spacing - 1e-6);
  });

  for (const dt of [0.25, 2]) {
    it(`conserves every animal: on-map + off-map + deaths + departures = founders + births (tick ${dt} s)`, () => {
      const sim = open(3);
      const ticks = Math.round((dt === 2 ? 15 : 2) * 24 * 60 / dt);
      for (let i = 0; i < ticks; i++) {
        sim.step(dt);
        if (i % 500 === 0) {
          const [l, e] = balance(sim);
          expect(l).toBe(e);
        }
      }
      const [l, e] = balance(sim);
      expect(l).toBe(e);
      const m = sim.migration!;
      expect(sum(m.entryVisit) + sum(m.entryReturn)).toBeGreaterThan(0); // the boundary is actually used
      expect(sum(m.exitExcursion) + sum(m.exitEmigration) + sum(m.exitFlee)).toBeGreaterThan(0);
    });
  }

  it('no duplicates: every id is either on-map or off-map, never both, and byId matches', () => {
    const sim = open(5);
    for (let i = 0; i < 10 * 720; i++) sim.step(2);
    const on = new Set(sim.animals.filter((a) => a.alive).map((a) => a.id));
    for (const a of sim.regional) if (a.alive) expect(on.has(a.id)).toBe(false);
    for (const a of [...sim.animals, ...sim.regional]) if (a.alive) expect(sim.byId.get(a.id)).toBe(a);
    for (const a of sim.animals) if (a.alive) expect(!!a.off).toBe(false);
    for (const a of sim.regional) if (a.alive) expect(a.off).toBe(true);
  });

  it('save/load preserves the regional population and continues identically', () => {
    const sim = open(6);
    for (let i = 0; i < 8 * 720; i++) sim.step(2);
    const copy = new Simulation(6, structuredClone(sim.snapshot())) // IndexedDB saves use structured clone;
    expect(copy.regional.map((a) => a.id)).toEqual(sim.regional.filter((a) => a.alive).map((a) => a.id));
    expect(copy.migration).toEqual(sim.migration);
    for (let i = 0; i < 3 * 720; i++) {
      sim.step(2);
      copy.step(2);
    }
    expect(copy.stateHash()).toBe(sim.stateHash());
    const [l, e] = balance(copy);
    expect(l).toBe(e);
  });

  it('arrivals do not depend on how many animals the valley holds (no rescue rule)', () => {
    const a = open(7);
    for (let i = 0; i < 3 * 720; i++) a.step(2);
    const snap = structuredClone(a.snapshot());
    const full = new Simulation(7, snap);
    const empty = new Simulation(7, structuredClone(snap));
    for (const x of empty.animals) x.alive = false; // the valley emptied of every species
    const arrivals = (s: Simulation): number[] => {
      const seen: number[] = [];
      const before = new Set(s.animals.map((x) => x.id));
      for (let h = 0; h < 72; h++) priv(s).stepRegional();
      for (const x of s.animals) if (!before.has(x.id)) seen.push(x.id);
      return seen;
    };
    expect(arrivals(empty)).toEqual(arrivals(full));
  });

  it('zero-inflow control: animals leave but nobody enters', () => {
    const sim = open(3, { inflow: false });
    for (let i = 0; i < 15 * 720; i++) sim.step(2);
    const m = sim.migration!;
    expect(sum(m.entryVisit) + sum(m.entryReturn)).toBe(0);
    expect(sum(m.suppressed)).toBeGreaterThan(0);
    const [l, e] = balance(sim);
    expect(l).toBe(e);
  });

  for (const dt of [0.1, 0.25, 1, 2]) {
    it(`a visitor walks out through the corridor and is held off-map with its identity (tick ${dt} s)`, () => {
      const sim = open(3);
      const z = crossingRow(sim);
      const h = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      Object.assign(h, { x: 30, z, px: 30, pz: z, homeX: -120, homeZ: z, origin: 1, beh: B.Wander, tx: -60, tz: z, timer: 50, fear: 0, hunger: 0.2, thirst: 0.2, want: SPECIES[H]!.walk });
      const id = h.id;
      for (let i = 0; i < Math.ceil(240 / dt) && !h.off; i++) {
        if (!h.transit) Object.assign(h, { beh: B.Wander, tx: -60, tz: z, timer: 50, fear: 0 });
        sim.step(dt);
      }
      expect(h.off).toBe(true);
      expect(sim.byId.get(id)).toBe(h);
      expect(sim.regional).toContain(h);
      expect(sim.animals).not.toContain(h);
      expect(sim.migration!.exitExcursion[H]).toBeGreaterThanOrEqual(1);
      expect(edgeSigned(h.x, h.z)).toBeLessThanOrEqual(-(CORRIDOR - 2.5));
    });
  }

  it('a regional animal ranging into the valley enters through the corridor, in transit, with its own id', () => {
    const sim = open(3);
    const z = crossingRow(sim);
    const h = sim.regional.find((a) => a.sp === H && a.age > 20)!;
    Object.assign(h, { x: -CORRIDOR - 30, z, homeX: -CORRIDOR - 30 + 120, homeZ: z, mother: 0 });
    const before = sum(sim.migration!.entryVisit);
    for (let k = 0; k < 200 && h.off; k++) priv(sim).stepRegional();
    expect(h.off).toBe(false);
    expect(sim.animals).toContain(h);
    expect(h.transit).toBe(1);
    expect(edgeSigned(h.x, h.z)).toBeCloseTo(-CORRIDOR, 0);
    expect(sum(sim.migration!.entryVisit)).toBeGreaterThan(before); // others may range in during the same hours
  });

  it('leaving the regional landscape is a departure, not a death', () => {
    const sim = open(3);
    const j = sim.regional.find((a) => a.sp === J)!;
    sim.territories.delete(j.group);
    j.group = sim.nextId++; // a floater
    j.x = -sim.boundary.ringW + 5;
    j.homeX = -sim.boundary.ringW - 400; // anchor beyond the landscape
    j.homeZ = j.z;
    const deaths = sum(sim.migration!.offDeathsBackground) + sum(sim.migration!.offDeathsAge);
    for (let k = 0; k < 48 && j.alive; k++) priv(sim).stepRegional();
    expect(j.alive).toBe(false);
    expect(sim.migration!.departed[J]).toBe(1);
    expect(sum(sim.migration!.offDeathsBackground) + sum(sim.migration!.offDeathsAge)).toBeLessThanOrEqual(deaths + 0);
  });

  it('a pursuit past the outer line is resolved by the chase rules and counted', () => {
    let resolved = 0;
    for (const seed of [3, 4, 5, 6]) {
      const sim = open(seed);
      const z = crossingRow(sim);
      const prey = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      const pred = sim.animals.find((a) => a.alive && a.sp === J && a.age > 40)!;
      Object.assign(prey, { x: 20, z, px: 20, pz: z, beh: B.Flee, fear: 1, threatX: 60, threatZ: z, tx: -60, tz: z, timer: 60, stamina: 1 });
      Object.assign(pred, { x: 34, z, px: 34, pz: z, beh: B.Chase, targetId: prey.id, timer: 60, stamina: 1, hunger: 0.8 });
      for (let i = 0; i < 60 && !prey.off && prey.alive; i++) {
        prey.timer = 60;
        pred.timer = 60;
        sim.step(0.25);
      }
      const m = sim.migration!;
      resolved += m.pursuitCaptured[H]! + m.pursuitEscaped[H]!;
      const [l, e] = balance(sim);
      expect(l).toBe(e);
    }
    expect(resolved).toBeGreaterThan(0);
  });

  it('no-flee-exit control: a fleeing animal stops at the wall', () => {
    const sim = open(3, { fleeExit: false });
    const z = crossingRow(sim);
    const prey = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
    Object.assign(prey, { x: 20, z, px: 20, pz: z, beh: B.Flee, fear: 1, threatX: 60, threatZ: z, tx: -60, tz: z, timer: 60, stamina: 1 });
    for (let i = 0; i < 80; i++) {
      prey.timer = 60;
      sim.step(0.25);
    }
    expect(prey.off ?? false).toBe(false);
    expect(prey.transit ?? 0).toBe(0);
    expect(edgeSigned(prey.x, prey.z)).toBeGreaterThanOrEqual(5.99);
  });

  it('controlled animals never cross', () => {
    const sim = open(3);
    const z = crossingRow(sim);
    const h = sim.animals.find((a) => a.alive && a.sp === H)!;
    sim.setControlled(h.id);
    Object.assign(h, { x: 12, z, px: 12, pz: z });
    for (let i = 0; i < 200; i++) {
      sim.control = { mx: -1, mz: 0, run: true, action: null };
      sim.step(0.25);
    }
    expect(h.off ?? false).toBe(false);
    expect(h.x).toBeGreaterThanOrEqual(5.99);
    void (h as Animal);
  });

  it('off-map hares stay bounded: births scale with crowding against capacity (no unlimited stock)', () => {
    const sim = open(1, { inflow: false });
    const h0 = sim.regional.filter((a) => a.sp === H).length;
    for (let h = 0; h < 200 * 24; h++) priv(sim).stepRegional();
    const h1 = sim.regional.filter((a) => a.alive && a.sp === H).length;
    expect(h1).toBeLessThanOrEqual(3 * h0); // the first implementation reached 2,311 from 57 by day 210
  });

  it('a resident of an outer territory ranging past the outer line is not counted as a departure', () => {
    const sim = open(3);
    const w = sim.boundary.ringW;
    const j = sim.regional.find((a) => a.sp === J && sim.territories.has(a.group))!;
    const t = sim.territories.get(j.group)!;
    Object.assign(t, { x: -(w - 500), z: 700 });
    Object.assign(j, { x: -(w - 10), z: 700, homeX: t.x, homeZ: t.z });
    for (let h = 0; h < 200 && j.alive; h++) priv(sim).stepRegional();
    expect(sim.migration!.departed[J]).toBe(0);
  });
});

// Amendment 3b: the transit-stall defect found in ce83f68 by the frozen evaluation (docs/ECOLOGY_CONSOLIDATED_REPORT.md
// §4). Every scenario below stalled for the rest of the run before the fix; each is bounded at 1 game hour (60 s).
describe('transit corridor routes always finish (amendment 3b)', () => {
  const insideWall = (a: Animal): boolean => a.x >= 6 && a.z >= 6 && a.x <= REGION_SIZE - 6 && a.z <= REGION_SIZE - 6;
  /** Clear predators away from a point so no flight interferes with the route under test. */
  const calm = (sim: Simulation, x: number, z: number): void => {
    for (const o of sim.animals) if (o.alive && o.sp === J && Math.hypot(o.x - x, o.z - z) < 300) o.alive = false;
  };
  /** Steps until the animal is out of transit (inside the wall, or gone off-map); returns game seconds used. */
  const settle = (sim: Simulation, a: Animal, dt: number): number => {
    let t = 0;
    for (; t < 60 && a.alive && !a.off && a.transit; t += dt) sim.step(dt);
    return t;
  };

  for (const dt of [0.1, 0.25, 1, 2]) {
    it(`an entrant near a corner walks all the way in (tick ${dt} s)`, () => {
      const sim = open(3);
      const h = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      sim.animals.splice(sim.animals.indexOf(h), 1); // re-enter it as an arrival would
      calm(sim, 0, 0);
      priv(sim).enterValley(h, -CORRIDOR, -12); // west edge, 12 m beyond the south edge as well
      sim.animals.push(h);
      expect(insideWall({ ...h, x: h.tx, z: h.tz } as Animal)).toBe(true); // ce83f68 aimed at (20, -12)
      expect(settle(sim, h, dt)).toBeLessThan(60);
      expect(h.transit).toBe(0);
      expect(insideWall(h)).toBe(true);
    });

    it(`young placed beside an entering mother never start beyond the outer line (tick ${dt} s)`, () => {
      const sim = open(3);
      const z = crossingRow(sim);
      const h = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      sim.animals.splice(sim.animals.indexOf(h), 1);
      calm(sim, 0, z);
      priv(sim).enterValley(h, -CORRIDOR - 0.9, z); // the ± 1 m offset given to young entering with their mother
      sim.animals.push(h);
      expect(h.x).toBeGreaterThanOrEqual(-CORRIDOR);
      expect(settle(sim, h, dt)).toBeLessThan(60);
      expect(insideWall(h)).toBe(true);
    });

    it(`an exit interrupted when a flight ends in rest resumes and completes (tick ${dt} s)`, () => {
      const sim = open(3);
      const z = crossingRow(sim);
      const h = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      calm(sim, 0, z);
      // what a flight that carried the hare into the corridor leaves behind: resting, destination = where it stands
      Object.assign(h, { x: -3, z, px: -3, pz: z, transit: -1, exitKind: 'flee', beh: B.Rest, tx: -3, tz: z, want: 0, speed: 0, timer: 0, fear: 0, hunger: 0.2, thirst: 0.2 });
      expect(settle(sim, h, dt)).toBeLessThan(60);
      expect(h.off).toBe(true); // it left the valley
    });

    it(`an exit abandoned for a destination in the edge strip walks back inside the wall (tick ${dt} s)`, () => {
      const sim = open(3);
      const z = crossingRow(sim);
      const h = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      calm(sim, 0, z);
      Object.assign(h, { x: -5, z, px: -5, pz: z, transit: -1, exitKind: 'excursion', beh: B.Idle, tx: 3, tz: z, want: 0, speed: 0, timer: 0, fear: 0 });
      const aborted = sim.migration!.exitAborted[H]!;
      expect(settle(sim, h, dt)).toBeLessThan(60);
      expect(insideWall(h)).toBe(true);
      expect(sim.migration!.exitAborted[H]).toBe(aborted + 1);
    });

    it(`a hare whose flight carried it into water it cannot walk turns back instead of standing there (tick ${dt} s)`, () => {
      const sim = open(3);
      const sp = SPECIES[H]!;
      // where the river leaves the valley: the crossing can be swum in flight but not walked
      let x = -1;
      for (let k = 40; k < REGION_SIZE - 40 && x < 0; k += 3) if (!priv(sim).crossingOk(sp, k, REGION_SIZE - 7, false) && priv(sim).crossingOk(sp, k, REGION_SIZE - 7, true)) x = k;
      expect(x).toBeGreaterThan(0);
      const h = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      calm(sim, x, REGION_SIZE);
      const z = REGION_SIZE + 4;
      Object.assign(h, { x, z, px: x, pz: z, transit: -1, exitKind: 'flee', beh: B.Forage, tx: x, tz: z, want: 0, speed: 0, timer: 0, fear: 0, hunger: 0.2, thirst: 0.2 });
      expect(settle(sim, h, dt)).toBeLessThan(60);
      expect(h.off || insideWall(h)).toBe(true);
    });

    it(`an animal walking back inside out of the river mouth is not refused by its own depth reading (tick ${dt} s)`, () => {
      // the state found pinned for days in seed 1 at ce83f68: an exit given up in the river mouth, heading back inside
      const sim = open(1);
      const h = sim.animals.find((a) => a.alive && a.sp === H && a.age > 20)!;
      const x = 611.6;
      const z = REGION_SIZE + 0.7;
      calm(sim, x, z);
      Object.assign(h, { x, z, px: x, pz: z, transit: -1, exitKind: 'flee', beh: B.Wander, tx: x, tz: REGION_SIZE - 20, want: 0, speed: 0, timer: 0, fear: 0, hunger: 0.2, thirst: 0.2 });
      expect(settle(sim, h, dt)).toBeLessThan(60);
      expect(insideWall(h)).toBe(true);
    });
  }

  it('an open valley at the evaluation tick has no long transits and no starvation or thirst in the corridor (seed 1, 20 days, dt 2)', () => {
    const sim = open(1);
    const since = new Map<number, number>();
    let longest = 0;
    let corridorDeaths = 0;
    // observe deaths without changing them: the simulation's own kill, wrapped on this instance only
    const s = sim as unknown as { kill(a: Animal, cause: string, carcass?: boolean): void };
    const kill = s.kill.bind(sim);
    s.kill = (a, cause, carcass) => {
      if ((cause === 'starvation' || cause === 'dehydration') && (a.transit || !insideWall(a))) corridorDeaths++;
      kill(a, cause, carcass);
    };
    for (let t = 0; t < 20 * 720; t++) {
      sim.step(2);
      const now = new Set<number>();
      for (const a of sim.animals) if (a.alive && !a.off && a.transit) {
        now.add(a.id);
        if (!since.has(a.id)) since.set(a.id, t);
      }
      for (const [id, t0] of since) if (!now.has(id)) {
        longest = Math.max(longest, t - t0);
        since.delete(id);
      }
    }
    for (const t0 of since.values()) longest = Math.max(longest, 20 * 720 - t0);
    expect(longest * 2).toBeLessThan(3600); // under 1 game hour (ce83f68: some animals stayed in transit for the entire run)
    expect(corridorDeaths).toBe(0);
  });
});
