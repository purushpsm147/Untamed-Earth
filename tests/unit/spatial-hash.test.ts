import { describe, expect, it } from 'vitest';
import { Rng, SpatialHash } from '@untamed/core';

// The flat (bucket-sorted) layout must visit exactly what the per-bucket layout visited: the same items, in the same
// order, with the same distances, including items that moved after insertion (animals move during a tick) and items
// outside the square (clamped into edge buckets, as animals in the boundary corridor are).

/** The previous per-bucket implementation, kept verbatim as the reference. */
class Reference<T extends { x: number; z: number }> {
  private readonly buckets: T[][];
  private readonly n: number;
  constructor(readonly size: number, readonly cell: number) {
    this.n = Math.ceil(size / cell);
    this.buckets = Array.from({ length: this.n * this.n }, () => []);
  }
  clear(): void {
    for (const b of this.buckets) b.length = 0;
  }
  private idx(v: number): number {
    const i = Math.floor(v / this.cell);
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }
  insert(item: T): void {
    this.buckets[this.idx(item.z) * this.n + this.idx(item.x)]!.push(item);
  }
  query(x: number, z: number, r: number, fn: (item: T, d2: number) => void): void {
    const x0 = this.idx(x - r);
    const x1 = this.idx(x + r);
    const z0 = this.idx(z - r);
    const z1 = this.idx(z + r);
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[cz * this.n + cx]!;
        for (let i = 0; i < b.length; i++) {
          const it = b[i]!;
          const dx = it.x - x;
          const dz = it.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(it, d2);
        }
      }
    }
  }
}

describe('spatial hash (flat layout)', () => {
  it('visits the same items in the same order with the same distances as the per-bucket layout', () => {
    const rng = new Rng(7);
    const size = 1440;
    const a = new SpatialHash<{ id: number; x: number; z: number }>(size, 48);
    const b = new Reference<{ id: number; x: number; z: number }>(size, 48);
    for (let tick = 0; tick < 60; tick++) {
      const items = Array.from({ length: 50 + Math.floor(rng.next() * 400) }, (_, id) => ({ id, x: rng.range(-40, size + 40), z: rng.range(-40, size + 40) }));
      // clustered items too (herds), many per bucket
      for (let k = 0; k < 60; k++) items.push({ id: items.length, x: 700 + rng.range(-20, 20), z: 300 + rng.range(-20, 20) });
      a.clear();
      b.clear();
      for (const it of items) {
        a.insert(it);
        b.insert(it);
      }
      for (let q = 0; q < 200; q++) {
        // items move after insertion, as animals do within a tick (up to a sprint at the largest tick, and beyond)
        if (q % 10 === 0) for (const it of items) if (rng.next() < 0.3) (it.x += rng.range(-60, 60)), (it.z += rng.range(-60, 60));
        const x = rng.range(-30, size + 30);
        const z = rng.range(-30, size + 30);
        const r = rng.range(0, 260);
        const got: string[] = [];
        const want: string[] = [];
        a.query(x, z, r, (it, d2) => got.push(`${it.id}:${d2}`));
        b.query(x, z, r, (it, d2) => want.push(`${it.id}:${d2}`));
        expect(got).toEqual(want);
      }
    }
  });

  it('a clear with no inserts leaves nothing to find; inserts after a query are found by the next query', () => {
    const h = new SpatialHash<{ x: number; z: number }>(100, 10);
    h.insert({ x: 5, z: 5 });
    let n = 0;
    h.query(5, 5, 3, () => n++);
    expect(n).toBe(1);
    h.insert({ x: 6, z: 5 });
    n = 0;
    h.query(5, 5, 3, () => n++);
    expect(n).toBe(2);
    h.clear();
    n = 0;
    h.query(5, 5, 3, () => n++);
    expect(n).toBe(0);
  });
});
