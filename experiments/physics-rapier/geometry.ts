/**
 * Shared obstacle geometry for the physics experiment, derived ONLY from the world model the simulation already uses
 * (packages/worlds): building footprints (rotated rectangles + height), the analytic terrain, and scatter objects
 * (tree trunks, snags, rocks, logs) from the deterministic per-chunk scatter. No second world description.
 */
import { CHUNK_SIZE, SCATTER_STRIDE, ScatterKind, type Valley } from '@untamed/worlds';

export interface Circle { x: number; z: number; r: number; h: number; kind: 'trunk' | 'snag' | 'rock' | 'log' }

/** Solid scatter objects near a point, as vertical cylinders (radius at ground level, height). */
export function scatterSolids(v: Valley, x: number, z: number, radius: number): Circle[] {
  const out: Circle[] = [];
  const K = ScatterKind;
  for (let cz = Math.floor((z - radius) / CHUNK_SIZE); cz <= Math.floor((z + radius) / CHUNK_SIZE); cz++) {
    for (let cx = Math.floor((x - radius) / CHUNK_SIZE); cx <= Math.floor((x + radius) / CHUNK_SIZE); cx++) {
      const sc = v.scatter(cx, cz);
      for (let i = 0; i < sc.length; i += SCATTER_STRIDE) {
        const k = sc[i]!;
        const ox = sc[i + 1]!;
        const oz = sc[i + 3]!;
        if ((ox - x) ** 2 + (oz - z) ** 2 > radius * radius) continue;
        const s = sc[i + 5]!;
        // trunk/rock radii from the rendered models (scatterGeo.ts): broadleaf trunk 0.34, tall 0.3, snag 0.3,
        // rock blob 0.8 x 1.2 (radius ~0.96), log 4.2 m long x 0.3 (approximated by a 1.2 m disc)
        if (k === K.TreeBroad) out.push({ x: ox, z: oz, r: 0.34 * s, h: 4 * s, kind: 'trunk' });
        else if (k === K.TreeTall) out.push({ x: ox, z: oz, r: 0.3 * s, h: 8 * s, kind: 'trunk' });
        else if (k === K.Snag) out.push({ x: ox, z: oz, r: 0.3 * s, h: 6.4 * s, kind: 'snag' });
        else if (k === K.Rock && s >= 0.8) out.push({ x: ox, z: oz, r: 0.96 * s, h: 0.85 * s, kind: 'rock' }); // small rocks are steppable
        else if (k === K.Log) out.push({ x: ox, z: oz, r: 1.2 * s, h: 0.55 * s, kind: 'log' });
      }
    }
  }
  return out;
}
