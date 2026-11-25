/**
 * Uniform-grid spatial hash over a bounded square. Rebuilt each tick; queries visit only nearby buckets.
 *
 * Layout: items are inserted into a staging list; the first query after inserts sorts them into one flat array ordered
 * by bucket (a stable counting sort, so items keep their insertion order within a bucket). A query then walks one
 * contiguous slice per grid row instead of one array per bucket. The visiting order (rows z0..z1, buckets x0..x1,
 * insertion order inside a bucket) and the positions read (each item's live x and z at query time) are exactly those of
 * the per-bucket layout, so every caller sees the same items, in the same order, with the same distances.
 */
export class SpatialHash<T extends { x: number; z: number }> {
  private readonly n: number;
  /** Items in insertion order since the last clear, and the bucket each was inserted into. */
  private staged: T[] = [];
  private keys: Int32Array = new Int32Array(1024);
  /** Items sorted by bucket; bucket k occupies sorted[start[k] .. start[k + 1]). */
  private sorted: T[] = [];
  private readonly start: Int32Array;
  private dirty = false;
  constructor(readonly size: number, readonly cell: number) {
    this.n = Math.ceil(size / cell);
    this.start = new Int32Array(this.n * this.n + 1);
  }
  clear(): void {
    this.staged.length = 0;
    this.dirty = true;
  }
  private idx(v: number): number {
    const i = Math.floor(v / this.cell);
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }
  insert(item: T): void {
    const m = this.staged.length;
    if (m >= this.keys.length) {
      const k = new Int32Array(this.keys.length * 2);
      k.set(this.keys);
      this.keys = k;
    }
    this.keys[m] = this.idx(item.z) * this.n + this.idx(item.x);
    this.staged.push(item);
    this.dirty = true;
  }
  private build(): void {
    const start = this.start;
    const nb = this.n * this.n;
    const m = this.staged.length;
    start.fill(0);
    for (let i = 0; i < m; i++) start[this.keys[i]! + 1]!++;
    for (let k = 0; k < nb; k++) start[k + 1]! += start[k]!;
    const sorted = this.sorted;
    sorted.length = m;
    // stable placement: a running cursor per bucket, filled in insertion order
    const cur = start.slice(0, nb);
    for (let i = 0; i < m; i++) sorted[cur[this.keys[i]!]!++] = this.staged[i]!;
    this.dirty = false;
  }
  /** Calls fn for every item within radius r of (x,z). */
  query(x: number, z: number, r: number, fn: (item: T, d2: number) => void): void {
    if (this.dirty) this.build();
    const x0 = this.idx(x - r);
    const x1 = this.idx(x + r);
    const z0 = this.idx(z - r);
    const z1 = this.idx(z + r);
    const r2 = r * r;
    const s = this.sorted;
    const start = this.start;
    for (let cz = z0; cz <= z1; cz++) {
      const row = cz * this.n;
      const end = start[row + x1 + 1]!;
      for (let i = start[row + x0]!; i < end; i++) {
        const it = s[i]!;
        const dx = it.x - x;
        const dz = it.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) fn(it, d2);
      }
    }
  }
}
