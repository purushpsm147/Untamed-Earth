import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash3f } from '@untamed/core';

export type RGB = [number, number, number];

/** Accumulates transformed, vertex-coloured primitives and merges them into one geometry. */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  /**
   * @param shade 0..1 strength of a vertical gradient (darker at the bottom): cheap baked ambient occlusion.
   * @param jitter per-vertex brightness noise.
   */
  add(geo: THREE.BufferGeometry, color: RGB, pos: RGB, rot: RGB = [0, 0, 0], scale: RGB | number = 1, shade = 0, jitter = 0, attrs?: Record<string, number[]>): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    this.m.compose(new THREE.Vector3(...pos), this.q.setFromEuler(this.e.set(rot[0], rot[1], rot[2])), new THREE.Vector3(s[0], s[1], s[2]));
    g.applyMatrix4(this.m);
    const p = g.attributes.position!;
    const n = p.count;
    g.computeBoundingBox();
    const y0 = g.boundingBox!.min.y;
    const y1 = Math.max(g.boundingBox!.max.y, y0 + 1e-4);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = (p.getY(i) - y0) / (y1 - y0);
      const k = (1 - shade * (1 - t)) * (1 + (hash3f(Math.round(p.getX(i) * 31), Math.round(p.getY(i) * 31), Math.round(p.getZ(i) * 31)) - 0.5) * jitter);
      col[i * 3] = color[0] * k;
      col[i * 3 + 1] = color[1] * k;
      col[i * 3 + 2] = color[2] * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    if (attrs) {
      for (const [name, v] of Object.entries(attrs)) {
        const arr = new Float32Array(n * v.length);
        for (let i = 0; i < n; i++) arr.set(v, i * v.length);
        g.setAttribute(name, new THREE.BufferAttribute(arr, v.length));
      }
    }
    this.parts.push(g);
    return this;
  }

  /** Recolour vertices of the most recently added part with a predicate (spots, stripes, patches). */
  paint(fn: (x: number, y: number, z: number) => RGB | null): this {
    const g = this.parts[this.parts.length - 1]!;
    const p = g.attributes.position!;
    const c = g.attributes.color!;
    for (let i = 0; i < p.count; i++) {
      const r = fn(p.getX(i), p.getY(i), p.getZ(i));
      if (r) c.setXYZ(i, r[0], r[1], r[2]);
    }
    return this;
  }

  build(extraAttrs: Record<string, number> = {}): THREE.BufferGeometry {
    // every part must carry the same attribute set before merging
    for (const g of this.parts) {
      for (const [name, size] of Object.entries(extraAttrs)) {
        if (!g.attributes[name]) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * size), size));
      }
    }
    const out = mergeGeometries(this.parts, false)!;
    for (const g of this.parts) g.dispose();
    this.parts = [];
    out.computeBoundingSphere();
    return out;
  }
}

/** Lumpy blob: an icosphere whose vertices are pushed in and out by hashed noise (foliage, rocks, mounds). */
export function blob(radius: number, detail: number, seed: number, rough: number, smooth = false): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (hash3f(Math.round(x * 53) + seed, Math.round(y * 53), Math.round(z * 53)) - 0.5) * rough;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  if (smooth) {
    const n = g.attributes.normal!;
    for (let i = 0; i < p.count; i++) {
      const l = Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) || 1;
      n.setXYZ(i, p.getX(i) / l, p.getY(i) / l, p.getZ(i) / l);
    }
  }
  return g;
}

export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 6): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg, 1);
