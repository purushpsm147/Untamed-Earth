import { describe, expect, it } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { EcoObserver } from '../../benchmarks/ecology/observer';

describe('ecological diagnostics observer', () => {
  it('is simulation-neutral: identical state, RNG streams and replay with it attached', () => {
    const plain = new Simulation(3);
    const observed = new Simulation(3);
    const obs = new EcoObserver(observed);
    for (let i = 0; i < 4000; i++) {
      plain.step(2);
      observed.step(2);
      obs.afterStep(2);
    }
    expect(observed.stateHash()).toBe(plain.stateHash());
    expect(observed.rng.state).toBe(plain.rng.state);
    expect(observed.envRng.state).toBe(plain.envRng.state);
    // it recorded something meaningful along the way
    expect(obs.days.length).toBeGreaterThan(4);
    const s = obs.summary() as { hunting: { chases: number }; behaviourBudget: Record<string, Record<string, number>> };
    expect(Object.keys(s.behaviourBudget.chital!).length).toBeGreaterThan(2);
    // detaching stops event collection
    obs.detach();
    const kills = (obs.summary() as { hunting: { kills: number } }).hunting.kills;
    for (let i = 0; i < 2000; i++) observed.step(2);
    expect((obs.summary() as { hunting: { kills: number } }).hunting.kills).toBe(kills);
  });
});
