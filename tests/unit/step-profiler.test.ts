import { describe, expect, it } from 'vitest';
import { PROFILE_STAGES, SPECIES, Simulation, StepProfiler } from '@untamed/ecology';
import { checkFixture, stressFixture } from '../../benchmarks/fixtures/population';

describe('opt-in step profiler', () => {
  it('is off by default and enabling it never changes simulation state', () => {
    const plain = new Simulation(5);
    expect(plain.profiler).toBeNull();
    const profiled = new Simulation(5);
    profiled.profiler = new StepProfiler();
    for (let i = 0; i < 1500; i++) {
      plain.step(i % 3 === 0 ? 1 : 0.1);
      profiled.step(i % 3 === 0 ? 1 : 0.1);
    }
    expect(profiled.stateHash()).toBe(plain.stateHash());
    expect(profiled.rng.state).toBe(plain.rng.state);
    expect(profiled.envRng.state).toBe(plain.envRng.state);
  });

  it('accounts for every tick and stage, and stage time never exceeds wall time', () => {
    const sim = new Simulation(5);
    const p = new StepProfiler();
    sim.profiler = p;
    for (let i = 0; i < 600; i++) sim.step(0.25);
    expect(p.ticks).toBe(600);
    expect(p.tickMs.length).toBe(600);
    const wall = p.tickMs.reduce((s, x) => s + x, 0);
    const ex = p.exclusive();
    const staged = PROFILE_STAGES.filter((s) => s !== 'deaths').reduce((s, k) => s + ex[k], 0);
    expect(staged).toBeLessThanOrEqual(wall * 1.001);
    expect(staged).toBeGreaterThan(wall * 0.6); // most of the step is attributed
    expect(p.calls.environment).toBe(600);
    expect(p.calls.decide).toBeGreaterThan(0);
    expect(p.calls.perception).toBe(p.calls.decide);
    expect(p.query.queries).toBeGreaterThan(p.calls.perception);
    expect(p.query.visited).toBeGreaterThan(0);
    sim.profiler = null;
    const q = p.query.queries;
    sim.step(0.25);
    expect(p.query.queries).toBe(q); // detached: no more counting
  });
});

describe('population stress fixtures (test-only)', () => {
  it('reach the target with unique identities, legitimate species mix and safe placement, deterministically', () => {
    const a = stressFixture(3, 1000);
    const b = stressFixture(3, 1000);
    checkFixture(a);
    expect(a.animals.length).toBe(1000);
    expect(b.stateHash()).toBe(a.stateHash());
    // every species present, roughly in the natural starting proportions
    const natural = new Simulation(3);
    for (let i = 0; i < SPECIES.length; i++) {
      const share = a.population(i) / 1000;
      const nat = natural.population(i) / natural.animals.length;
      expect(Math.abs(share - nat)).toBeLessThan(0.02);
    }
    // a fixture steps, saves and reloads like any world, with correct birth/death accounting and no reused IDs
    // IDs: never duplicated and never reused (the counter is shared with groups and carcasses, so gaps are normal)
    const seen = new Set(a.animals.map((x) => x.id));
    let maxSeen = Math.max(...seen);
    for (let i = 0; i < 300; i++) {
      a.step(1);
      for (const x of a.animals) {
        if (!seen.has(x.id)) {
          expect(x.id).toBeGreaterThan(maxSeen); // a new animal always gets a fresh, larger ID
          seen.add(x.id);
          maxSeen = x.id;
        }
      }
    }
    checkFixture(a);
    const c = new Simulation(3, structuredClone(a.snapshot()));
    for (let i = 0; i < 200; i++) {
      a.step(1);
      c.step(1);
    }
    expect(c.stateHash()).toBe(a.stateHash());
    const born = a.births.reduce((s, n) => s + n, 0);
    const died = a.deaths.flat().reduce((s, n) => s + n, 0);
    expect(a.animals.filter((x) => x.alive).length).toBe(1000 + born - died);
  });
});
