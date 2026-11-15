import { describe, expect, it } from 'vitest';
import { AdaptiveQuality } from '../../apps/web/src/render/adaptive';
import { DEFAULT_DIRECTOR, Candidate, Director } from '../../apps/web/src/game/curiosityDirector';

const run = (q: AdaptiveQuality, seconds: number, frameMs: number | ((t: number) => number)): string[] => {
  const acts: string[] = [];
  let t = 0;
  while (t < seconds) {
    const ms = typeof frameMs === 'number' ? frameMs : frameMs(t);
    const a = q.step(ms / 1000);
    if (a !== 'none') acts.push(a);
    t += ms / 1000;
  }
  return acts;
};

describe('adaptive quality controller', () => {
  it('lowers resolution first, then steps the preset down, and never below the floor', () => {
    const q = new AdaptiveQuality(2);
    const acts = run(q, 60, 45);
    const firstPreset = acts.indexOf('preset-down');
    expect(acts.slice(0, firstPreset).every((a) => a === 'resolution-down')).toBe(true);
    expect(firstPreset).toBeGreaterThanOrEqual(4); // 1.0 -> 0.5 in 0.1 steps before touching the preset
    expect(q.level).toBe(0);
    expect(q.resScale).toBeGreaterThanOrEqual(0.5);
  });
  it('ignores isolated spikes and hidden tabs', () => {
    const q = new AdaptiveQuality(2);
    const acts = run(q, 30, (t) => (Math.floor(t * 60) % 120 === 0 ? 80 : 16.7));
    expect(acts).toEqual([]);
    expect(q.step(5)).toBe('none'); // a 5 s gap (tab was in the background)
    expect(q.resScale).toBe(1);
  });
  it('does not oscillate at a boundary: failed upgrades back off exponentially', () => {
    // a device that holds 60 fps at <=70% scale but drops to 30 fps above it
    const q = new AdaptiveQuality(2);
    const acts: string[] = [];
    let t = 0;
    const stamps: number[] = [];
    while (t < 600) {
      const ms = q.resScale > 0.7 ? 33 : 16.7;
      const a = q.step(ms / 1000);
      if (a !== 'none') {
        acts.push(a);
        if (a === 'resolution-up') stamps.push(t);
      }
      t += ms / 1000;
    }
    expect(acts.filter((a) => a === 'preset-down')).toEqual([]);
    expect(stamps.length).toBeLessThanOrEqual(8); // a naive controller would flip ~60 times in 10 minutes
    const gaps = stamps.slice(1).map((s, i) => s - stamps[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]! * 1.3);
    expect(q.resScale).toBeGreaterThanOrEqual(0.6);
  });
  it('does nothing when automatic adaptation is switched off', () => {
    const q = new AdaptiveQuality(3);
    q.auto = false;
    expect(run(q, 20, 60)).toEqual([]);
    expect(q.level).toBe(3);
  });
});

describe('curiosity director', () => {
  const c = (key: string, base: number, x = 0, z = 0): Candidate => ({ key, kind: 'animal', id: Number(key.slice(2)) || 0, x, z, base, tag: key });
  it('holds a subject for the minimum dwell even when something slightly better appears', () => {
    const d = new Director();
    expect(d.choose([c('a:1', 3), c('a:2', 2)], 0, 0, 0, true)?.key).toBe('a:1');
    for (let t = 1; t < DEFAULT_DIRECTOR.minDwell; t++) expect(d.choose([c('a:1', 3), c('a:2', 30)], 0, 0, t, true)?.key).toBe('a:1');
    expect(d.switches).toBe(1);
  });
  it('after the minimum dwell, only a clearly better event interrupts', () => {
    const d = new Director();
    d.choose([c('a:1', 3)], 0, 0, 0, true);
    expect(d.choose([c('a:1', 3), c('a:2', 3.6)], 0, 0, 15, true)?.key).toBe('a:1'); // marginal: stay
    expect(d.choose([c('a:1', 3), c('a:2', 9)], 0, 0, 16, true)?.key).toBe('a:2'); // a chase: cut
  });
  it('moves on at the maximum dwell, when the subject dies, and on skip; and does not bounce straight back', () => {
    const d = new Director();
    d.choose([c('a:1', 5), c('a:2', 4)], 0, 0, 0, true);
    expect(d.choose([c('a:1', 5), c('a:2', 4)], 0, 0, DEFAULT_DIRECTOR.maxDwell + 1, true)?.key).toBe('a:2');
    // a:1 was just watched, so its novelty is low and a fresh, weaker subject wins on the next change
    expect(d.choose([c('a:1', 5), c('a:3', 2)], 0, 0, 45, false)?.key).toBe('a:3');
    expect(d.choose([c('a:3', 2), c('a:4', 1)], 0, 0, 46, true, true)?.key).toBe('a:4'); // skip
  });
  it('prefers nearby subjects and bounds the number of cuts over a long session', () => {
    const d = new Director();
    expect(d.choose([c('a:1', 4, 900, 0), c('a:2', 3, 20, 0)], 0, 0, 0, true)?.key).toBe('a:2');
    const d2 = new Director();
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let t = 0; t < 600; t += 1.5) d2.choose(Array.from({ length: 30 }, (_, i) => c(`a:${i}`, 1 + rnd() * 9, rnd() * 800, rnd() * 800)), 400, 400, t, true);
    expect(d2.switches).toBeLessThanOrEqual(600 / DEFAULT_DIRECTOR.minDwell + 1);
    expect(d2.switches).toBeGreaterThanOrEqual(600 / DEFAULT_DIRECTOR.maxDwell - 1);
  });
});
