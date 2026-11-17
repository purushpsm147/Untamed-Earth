/**
 * Valley boundary audit (issue #29, step 1; read-only). Attach to a Simulation, call afterStep(dt) after every
 * sim.step(dt), then summary(). It reads animal, territory and terrain state and subscribes to the existing kill/death
 * events. It never writes simulation state and never draws from either random stream
 * (tests/unit/boundary-audit.test.ts proves identical state hash and RNG streams with it attached).
 *
 * Question it answers: what happens today when an animal approaches a map edge, and does the closed edge distort
 * space use, predation or territory geometry? Interpretation lives in docs/OPEN_BOUNDARY_AUDIT.md, not here.
 *
 * Distance to edge: d = min(x, z, R - x, R - z). Bands are compared with their share of the region's area and with
 * their share of *walkable* area (dry, outside ruins, grade the steering accepts, inside the 6 m hard wall), because
 * the valley generator raises border ridges, so the outer bands are partly unwalkable by design.
 */
import { B, SPECIES, TIME_SCALE, type Simulation } from '@untamed/ecology';
import { REGION_SIZE } from '@untamed/worlds';

const R = REGION_SIZE;
const NS = SPECIES.length;
/** Band edges in metres from the nearest map edge. The last band reaches the centre (R / 2). */
export const BANDS = [0, 8, 30, 60, 120, 240, R / 2] as const;
const NB = BANDS.length - 1;
const MAX_GRADE = 0.95;
const edgeDist = (x: number, z: number): number => Math.min(x, z, R - x, R - z);
const bandOf = (d: number): number => {
  for (let b = NB - 1; b >= 0; b--) if (d >= BANDS[b]!) return b;
  return 0;
};
/** Area of the square annulus between distances a and b from the edge. */
const bandArea = (a: number, b: number): number => (R - 2 * a) ** 2 - (R - 2 * b) ** 2;

type Priv = { insideBuilding(x: number, z: number): boolean };

export interface BoundarySummary {
  days: number;
  bands: readonly number[];
  bandAreaShare: number[];
  bandWalkableShare: number[];
  /** Walkable fraction of each band (dry, not a ruin, grade <= 0.95, inside the 6 m wall). */
  bandWalkableFraction: number[];
  /** Per species: animal-hours per band. */
  occupancyH: Record<string, number[]>;
  /** Per species: occupancy share / walkable-area share per band (1 = uniform over walkable ground). */
  occupancyVsWalkable: Record<string, number[]>;
  /** Animal-hours within 8 m of the edge while trying to move (want > 0) but nearly stationary (< 0.05 m/s). */
  wallPinnedH: Record<string, number>;
  /** Animal-hours within 8 m of the edge at all. */
  wallContactH: Record<string, number>;
  /** Positions outside [0, R] (must be 0). */
  outOfRegion: number;
  /** Flee episodes started, and those whose 70 m target was clamped by the 8 m edge clamp. */
  fleeStarts: Record<string, number>;
  fleeTargetClamped: Record<string, number>;
  /** Flee episodes ending within 30 m of the edge. */
  fleeEndsNearEdge: Record<string, number>;
  /** Per prey species: kills per band. */
  killsByBand: Record<string, number[]>;
  /** Per prey species: kill share / occupancy share per band (> 1 = kills concentrated in that band). */
  killRiskByBand: Record<string, number[]>;
  /** Deaths of any cause per band, per species. */
  deathsByBand: Record<string, number[]>;
  territory: {
    /** Daily samples of held territories. */
    samples: number;
    /** Mean distance from centre to edge (m), and minimum seen. */
    centreEdgeMean: number;
    centreEdgeMin: number;
    /** Mean fraction of the exclusive disc (radius spacing / 2) lying outside the region. */
    discOutsideMean: number;
    /** Share of territory-days whose exclusive disc crosses the edge at all. */
    discCrossesEdgeShare: number;
    /** Mean fraction of the disc that is walkable valley ground (inside region, dry, grade ok). */
    discWalkableMean: number;
  };
  /** Water at the edge: share of edge-wall cells (d < 8) that are water deeper than 0.02 m at stage 0. */
  edgeWaterShare: number;
}

