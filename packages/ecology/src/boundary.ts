/**
 * Open valley boundary (issue #29): configuration, counters and geometry. The design, its pre-registered assumptions
 * and the owner decisions are in docs/OPEN_BOUNDARY_DESIGN.md; nothing here is tuned to outcomes.
 */
import { CORRIDOR, REGION_SIZE } from '@untamed/worlds';

export interface BoundaryConfig {
  /** Off-map regional population and crossings exist at all. false = the closed valley (#28 behaviour, hashes unchanged). */
  open: boolean;
  /** Off-map animals may enter the valley (false = zero-inflow control E: exits still happen). */
  inflow: boolean;
  /** Fleeing animals may exit through the corridor (false = no-flee-exit control F). */
  fleeExit: boolean;
  /** Width of the regional ring around the valley, m (pre-registered 1,440; sensitivity 720 / 2,160). */
  ringW: number;
  /** Multiplier on the off-map hare density (pre-registered 1; sensitivity 0.5 / 1.5). */
  hareCapacity: number;
  /** Probability that an attempted crossing at a physically passable point proceeds (pre-registered 2/3; sensitivity 1/3 / 1). */
  connectivity: number;
  /** Multiplier on the off-map background hazard (pre-registered 1; sensitivity 2: off-map has no explicit predation). */
  offmapHazard: number;
}

export const CLOSED_BOUNDARY: Readonly<BoundaryConfig> = { open: false, inflow: true, fleeExit: true, ringW: 1440, hareCapacity: 1, connectivity: 2 / 3, offmapHazard: 1 };
/** Species enabled for migration in the first experiment (owner decision 2). */
export const MIGRANT_SPECIES: readonly string[] = ['jackal', 'hare'];
/** Depth of the off-map hare strip, m (2 x the model's hare home range). */
export const HARE_STRIP = 260;
/** Hours a newcomer hare must spend in the valley before its home range moves inside (settlement). */
export const HARE_SETTLE_H = 48;
/** Edge sector length for off-map suitability, m. */
export const SECTOR = 120;

export type ExitKind = 'excursion' | 'emigration' | 'flee';
export interface MigrationStats {
  /** Per species index. */
  exitExcursion: number[];
  exitEmigration: number[];
  exitFlee: number[];
  /** Entries of resident-lineage animals coming back. */
  entryReturn: number[];
  /** Entries of regional-lineage animals (visitors until they settle). */
  entryVisit: number[];
  /** Regional-lineage animals that established residence in the valley. */
  settled: number[];
  /** Left the regional landscape for good (not deaths). */
  departed: number[];
  offBirths: number[];
  offDeathsBackground: number[];
  offDeathsAge: number[];
  offDeathsPredation: number[];
  /** Pursuits that continued past the corridor's outer line, by outcome. */
  pursuitCaptured: number[];
  pursuitEscaped: number[];
  /** Crossing attempts refused (impassable point or connectivity draw), and entries suppressed by the zero-inflow control. */
  refused: number[];
  suppressed: number[];
  initialRegional: number[];
  /** Exits begun into the corridor that turned back before the outer line (e.g. a flight that ended once safe). */
  exitAborted: number[];
}

export function emptyMigrationStats(ns: number): MigrationStats {
  const z = (): number[] => new Array<number>(ns).fill(0);
  return {
    exitExcursion: z(), exitEmigration: z(), exitFlee: z(), entryReturn: z(), entryVisit: z(), settled: z(), departed: z(), offBirths: z(),
    offDeathsBackground: z(), offDeathsAge: z(), offDeathsPredation: z(), pursuitCaptured: z(), pursuitEscaped: z(), refused: z(), suppressed: z(), initialRegional: z(), exitAborted: z(),
  };
}

const R = REGION_SIZE;
/** Signed distance to the region edge: positive inside, negative outside (Euclidean outside the corners). */
export function edgeSigned(x: number, z: number): number {
  const dx = Math.max(-x, x - R, 0);
  const dz = Math.max(-z, z - R, 0);
  return dx > 0 || dz > 0 ? -Math.hypot(dx, dz) : Math.min(x, z, R - x, R - z);
}
export const insideRegion = (x: number, z: number): boolean => x >= 0 && z >= 0 && x <= R && z <= R;
/** Inside the regional landscape (valley + ring of width w). */
export const insideLandscape = (x: number, z: number, w: number): boolean => x >= -w && z >= -w && x <= R + w && z <= R + w;

/** Outward unit normal of the edge nearest to (x, z) (by the largest violation outside, smallest distance inside). */
export function outwardNormal(x: number, z: number): [number, number] {
  const d = [x, z, R - x, R - z];
  let k = 0;
  for (let i = 1; i < 4; i++) if (d[i]! < d[k]!) k = i;
  return k === 0 ? [-1, 0] : k === 1 ? [0, -1] : k === 2 ? [1, 0] : [0, 1];
}

/** Edge sector index (4 edges x ceil(R / SECTOR) sectors) of the edge nearest to (x, z). */
export function sectorOf(x: number, z: number): number {
  const n = Math.ceil(R / SECTOR);
  const [nx, nz] = outwardNormal(x, z);
  const along = nx !== 0 ? z : x;
  const e = nx === -1 ? 0 : nz === -1 ? 1 : nx === 1 ? 2 : 3;
  return e * n + Math.min(n - 1, Math.max(0, Math.floor(along / SECTOR)));
}
export const SECTORS = 4 * Math.ceil(R / SECTOR);

/**
 * Where the segment P -> Q first crosses into the square [-c, R + c] (the corridor's outer line), or null. P is outside.
 */
export function entryPoint(px: number, pz: number, qx: number, qz: number, c = CORRIDOR): [number, number] | null {
  const lo = -c;
  const hi = R + c;
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dz = qz - pz;
  for (const [p, q] of [[-dx, px - lo], [dx, hi - px], [-dz, pz - lo], [dz, hi - pz]] as const) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  if (t0 <= 0 || t0 > 1) return null;
  return [px + dx * t0, pz + dz * t0];
}
