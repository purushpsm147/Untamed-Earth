import { describe, expect, it } from 'vitest';
import { Environment } from '@untamed/environment';
import { Rng } from '@untamed/core';
import { CHUNKS, REGION_SIZE, SCATTER_STRIDE, ScatterKind, Valley, buildChunkMesh } from '@untamed/worlds';

describe('world generation', () => {
  const v = new Valley(1);
  it('is a pure function of the seed', () => {
    const w = new Valley(1);
    expect(w.height(512.3, 733.1)).toBe(v.height(512.3, 733.1));
    expect(Array.from(w.scatter(3, 4))).toEqual(Array.from(v.scatter(3, 4)));
    expect(w.buildings).toEqual(v.buildings);
    expect(new Valley(2).height(512.3, 733.1)).not.toBe(v.height(512.3, 733.1));
  });
  it('covers about two square kilometres with all four areas present', () => {
    expect((REGION_SIZE * REGION_SIZE) / 1e6).toBeGreaterThan(1.9);
    const sum = { forest: 0, meadow: 0, wetland: 0, settlement: 0, dump: 0 };
    let water = 0;
    const n = 60;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (REGION_SIZE / n);
      const z = (j + 0.5) * (REGION_SIZE / n);
      const s = v.sample(x, z);
      sum.forest += s.forest; sum.meadow += s.meadow; sum.wetland += s.wetland; sum.settlement += s.settlement; sum.dump += s.dump;
      const total = s.forest + s.meadow + s.wetland + s.settlement + s.dump;
      expect(total).toBeGreaterThan(0.3);
      expect(total).toBeLessThan(1.6);
      if (v.waterDepth(x, z) > 0) water++;
    }
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) expect(sum[k] / (n * n)).toBeGreaterThan(0.015);
    expect(water / (n * n)).toBeGreaterThan(0.01);
    expect(water / (n * n)).toBeLessThan(0.2);
    expect(v.buildings.length).toBeGreaterThan(12);
  });
  it('keeps scatter out of water and buildings, and the fast heightfield close to the analytic one', () => {
    let trees = 0;
    for (let cz = 0; cz < CHUNKS; cz += 2) for (let cx = 0; cx < CHUNKS; cx += 2) {
      const sc = v.scatter(cx, cz);
      for (let i = 0; i < sc.length; i += SCATTER_STRIDE) {
        if (sc[i] !== ScatterKind.TreeBroad && sc[i] !== ScatterKind.TreeTall) continue;
        trees++;
        expect(v.blocked(sc[i + 1]!, sc[i + 3]!, 0)).toBe(false);
        expect(v.waterSurface(sc[i + 3]!) - sc[i + 2]!).toBeLessThan(0);
      }
    }
    expect(trees).toBeGreaterThan(1000);
    const r = new Rng(5);
    for (let i = 0; i < 300; i++) {
      const x = r.range(150, REGION_SIZE - 150);
      const z = r.range(150, REGION_SIZE - 150);
      expect(Math.abs(v.heightFast(x, z) - v.height(x, z))).toBeLessThan(1.2);
    }
  });
  it('builds seam-matched chunk meshes at different levels of detail', () => {
    const a = buildChunkMesh(v, 5, 5, 12);
    const b = buildChunkMesh(v, 6, 5, 24);
    expect(a.indices.length).toBe(12 * 12 * 6 + 4 * 12 * 6);
    for (let i = 0; i < a.positions.length; i++) expect(Number.isFinite(a.positions[i])).toBe(true);
    // east edge of chunk (5,5) and west edge of (6,5) share corner heights
    const ea = a.positions[(12) * 3 + 1];
    const wb = b.positions[1];
    expect(ea).toBeCloseTo(wb!, 4);
  });
});

describe('environment', () => {
  it('rain raises soil moisture and river stage; drought lowers them and cures vegetation', () => {
    const run = (mode: 'drought' | 'monsoon'): Environment => {
      const env = new Environment(new Valley(1));
      env.params.weatherMode = mode;
      const rng = new Rng(9);
      for (let i = 0; i < 24 * 4 * 25; i++) env.step(0.25, rng);
      return env;
    };
    const dry = run('drought');
    const wet = run('monsoon');
    expect(wet.meanMoisture).toBeGreaterThan(dry.meanMoisture + 0.2);
    expect(wet.stage).toBeGreaterThan(dry.stage + 0.2);
    expect(wet.totalVeg).toBeGreaterThan(dry.totalVeg * 1.15);
    for (const e of [dry, wet]) for (let c = 0; c < e.veg.length; c++) {
      expect(e.veg[c]).toBeGreaterThanOrEqual(0);
      expect(e.veg[c]).toBeLessThanOrEqual(e.cap[c]! * 1.01);
      expect(e.nutrients[c]).toBeGreaterThanOrEqual(0);
      expect(e.nutrients[c]).toBeLessThanOrEqual(1);
    }
  });
  it('has a day/night cycle', () => {
    const env = new Environment(new Valley(1));
    const rng = new Rng(1);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 96; i++) {
      env.step(0.25, rng);
      min = Math.min(min, env.daylight());
      max = Math.max(max, env.daylight());
    }
    expect(min).toBe(0);
    expect(max).toBe(1);
  });
});
