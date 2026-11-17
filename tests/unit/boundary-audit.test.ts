import { describe, expect, it } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { BoundaryAudit } from '../../benchmarks/ecology/boundary-audit';

// The boundary audit (issue #29, step 1) must be read-only: the same seed and ticks give the same state and both RNG
// streams with or without it attached.
describe('boundary audit is simulation-neutral', () => {
  it('leaves state hash and RNG streams unchanged, and sees no animal outside the region', () => {
    const plain = new Simulation(7);
    const audited = new Simulation(7);
    const audit = new BoundaryAudit(audited);
    for (let i = 0; i < 3 * 720; i++) {
      plain.step(2);
      audited.step(2);
      audit.afterStep(2);
    }
    audit.dispose();
    expect(audited.stateHash()).toBe(plain.stateHash());
    expect(audited.rng.state).toBe(plain.rng.state);
    expect(audited.envRng.state).toBe(plain.envRng.state);
    const s = audit.summary();
    expect(s.outOfRegion).toBe(0);
    expect(s.occupancyH.chital!.reduce((p, v) => p + v, 0)).toBeGreaterThan(0);
    expect(s.bandWalkableShare.reduce((p, v) => p + v, 0)).toBeCloseTo(1, 2);
  });
});
