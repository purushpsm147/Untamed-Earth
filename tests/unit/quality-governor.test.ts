import { describe, expect, it } from 'vitest';
import { QualityGovernor } from '../../apps/web/src/render/qualityGovernor';
import type { QualityChange } from '../../apps/web/src/render/qualityGovernor';

function simulate(g: QualityGovernor, ms: number, seconds: number): QualityChange[] {
  const seen: QualityChange[] = [];
  const frames = Math.ceil((seconds * 1000) / ms);
  for (let i = 0; i < frames; i++) seen.push(g.sample(ms / 1000, false));
  return seen;
}

describe('adaptive quality: deterministic, renderer-independent', () => {
  it('reduces resolution then drops a preset under sustained overload', () => {
    const g = new QualityGovernor('high');
    const changes = simulate(g, 45, 23);
    expect(changes).toContain('resolution');
    expect(changes).toContain('preset');
    expect(g.quality).not.toBe('high');
    expect(g.ceiling).toBe('high');
    expect(g.scale).toBeGreaterThanOrEqual(0.5);
  });

  it('recovers resolution AND a higher preset after temporary overload', () => {
    const g = new QualityGovernor('high');
    simulate(g, 45, 10);
    expect(g.quality).toBe('medium');
    const changes = simulate(g, 16, 125);
    expect(changes).toContain('preset');
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
    expect(g.ceiling).toBe('high');
    // Hard ceiling, even with continuous headroom.
    simulate(g, 16, 90);
    expect(g.quality).toBe('high');
  });

  it('ignores isolated spikes and hidden-tab/restore intervals', () => {
    const g = new QualityGovernor('medium');
    for (let i = 0; i < 100; i++) g.sample(1 / 60, false);
    expect(g.sample(0.4, false)).toBe('none');
    for (let i = 0; i < 500; i++) expect(g.sample(0.1, true)).toBe('none');
    expect(g.quality).toBe('medium');
    expect(g.scale).toBe(1);
    g.sample(0.2, false);
    simulate(g, 16, 3);
    expect(g.quality).toBe('medium');
  });

  it('respects manual quality settings and a newly selected ceiling', () => {
    const g = new QualityGovernor('ultra');
    g.setQuality('medium', false);
    simulate(g, 60, 40);
    expect(g.quality).toBe('medium');
    expect(g.scale).toBe(1);
    g.setAuto(true);
    simulate(g, 45, 15);
    expect(g.quality).toBe('low');
    expect(g.ceiling).toBe('medium');
    simulate(g, 16, 150);
    expect(g.quality).toBe('medium');
    expect(g.ceiling).toBe('medium');
    g.setQuality('low', false);
    expect(g.quality).toBe('low');
    expect(g.ceiling).toBe('low');
    expect(g.scale).toBe(1);
  });

  it('does not change ecology, depend on DOM, or oscillate from near-budget noise', () => {
    const g = new QualityGovernor('high');
    simulate(g, 20, 20); // below overload threshold but lacks upgrade headroom
    expect(g.quality).toBe('high');
    expect(g.scale).toBe(1);
    // No animal state or simulation dependency is required by this module.
  });
});
