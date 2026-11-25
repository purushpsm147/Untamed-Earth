import { Rng, clamp01, fbm, hash3, lerp, ridge, smoothstep } from '@untamed/core';

/** Playable region edge length in metres (1440 m square = 2.07 km^2). */
export const REGION_SIZE = 1440;
export const CHUNK_SIZE = 96;
export const CHUNKS = REGION_SIZE / CHUNK_SIZE; // 15
/** Non-playable chunks rendered beyond the region so the horizon is never a cliff edge. */
export const APRON = 2;
/** Width (m) of the simulation-authoritative transit corridor outside each edge (issue #29; multiple of 4). */
export const CORRIDOR = 24;

export interface TerrainSample {
  h: number;
  forest: number;
  meadow: number;
  wetland: number;
  settlement: number;
  dump: number;
  /** Distance to nearest road centreline (m). */
  road: number;
  /** Horizontal distance to river centreline (m). */
  riverD: number;
  /** 0 inside region, rising to 1 in the border ridges. */
  border: number;
}

export interface Building {
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  /** 0 intact shell .. 1 mostly collapsed. */
  collapse: number;
  kind: 'house' | 'hall' | 'tower' | 'shed';
  seed: number;
}
export type WreckKind = 'car' | 'bus' | 'truck' | 'excavator' | 'container' | 'pylon' | 'bridge';
export interface Wreck {
  x: number;
  z: number;
  rot: number;
  kind: WreckKind;
  tilt: number;
  seed: number;
}
export interface Pool {
  x: number;
  z: number;
  r: number;
}

export const ScatterKind = {
  TreeBroad: 0,
  TreeTall: 1,
  Snag: 2,
  Shrub: 3,
  Rock: 4,
  Reed: 5,
  Scrap: 6,
  Barrel: 7,
  Tire: 8,
  Plastic: 9,
  Rubble: 10,
  Log: 11,
} as const;
export const SCATTER_KINDS = 12;
/** Packed scatter record: kind, x, y, z, rot, scale, rand. */
export const SCATTER_STRIDE = 7;

export interface Perch {
  x: number;
  z: number;
  /** Height above ground. */
  h: number;
}

type Seg = [number, number, number, number];

const SETTLEMENT = { x: 1010, z: 440 };
const DUMP = { x: 1090, z: 1010 };
const WETLAND = { x: 700, z: 1190 };

/**
 * The Reclaimed Valley: a deterministic, analytic description of the MVP region.
 * Everything (terrain, zones, landmarks, scatter) is a pure function of the seed,
 * so chunks can be generated in any order, on any thread, and always agree.
 */
export class Valley {
  readonly size = REGION_SIZE;
  readonly buildings: Building[] = [];
  readonly wrecks: Wreck[] = [];
  readonly pools: Pool[] = [];
  readonly roads: Seg[] = [];
  private readonly p1: number;
  private readonly p2: number;
  private readonly s: TerrainSample = { h: 0, forest: 0, meadow: 0, wetland: 0, settlement: 0, dump: 0, road: 0, riverD: 0, border: 0 };
  private hGrid: Float32Array | null = null;
  private readonly scatterCache = new Map<number, Float32Array>();
  private readonly perchCache = new Map<number, Perch[]>();

  constructor(readonly seed: number) {
    const r = new Rng(hash3(seed, 11, 7));
    this.p1 = r.range(0, 6.28);
    this.p2 = r.range(0, 6.28);
    this.layoutRoads();
    this.layoutLandmarks(r);
  }

  riverX(z: number): number {
    return 640 + 90 * Math.sin(z * 0.0052 + this.p1) + 42 * Math.sin(z * 0.0131 + this.p2) + (fbm(this.seed + 5, z / 210, 3.3, 2) - 0.5) * 70;
  }

  /** Mean water surface elevation; the river falls gently north to south, then goes flat through the wetland. */
  waterSurface(z: number): number {
    return Math.max(5.2 - 0.0028 * z, 2.26);
  }

