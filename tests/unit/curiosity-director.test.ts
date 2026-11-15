import { describe, expect, it } from 'vitest';
import { DEFAULT_DIRECTOR, Candidate, Director } from '../../apps/web/src/game/curiosityDirector';

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
