import { clamp01, fbm, lerp, smoothstep } from '@untamed/core';
import { CHUNK_SIZE, Valley } from './valley';

export interface ChunkMeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** rgb = albedo, a = "grassiness" (how strongly seasonal drying tints this vertex). */
  colors: Float32Array;
  indices: Uint32Array;
}

const mix3 = (o: number[], r: number, g: number, b: number, t: number): void => {
  o[0] = lerp(o[0]!, r, t);
  o[1] = lerp(o[1]!, g, t);
  o[2] = lerp(o[2]!, b, t);
};

/**
 * Builds renderable terrain for one chunk at `res` quads per side, with a downward skirt
 * that hides cracks between neighbouring chunks at different levels of detail.
 * Pure function of (seed, cx, cz, res): safe to run in a Web Worker.
 */
export function buildChunkMesh(v: Valley, cx: number, cz: number, res: number): ChunkMeshData {
  const n = res + 1;
  const step = CHUNK_SIZE / res;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  // heights with a one-sample apron so normals match across chunk borders
  const m = n + 2;
  const hs = new Float32Array(m * m);
  const vertCount = n * n + 4 * n;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 4);
  const col = [0, 0, 0];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const x = x0 + (i - 1) * step;
      const z = z0 + (j - 1) * step;
      const s = v.sample(x, z);
      hs[j * m + i] = s.h;
      if (i === 0 || j === 0 || i === m - 1 || j === m - 1) continue;
      const k = (j - 1) * n + (i - 1);
      positions[k * 3] = x;
      positions[k * 3 + 1] = s.h;
      positions[k * 3 + 2] = z;
      // --- albedo ---
      const n1 = fbm(v.seed + 31, x / 23, z / 23, 3);
      const n2 = fbm(v.seed + 32, x / 5.5, z / 5.5, 2);
      const depth = v.waterSurface(z) - s.h;
      col[0] = 0.33 + n1 * 0.1; col[1] = 0.44 + n1 * 0.12; col[2] = 0.17; // meadow grass
      let grass = 1;
      mix3(col, 0.2 + n2 * 0.07, 0.25 + n1 * 0.08, 0.11, s.forest * 0.85); // forest floor litter
      mix3(col, 0.27, 0.3 + n1 * 0.06, 0.16, s.wetland * 0.8);
      mix3(col, 0.36 + n2 * 0.08, 0.37 + n1 * 0.06, 0.25, s.settlement * 0.45);
      mix3(col, 0.36 + n2 * 0.12, 0.31 + n2 * 0.06, 0.26, s.dump * 0.85);
      grass *= 1 - s.dump * 0.7 - s.forest * 0.5;
      // roads: century-old asphalt, broken by root heave and colonised along the cracks
      const crack = smoothstep(0.42, 0.62, n2) * 0.75 + smoothstep(0.5, 0.75, n1) * 0.4;
      const roadT = smoothstep(4.2, 2.6, s.road) * (1 - clamp01(crack)) * (1 - smoothstep(0.1, 0.5, s.border));
      mix3(col, 0.23 + n2 * 0.05, 0.23 + n2 * 0.05, 0.22 + n2 * 0.04, roadT);
      grass *= 1 - roadT;
      // banks, shallows and the river bed
      const shore = smoothstep(-0.7, -0.05, depth);
      mix3(col, 0.38 + n2 * 0.06, 0.33 + n2 * 0.05, 0.24, shore * 0.8);
      mix3(col, 0.16, 0.17, 0.13, smoothstep(0, 0.8, depth));
      grass *= 1 - shore;
      // contaminated ground around leachate pools
      const pi = s.dump > 0.2 ? v.poolAt(x, z) : -1;
      if (pi >= 0) mix3(col, 0.3, 0.24, 0.1, 0.8);
      colors[k * 4] = col[0]!;
      colors[k * 4 + 1] = col[1]!;
      colors[k * 4 + 2] = col[2]!;
      colors[k * 4 + 3] = clamp01(grass);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = (j + 1) * m + (i + 1);
      const nx = hs[c - 1]! - hs[c + 1]!;
      const nz = hs[c - m]! - hs[c + m]!;
      const ny = 2 * step;
      const l = Math.hypot(nx, ny, nz);
      const k = j * n + i;
      normals[k * 3] = nx / l;
      normals[k * 3 + 1] = ny / l;
      normals[k * 3 + 2] = nz / l;
      // exposed rock on steep faces
      const steep = smoothstep(0.82, 0.62, ny / l);
      if (steep > 0) {
        colors[k * 4] = lerp(colors[k * 4]!, 0.36, steep);
        colors[k * 4 + 1] = lerp(colors[k * 4 + 1]!, 0.34, steep);
        colors[k * 4 + 2] = lerp(colors[k * 4 + 2]!, 0.31, steep);
        colors[k * 4 + 3] = colors[k * 4 + 3]! * (1 - steep);
      }
    }
  }
  // skirts: duplicate the border ring, dropped by a LOD-proportional amount
  const drop = step * 1.5 + 1;
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(i); // north edge (j=0)
  for (let i = 0; i < n; i++) ring.push((n - 1) * n + i); // south
  for (let j = 0; j < n; j++) ring.push(j * n); // west
  for (let j = 0; j < n; j++) ring.push(j * n + n - 1); // east
  for (let r = 0; r < ring.length; r++) {
    const src = ring[r]!;
    const dst = n * n + r;
    positions[dst * 3] = positions[src * 3]!;
    positions[dst * 3 + 1] = positions[src * 3 + 1]! - drop;
    positions[dst * 3 + 2] = positions[src * 3 + 2]!;
    normals.set(normals.subarray(src * 3, src * 3 + 3), dst * 3);
    colors.set(colors.subarray(src * 4, src * 4 + 4), dst * 4);
  }
  const indices = new Uint32Array(res * res * 6 + 4 * res * 6);
  let q = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i;
      indices[q++] = a; indices[q++] = a + n; indices[q++] = a + 1;
      indices[q++] = a + 1; indices[q++] = a + n; indices[q++] = a + n + 1;
    }
  }
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < res; i++) {
      const a = ring[side * n + i]!;
      const b = ring[side * n + i + 1]!;
      const c = n * n + side * n + i;
      const d = c + 1;
      // winding differs per side so skirts face outward; double-sided cost is avoided
      if (side === 0 || side === 3) {
        indices[q++] = a; indices[q++] = b; indices[q++] = c;
        indices[q++] = b; indices[q++] = d; indices[q++] = c;
      } else {
        indices[q++] = a; indices[q++] = c; indices[q++] = b;
        indices[q++] = b; indices[q++] = c; indices[q++] = d;
      }
    }
  }
  return { positions, normals, colors, indices };
}