  private layoutRoads(): void {
    const bz = 470;
    const bx = this.riverX(bz);
    const pts: [number, number][] = [
      [-200, 560], [140, 540], [380, 500], [bx - 30, bz], [bx + 30, bz], [820, 455], [SETTLEMENT.x, SETTLEMENT.z], [1200, 420], [1640, 380],
    ];
    for (let i = 0; i < pts.length - 1; i++) this.roads.push([pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]]);
    // cross street and the haul road to the dump
    this.roads.push([SETTLEMENT.x - 10, 300, SETTLEMENT.x, SETTLEMENT.z]);
    this.roads.push([SETTLEMENT.x, SETTLEMENT.z, 1030, 620]);
    this.roads.push([1030, 620, 1075, 800]);
    this.roads.push([1075, 800, DUMP.x - 10, DUMP.z - 60]);
    this.roads.push([900, 360, 1120, 345]);
    this.roads.push([905, 540, 1110, 520]);
  }

  private layoutLandmarks(r: Rng): void {
    // houses along the settlement streets
    for (const s of this.roads) {
      const [ax, az, bx, bz] = s;
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      for (let t = 12; t < len - 8; t += r.range(15, 24)) {
        for (const side of [-1, 1]) {
          const off = r.range(10, 15) * side;
          const x = ax + dx * t - dz * off;
          const z = az + dz * t + dx * off;
          const ds = Math.hypot(x - SETTLEMENT.x, z - SETTLEMENT.z);
          if (ds > 205 || !r.chance(0.72)) continue;
          const w = r.range(6, 11);
          const d = r.range(5, 8.5);
          if (this.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < (b.w + w) * 0.75 + 2)) continue;
          if (this.roadDist(x, z) < Math.max(w, d) * 0.5 + 3) continue;
          this.buildings.push({
            x, z, w, d,
            rot: Math.atan2(dx, dz) + r.range(-0.08, 0.08),
            h: r.chance(0.3) ? r.range(5.6, 6.6) : r.range(2.9, 3.6),
            collapse: clamp01(r.range(-0.1, 1.1)),
            kind: r.chance(0.15) ? 'shed' : 'house',
            seed: r.int(1e9),
          });
        }
      }
    }
    this.buildings.push({ x: SETTLEMENT.x + 34, z: SETTLEMENT.z - 46, w: 5, d: 5, h: 15, rot: 0.3, collapse: 0.2, kind: 'tower', seed: r.int(1e9) });
    this.buildings.push({ x: SETTLEMENT.x - 52, z: SETTLEMENT.z + 44, w: 19, d: 11, h: 5.5, rot: 0.1, collapse: 0.55, kind: 'hall', seed: r.int(1e9) });
    // a processing shed at the dump gate
    this.buildings.push({ x: DUMP.x - 70, z: DUMP.z - 95, w: 16, d: 10, h: 6, rot: 0.5, collapse: 0.7, kind: 'hall', seed: r.int(1e9) });

    // abandoned vehicles: on and beside the roads
    for (let i = 0; i < 16; i++) {
      const s = this.roads[5 + r.int(this.roads.length - 5)]!;
      const t = r.next();
      const x = lerp(s[0], s[2], t) + r.range(-5, 5);
      const z = lerp(s[1], s[3], t) + r.range(-5, 5);
      if (x < 0 || x > REGION_SIZE || this.blocked(x, z, 3)) continue;
      this.wrecks.push({ x, z, rot: Math.atan2(s[2] - s[0], s[3] - s[1]) + r.range(-0.6, 0.6), kind: i === 3 ? 'bus' : 'car', tilt: r.range(-0.12, 0.12), seed: r.int(1e9) });
    }
    // dump: machinery, containers, stacked car bodies
    for (let i = 0; i < 26; i++) {
      const a = r.range(0, 6.28);
      const d = r.range(15, 150);
      const kind: WreckKind = i < 2 ? 'excavator' : i < 5 ? 'truck' : i < 12 ? 'container' : 'car';
      this.wrecks.push({ x: DUMP.x + Math.cos(a) * d, z: DUMP.z + Math.sin(a) * d, rot: r.range(0, 6.28), kind, tilt: r.range(-0.25, 0.25), seed: r.int(1e9) });
    }
    // leaning pylons marching north-east out of the settlement
    for (let i = 0; i < 6; i++) {
      this.wrecks.push({ x: SETTLEMENT.x + 70 + i * 62, z: SETTLEMENT.z - 80 - i * 52, rot: 0.85, kind: 'pylon', tilt: i === 2 ? 1.35 : r.range(-0.1, 0.18), seed: r.int(1e9) });
    }
    const bz = 470;
    this.wrecks.push({ x: this.riverX(bz), z: bz, rot: Math.PI / 2, kind: 'bridge', tilt: 0, seed: 1 });
    // leachate pools in the dump
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + r.range(0, 0.6);
      const d = r.range(40, 120);
      this.pools.push({ x: DUMP.x + Math.cos(a) * d, z: DUMP.z + Math.sin(a) * d, r: r.range(7, 13) });
    }
  }

  roadDist(x: number, z: number): number {
    let best = 1e9;
    for (const s of this.roads) {
      const vx = s[2] - s[0];
      const vz = s[3] - s[1];
      const t = clamp01(((x - s[0]) * vx + (z - s[1]) * vz) / (vx * vx + vz * vz));
      const d = Math.hypot(x - (s[0] + vx * t), z - (s[1] + vz * t));
      if (d < best) best = d;
    }
    return best;
  }

  /** Full analytic sample. Returns a shared scratch object: copy fields you need before calling again. */
  sample(x: number, z: number): TerrainSample {
    const o = this.s;
    const sd = this.seed;
    const rx = this.riverX(z);
    const D = Math.abs(x - rx);
    const W = this.waterSurface(z);
    const lo = fbm(sd + 1, x / 260, z / 260, 5);
    const mid = fbm(sd + 2, x / 42, z / 42, 3) - 0.5;
    const warp = (fbm(sd + 3, x / 90, z / 90, 2) - 0.5) * 70;

    let h = 9 + lo * 26 + (1 - clamp01(x / REGION_SIZE)) * 9 + mid * 2.4;

    // valley floor and channel
    const floorT = smoothstep(270, 40, D) * 0.86;
    h = lerp(h, W + 1.5 + (h - 9) * 0.1 + mid * 0.8, floorT);
    const halfW = 7.5 + 3 * fbm(sd + 4, z / 60, 1.7, 2);

    // zone weights
    const ws = smoothstep(235, 130, Math.hypot(x - SETTLEMENT.x, z - SETTLEMENT.z) + warp * 0.6);
    const wd = smoothstep(185, 110, Math.hypot(x - DUMP.x, z - DUMP.z) + warp * 0.5);
    const ww = smoothstep(265, 130, Math.hypot((x - WETLAND.x) * 0.8, z - WETLAND.z) + warp);

    h = lerp(h, 12.5 + lo * 3 + mid * 0.6, ws * 0.8);
    h = lerp(h, 11 + lo * 2, wd * 0.7) + wd * ridge(sd + 6, x / 46, z / 46, 3) * 8;
    for (const p of this.pools) {
      const pd = Math.hypot(x - p.x, z - p.z);
      if (pd < p.r * 2.2) h -= smoothstep(p.r * 2.2, p.r * 0.4, pd) * 2.6 * wd;
    }
    h = lerp(h, W + (fbm(sd + 7, x / 30, z / 30, 3) - 0.5) * 1.7, ww * 0.97);
    const chan = smoothstep(halfW * 2.4, halfW * 0.55, D);
    h = lerp(h, W - 1.35, chan);

    // border ridges (kept open along the river corridor)
    const e = Math.min(x, z, REGION_SIZE - x, REGION_SIZE - z);
    const border = smoothstep(150, -130, e) * smoothstep(50, 230, D);
    h += border * border * (48 + ridge(sd + 8, x / 190, z / 190, 4) * 60);
    h += (fbm(sd + 9, x / 9, z / 9, 2) - 0.5) * 0.45 * (1 - chan);

    const patches = smoothstep(0.55, 0.68, fbm(sd + 10, x / 170, z / 170, 3));
    const clearing = 1 - smoothstep(0.66, 0.76, fbm(sd + 12, x / 120, z / 120, 2)) * 0.85;
    const westSide = smoothstep(-30, -150, x - rx);
    let forest = clamp01(Math.max(westSide * clearing, patches * 0.9, border));
    forest *= (1 - ws * 0.92) * (1 - wd) * (1 - ww) * (1 - chan);
    o.h = h;
    o.settlement = ws * (1 - ww);
    o.dump = wd * (1 - ww);
    o.wetland = ww;
    o.forest = forest * (1 - o.settlement * 0.5);
    o.meadow = clamp01(1 - o.forest - o.settlement - o.dump - o.wetland);
    o.road = this.roadDist(x, z);
    o.riverD = D;
    o.border = border;
    return o;
  }

  /** Exact terrain height (analytic; use for rendering and anything needing sub-metre fidelity). */
  height(x: number, z: number): number {
    return this.sample(x, z).h;
  }

  /**
   * Bilinear lookup in a cached 4 m heightfield: the simulation's fast path. It covers the region plus the transit
   * corridor (CORRIDOR m outside every edge, issue #29), on the same lattice, so values inside the region are unchanged;
   * outside the corridor it clamps.
   */
  heightFast(x: number, z: number): number {
    const N = (REGION_SIZE + 2 * CORRIDOR) / 4 + 1;
    if (!this.hGrid) {
      const g = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) g[j * N + i] = this.sample(i * 4 - CORRIDOR, j * 4 - CORRIDOR).h;
      this.hGrid = g;
    }
    const fx = Math.min(Math.max((x + CORRIDOR) / 4, 0), N - 1.001);
    const fz = Math.min(Math.max((z + CORRIDOR) / 4, 0), N - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const g = this.hGrid;
    const a = g[j * N + i]!;
    const b = g[j * N + i + 1]!;
    const c = g[(j + 1) * N + i]!;
    const d = g[(j + 1) * N + i + 1]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Depth of standing/flowing water at a point (<=0 means dry). `stage` is the hydrological offset from the simulation. */
  waterDepth(x: number, z: number, stage = 0): number {
    return this.waterSurface(z) + stage - this.heightFast(x, z);
  }

  /** Index of the leachate pool covering this point, or -1. */
  poolAt(x: number, z: number): number {
    for (let i = 0; i < this.pools.length; i++) {
      const p = this.pools[i]!;
      if (Math.hypot(x - p.x, z - p.z) < p.r) return i;
    }
    return -1;
  }

  /** True if the point lies inside a building footprint (expanded by `margin`). */
  blocked(x: number, z: number, margin = 0.6): boolean {
    for (const b of this.buildings) {
      const dx = x - b.x;
      const dz = z - b.z;
      const reach = (b.w + b.d) * 0.5 + margin;
      if (dx * dx + dz * dz > reach * reach) continue;
      const c = Math.cos(b.rot);
      const s = Math.sin(b.rot);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) < b.w * 0.5 + margin && Math.abs(lz) < b.d * 0.5 + margin) return true;
    }
    return false;
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return x >= margin && z >= margin && x <= REGION_SIZE - margin && z <= REGION_SIZE - margin;
  }

  /** Deterministic vegetation / debris placement for one chunk. Cached; identical on every call and thread. */
  scatter(cx: number, cz: number): Float32Array {
    const key = (cx + 64) * 256 + (cz + 64);
    const hit = this.scatterCache.get(key);
    if (hit) return hit;
    const out: number[] = [];
    const K = ScatterKind;
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const pass = (salt: number, grid: number, fn: (s: TerrainSample, x: number, z: number, r: Rng, depth: number) => void): void => {
      const n = Math.round(CHUNK_SIZE / grid);
      const r = new Rng(hash3(this.seed + salt, cx, cz));
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = x0 + (i + r.next()) * grid;
          const z = z0 + (j + r.next()) * grid;
          const u = r.next();
          // one sub-generator per candidate keeps placements stable if acceptance rules change
          const sub = new Rng((u * 4294967296) >>> 0);
          const s = this.sample(x, z);
          fn(s, x, z, sub, this.waterSurface(z) - s.h);
        }
      }
    };
    const put = (kind: number, x: number, y: number, z: number, r: Rng, scale: number): void => {
      out.push(kind, x, y, z, r.range(0, 6.283), scale, r.next());
    };
    // trees
    pass(101, 7.4, (s, x, z, r, depth) => {
      if (depth > -0.35 || s.road < 3.2) return;
      const succession = s.settlement * 0.16 + s.dump * 0.035 + s.meadow * 0.022 + s.wetland * 0.03;
      const p = s.forest * 0.8 + succession;
      if (r.next() > p || this.blocked(x, z, 1.2)) return;
      const k = r.next();
      const young = s.forest < 0.4 ? 0.7 : 1;
      if (k < 0.07) put(K.Snag, x, s.h, z, r, r.range(0.7, 1.2));
      else if (k < 0.42 + s.border * 0.3) put(K.TreeTall, x, s.h, z, r, r.range(0.75, 1.35) * young);
      else put(K.TreeBroad, x, s.h, z, r, r.range(0.7, 1.4) * young);
    });
    // shrubs
    pass(102, 5.2, (s, x, z, r, depth) => {
      if (depth > -0.2 || s.road < 2.2) return;
      const p = s.forest * 0.22 + s.meadow * 0.05 + s.settlement * 0.24 + s.dump * 0.07 + s.wetland * 0.08;
      if (r.next() > p || this.blocked(x, z, 0.2)) return;
      put(K.Shrub, x, s.h, z, r, r.range(0.6, 1.5));
    });
    // rocks and fallen logs
    pass(103, 12, (s, x, z, r, depth) => {
      if (this.blocked(x, z, 1)) return;
      const bank = s.riverD < 26 ? 0.22 : 0;
      const k = r.next();
      if (k < 0.07 + bank + s.border * 0.25) put(K.Rock, x, s.h, z, r, r.range(0.5, 2.2) * (1 + s.border));
      else if (k < 0.07 + bank + s.forest * 0.16 && depth < -0.3) put(K.Log, x, s.h, z, r, r.range(0.7, 1.3));
    });
    // reeds along shallow margins
    pass(104, 3, (s, x, z, r, depth) => {
      if (depth < -0.45 || depth > 0.4) return;
      const p = s.wetland * 0.55 + (s.riverD < 30 ? 0.18 : 0);
      if (r.next() < p) put(K.Reed, x, s.h, z, r, r.range(0.7, 1.4));
    });
    // persistent human debris
    pass(105, 8, (s, x, z, r, depth) => {
      if (depth > -0.2 || this.blocked(x, z, 0.5)) return;
      const k = r.next();
      if (k < s.dump * 0.42) put(K.Scrap, x, s.h, z, r, r.range(0.7, 1.9));
      else if (k < s.dump * 0.62) put(K.Barrel, x, s.h, z, r, r.range(0.9, 1.1));
      else if (k < s.dump * 0.9 + s.settlement * 0.03) put(K.Tire, x, s.h, z, r, r.range(0.9, 1.2));
      else if (k > 1 - s.settlement * 0.2) put(K.Rubble, x, s.h, z, r, r.range(0.6, 1.6));
    });
    pass(106, 3.6, (s, x, z, r, depth) => {
      // plastics: dense in the dump, sparse flood-line litter along the river and in the settlement
      const p = s.dump * 0.5 + s.settlement * 0.04 + (s.riverD < 22 && depth < 0 ? 0.035 : 0);
      if (depth > 0.1 || r.next() > p) return;
      put(K.Plastic, x, s.h, z, r, r.range(0.6, 1.6));
    });
    const arr = new Float32Array(out);
    this.scatterCache.set(key, arr);
    return arr;
  }

  /** Perching sites (tree crowns, roof lines) in one chunk. */
  perches(cx: number, cz: number): Perch[] {
    const key = (cx + 64) * 256 + (cz + 64);
    let list = this.perchCache.get(key);
    if (list) return list;
    list = [];
    const sc = this.scatter(cx, cz);
    for (let i = 0; i < sc.length; i += SCATTER_STRIDE) {
      const k = sc[i]!;
      if (k === ScatterKind.TreeBroad || k === ScatterKind.TreeTall || k === ScatterKind.Snag) {
        const base = k === ScatterKind.TreeTall ? 11 : k === ScatterKind.Snag ? 6.5 : 7;
        list.push({ x: sc[i + 1]!, z: sc[i + 3]!, h: base * sc[i + 5]! * 0.78 });
      }
    }
    for (const b of this.buildings) {
      if (Math.floor(b.x / CHUNK_SIZE) === cx && Math.floor(b.z / CHUNK_SIZE) === cz) list.push({ x: b.x, z: b.z, h: b.h * (1 - b.collapse * 0.4) });
    }
    this.perchCache.set(key, list);
    return list;
  }

  /** Nearest-ish perch around a point, chosen deterministically from `pick` in [0,1). */
  findPerch(x: number, z: number, pick: number): Perch | null {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    let best: Perch | null = null;
    let bestScore = 1e18;
    let n = 0;
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        if (i < 0 || j < 0 || i >= CHUNKS || j >= CHUNKS) continue;
        for (const p of this.perches(i, j)) {
          // distance plus a deterministic shuffle so a flock spreads over several trees
          const jitter = ((hash3(n++, (pick * 65536) | 0, 3) & 1023) / 1023) * 45;
          const sc = Math.hypot(p.x - x, p.z - z) + jitter;
          if (sc < bestScore) {
            bestScore = sc;
            best = p;
          }
        }
      }
    }
    return best;
  }
}