export class BoundaryAudit {
  private readonly walk: Uint8Array; // walkability on a 4 m grid
  private readonly G = 4;
  private readonly N: number;
  private readonly occ = SPECIES.map(() => new Array<number>(NB).fill(0));
  private readonly pinned = new Array<number>(NS).fill(0);
  private readonly contact = new Array<number>(NS).fill(0);
  private readonly fleeStart = new Array<number>(NS).fill(0);
  private readonly fleeClamp = new Array<number>(NS).fill(0);
  private readonly fleeEdge = new Array<number>(NS).fill(0);
  private readonly kills = SPECIES.map(() => new Array<number>(NB).fill(0));
  private readonly deaths = SPECIES.map(() => new Array<number>(NB).fill(0));
  private readonly prevBeh = new Map<number, number>();
  private out = 0;
  private hours = 0;
  private lastDay = -1;
  private tSamples = 0;
  private tEdgeSum = 0;
  private tEdgeMin = Infinity;
  private tOutSum = 0;
  private tCross = 0;
  private tWalkSum = 0;
  private readonly bandWalk = new Array<number>(NB).fill(0);
  private readonly bandCells = new Array<number>(NB).fill(0);
  private edgeWater = 0;
  private edgeCells = 0;
  private readonly unsub: () => void;

  constructor(private readonly sim: Simulation) {
    const v = sim.valley;
    const G = this.G;
    this.N = Math.floor(R / G);
    this.walk = new Uint8Array(this.N * this.N);
    const inside = (sim as unknown as Priv).insideBuilding.bind(sim);
    for (let j = 0; j < this.N; j++) {
      for (let i = 0; i < this.N; i++) {
        const x = (i + 0.5) * G;
        const z = (j + 0.5) * G;
        const d = edgeDist(x, z);
        const b = bandOf(d);
        const wet = v.waterDepth(x, z, 0) > 0.02;
        const gx = (v.height(x + 1, z) - v.height(x - 1, z)) / 2;
        const gz = (v.height(x, z + 1) - v.height(x, z - 1)) / 2;
        const ok = d >= 6 && !wet && !inside(x, z) && Math.hypot(gx, gz) <= MAX_GRADE;
        this.walk[j * this.N + i] = ok ? 1 : 0;
        this.bandCells[b]!++;
        if (ok) this.bandWalk[b]!++;
        if (d < 8) {
          this.edgeCells++;
          if (wet) this.edgeWater++;
        }
      }
    }
    this.unsub = sim.events.on((e) => {
      if (e.type === 'kill') this.kills[e.sp]![bandOf(edgeDist(e.x, e.z))]!++;
      else if (e.type === 'death') this.deaths[e.sp]![bandOf(edgeDist(e.x, e.z))]!++;
    });
  }

  dispose(): void {
    this.unsub();
  }

