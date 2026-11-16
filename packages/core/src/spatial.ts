/** Uniform-grid spatial hash over a bounded square. Rebuilt each tick; queries visit only nearby buckets. */
export class SpatialHash<T extends { x: number; z: number }> {
  private readonly buckets: T[][];
  /** Opt-in counters (profiling only): queries made and candidate items visited before the radius test. */
  stats: { queries: number; visited: number } | null = null;
  private readonly n: number;
  constructor(readonly size: number, readonly cell: number) {
    this.n = Math.ceil(size / cell);
    this.buckets = Array.from({ length: this.n * this.n }, () => []);
  }
  /** Indices of buckets that received items since the last clear (so clearing costs O(items), not O(buckets)). */
  private readonly used: number[] = [];
  clear(): void {
    const u = this.used;
    for (let i = 0; i < u.length; i++) this.buckets[u[i]!]!.length = 0;
    u.length = 0;
  }
  private idx(v: number): number {
    const i = Math.floor(v / this.cell);
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }
  insert(item: T): void {
    const k = this.idx(item.z) * this.n + this.idx(item.x);
    const b = this.buckets[k]!;
    if (b.length === 0) this.used.push(k);
    b.push(item);
  }
  /** Calls fn for every item within radius r of (x,z). */
  query(x: number, z: number, r: number, fn: (item: T, d2: number) => void): void {
    const x0 = this.idx(x - r);
    const x1 = this.idx(x + r);
    const z0 = this.idx(z - r);
    const z1 = this.idx(z + r);
    const r2 = r * r;
    const st = this.stats;
    if (st) st.queries++;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[cz * this.n + cx]!;
        if (st) st.visited += b.length;
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
