import { describe, expect, it } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { PlausibilityAudit } from '../../benchmarks/ecology/plausibility';

// The behaviour audit must be read-only: the same seed and ticks give the same state and both RNG streams with or
// without it attached.
describe('plausibility audit is simulation-neutral', () => {
  it('leaves state hash and RNG streams unchanged', () => {
    const plain = new Simulation(7);
    const audited = new Simulation(7);
    const audit = new PlausibilityAudit(audited);
    for (let i = 0; i < 3 * 720; i++) {
      plain.step(2);
      audited.step(2);
      audit.afterStep(2);
    }
    expect(audited.stateHash()).toBe(plain.stateHash());
    expect(audited.rng.state).toBe(plain.rng.state);
    expect(audited.envRng.state).toBe(plain.envRng.state);
    const s = audit.summary() as { animalDays: Record<string, number> };
    expect(s.animalDays.chital).toBeGreaterThan(0);
  });
});