  private walkable(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= R || z >= R) return false;
    return this.walk[Math.floor(z / this.G) * this.N + Math.floor(x / this.G)] === 1;
  }

  afterStep(dt: number): void {
    const h = (dt * TIME_SCALE) / 3600;
    this.hours += h;
    for (const a of this.sim.animals) {
      if (!a.alive) continue;
      if (!(a as { transit?: number }).transit && (a.x < 0 || a.z < 0 || a.x > R || a.z > R)) this.out++; // animals in boundary transit are allowed in the corridor
      const d = edgeDist(a.x, a.z);
      this.occ[a.sp]![bandOf(d)]! += h;
      if (d < 8) {
        this.contact[a.sp]! += h;
        if (a.want > 0 && a.speed < 0.05 && a.alt < 0.25) this.pinned[a.sp]! += h;
      }
      const prev = this.prevBeh.get(a.id);
      if (a.beh === B.Flee && prev !== B.Flee) {
        this.fleeStart[a.sp]!++;
        if (a.tx <= 8 || a.tz <= 8 || a.tx >= R - 8 || a.tz >= R - 8) this.fleeClamp[a.sp]!++;
      } else if (prev === B.Flee && a.beh !== B.Flee && d < 30) this.fleeEdge[a.sp]!++;
      this.prevBeh.set(a.id, a.beh);
    }
    const day = Math.floor(this.sim.env.timeH / 24);
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.sampleTerritories();
    }
  }

  private sampleTerritories(): void {
    for (const t of ((this.sim as unknown as { territories?: Map<number, { sp: number; x: number; z: number }> }).territories?.values() ?? [])) {
      const r = ((SPECIES[t.sp] as { territory?: { spacing: number } }).territory?.spacing ?? 0) / 2;
      if (r <= 0) continue;
      const d = edgeDist(t.x, t.z);
      this.tSamples++;
      this.tEdgeSum += d;
      this.tEdgeMin = Math.min(this.tEdgeMin, d);
      if (d < r) this.tCross++;
      // deterministic 16 m lattice over the disc
      let n = 0;
      let outN = 0;
      let walkN = 0;
      for (let dz = -r; dz <= r; dz += 16) {
        for (let dx = -r; dx <= r; dx += 16) {
          if (dx * dx + dz * dz > r * r) continue;
          n++;
          const x = t.x + dx;
          const z = t.z + dz;
          if (x < 0 || z < 0 || x > R || z > R) outN++;
          else if (this.walkable(x, z)) walkN++;
        }
      }
      this.tOutSum += outN / n;
      this.tWalkSum += walkN / n;
    }
  }

  summary(): BoundarySummary {
    const totalArea = R * R;
    const areaShare = Array.from({ length: NB }, (_, b) => bandArea(BANDS[b]!, BANDS[b + 1]!) / totalArea);
    const walkTotal = this.bandWalk.reduce((s, v) => s + v, 0);
    const walkShare = this.bandWalk.map((v) => v / walkTotal);
    const rec = <T>(f: (si: number) => T): Record<string, T> => Object.fromEntries(SPECIES.map((s, si) => [s.id, f(si)]));
    const share = (row: number[]): number[] => {
      const s = row.reduce((p, v) => p + v, 0);
      return row.map((v) => (s > 0 ? v / s : 0));
    };
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    return {
      days: r3(this.hours / 24),
      bands: BANDS,
      bandAreaShare: areaShare.map(r3),
      bandWalkableShare: walkShare.map(r3),
      bandWalkableFraction: this.bandWalk.map((v, b) => r3(v / this.bandCells[b]!)),
      occupancyH: rec((si) => this.occ[si]!.map(r3)),
      occupancyVsWalkable: rec((si) => share(this.occ[si]!).map((v, b) => r3(walkShare[b]! > 0 ? v / walkShare[b]! : 0))),
      wallPinnedH: rec((si) => r3(this.pinned[si]!)),
      wallContactH: rec((si) => r3(this.contact[si]!)),
      outOfRegion: this.out,
      fleeStarts: rec((si) => this.fleeStart[si]!),
      fleeTargetClamped: rec((si) => this.fleeClamp[si]!),
      fleeEndsNearEdge: rec((si) => this.fleeEdge[si]!),
      killsByBand: rec((si) => [...this.kills[si]!]),
      killRiskByBand: rec((si) => {
        const k = share(this.kills[si]!);
        const o = share(this.occ[si]!);
        return k.map((v, b) => r3(o[b]! > 0 ? v / o[b]! : 0));
      }),
      deathsByBand: rec((si) => [...this.deaths[si]!]),
      territory: {
        samples: this.tSamples,
        centreEdgeMean: r3(this.tSamples ? this.tEdgeSum / this.tSamples : NaN),
        centreEdgeMin: r3(this.tEdgeMin),
        discOutsideMean: r3(this.tSamples ? this.tOutSum / this.tSamples : NaN),
        discCrossesEdgeShare: r3(this.tSamples ? this.tCross / this.tSamples : NaN),
        discWalkableMean: r3(this.tSamples ? this.tWalkSum / this.tSamples : NaN),
      },
      edgeWaterShare: r3(this.edgeWater / this.edgeCells),
    };
  }
}
