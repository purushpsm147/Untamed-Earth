import { describe, expect, it } from 'vitest';
import { Rng, SpatialHash, angleDiff, fbm, hash3, valueNoise } from '@untamed/core';

describe('core', () => {
  it('rng is deterministic and resumable from its state', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const c = new Rng(0);
    c.state = a.state;
    expect(c.next()).toBe(a.next());
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('noise is bounded, seeded and continuous', () => {
    for (let i = 0; i < 500; i++) {
      const v = fbm(7, i * 0.37, i * 0.11, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(valueNoise(1, 3.3, 4.4)).toBe(valueNoise(1, 3.3, 4.4));
    expect(valueNoise(1, 3.3, 4.4)).not.toBe(valueNoise(2, 3.3, 4.4));
    expect(Math.abs(valueNoise(1, 5, 5) - valueNoise(1, 5.001, 5))).toBeLessThan(0.01);
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
  });
  it('spatial hash returns exactly the items within the radius', () => {
    const r = new Rng(3);
    const items = Array.from({ length: 400 }, () => ({ x: r.range(0, 1000), z: r.range(0, 1000) }));
    const h = new SpatialHash<{ x: number; z: number }>(1000, 50);
    items.forEach((i) => h.insert(i));
    const found = new Set<object>();
    h.query(480, 510, 120, (i) => found.add(i));
    const brute = items.filter((i) => Math.hypot(i.x - 480, i.z - 510) <= 120);
    expect(found.size).toBe(brute.length);
    brute.forEach((i) => expect(found.has(i)).toBe(true));
  });
  it('angleDiff takes the short way round', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(3.1, -3.1)).toBeCloseTo(0.083, 2);
  });
});
