import * as THREE from 'three';
import { Rng } from '@untamed/core';
import { ScatterKind } from '@untamed/worlds';
import { GeoBuilder, RGB, blob, box, cyl } from './geo';

export interface ScatterModel {
  hi: THREE.BufferGeometry;
  /** Optional far representation. */
  lo?: THREE.BufferGeometry;
  /** Sways in the wind. */
  foliage: boolean;
  shadow: boolean;
  /** Fraction of the vegetation draw distance at which this kind is culled. */
  range: number;
  max: number;
}

const BARK: RGB = [0.23, 0.17, 0.12];
const K = ScatterKind;

function broadleaf(detail: number, blobs: number, seed: number): THREE.BufferGeometry {
  const r = new Rng(seed);
  const b = new GeoBuilder();
  const seg = detail > 0 ? 7 : 4;
  b.add(cyl(0.16, 0.34, 3.4, seg), BARK, [0, 1.7, 0], [0, 0, 0.04], 1, 0.25, 0.25);
  if (detail > 0) {
    b.add(cyl(0.07, 0.13, 2.2, 5), BARK, [0.55, 3.6, 0.1], [0.1, 0, -0.75]);
    b.add(cyl(0.06, 0.12, 2.0, 5), BARK, [-0.45, 3.7, -0.3], [-0.4, 0, 0.7]);
  }
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * 6.283 + r.range(0, 0.8);
    const ring = i === 0 ? 0 : r.range(1.0, 2.0);
    const g: RGB = [0.1 + r.range(0, 0.05), 0.27 + r.range(0, 0.1), 0.07 + r.range(0, 0.03)];
    b.add(blob(r.range(1.25, 1.75), detail, seed + i, 0.5, true), g, [Math.cos(a) * ring, i === 0 ? 6.1 : r.range(4.3, 5.6), Math.sin(a) * ring], [0, r.range(0, 6), 0], [1.15, 0.78, 1.15], 0.6, 0.3);
  }
  return b.build();
}

function tallTree(detail: number, seed: number): THREE.BufferGeometry {
  const r = new Rng(seed);
  const b = new GeoBuilder();
  b.add(cyl(0.14, 0.3, 8, detail > 0 ? 7 : 4), [0.3, 0.25, 0.2], [0, 4, 0], [0, 0, 0], 1, 0.2, 0.2);
  const n = detail > 0 ? 5 : 3;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const g: RGB = [0.12 + r.range(0, 0.05), 0.3 + r.range(0, 0.08), 0.1];
    b.add(blob(1.5 - t * 0.5, detail, seed + i * 7, 0.45, true), g, [r.range(-0.5, 0.5), 6.4 + t * 4.4, r.range(-0.5, 0.5)], [0, r.range(0, 6), 0], [1.1, 0.95, 1.1], 0.55, 0.3);
  }
  return b.build();
}

function snag(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const c: RGB = [0.36, 0.33, 0.3];
  b.add(cyl(0.1, 0.3, 6.4, 6), c, [0, 3.2, 0], [0, 0, 0.05], 1, 0.3, 0.3);
  b.add(cyl(0.03, 0.09, 2.2, 4), c, [0.7, 4.3, 0], [0, 0, -1.0]);
  b.add(cyl(0.03, 0.08, 1.7, 4), c, [-0.5, 5.1, 0.2], [0.3, 0, 0.9]);
  b.add(cyl(0.02, 0.06, 1.2, 4), c, [0.1, 3.2, -0.5], [-1.0, 0, 0.1]);
  return b.build();
}

function shrub(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(blob(0.75, 1, 3, 0.55, true), [0.14, 0.31, 0.09], [0, 0.55, 0], [0, 0, 0], [1.2, 0.85, 1.1], 0.6, 0.3);
  b.add(blob(0.5, 0, 5, 0.5, true), [0.17, 0.35, 0.1], [0.55, 0.45, 0.25], [0, 1, 0], 1, 0.6, 0.3);
  b.add(blob(0.45, 0, 8, 0.5, true), [0.12, 0.28, 0.1], [-0.45, 0.4, -0.35], [0, 2, 0], 1, 0.6, 0.3);
  return b.build();
}

function reed(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const r = new Rng(77);
  for (let i = 0; i < 8; i++) {
    const h = r.range(1.1, 2.0);
    b.add(new THREE.ConeGeometry(0.035, h, 3, 1), [0.42, 0.47, 0.2], [r.range(-0.5, 0.5), h / 2 - 0.15, r.range(-0.5, 0.5)], [r.range(-0.15, 0.15), 0, r.range(-0.15, 0.15)], 1, 0.5, 0.2);
    if (i % 3 === 0) b.add(cyl(0.05, 0.05, 0.22, 4), [0.3, 0.2, 0.12], [r.range(-0.4, 0.4), h * 0.8, r.range(-0.4, 0.4)]);
  }
  return b.build();
}

function log(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(cyl(0.24, 0.3, 4.2, 6), [0.27, 0.22, 0.16], [0, 0.2, 0], [0, 0, Math.PI / 2], 1, 0, 0.3);
  b.add(blob(0.35, 0, 2, 0.5), [0.2, 0.34, 0.12], [0.6, 0.38, 0], [0, 0, 0], [1.6, 0.35, 0.8]);
  b.add(blob(0.3, 0, 4, 0.5), [0.22, 0.36, 0.12], [-1.0, 0.36, 0.05], [0, 0, 0], [1.3, 0.35, 0.8]);
  return b.build();
}

function scrap(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const r = new Rng(31);
  const rust: RGB[] = [[0.42, 0.22, 0.12], [0.33, 0.19, 0.12], [0.3, 0.29, 0.28], [0.45, 0.3, 0.16], [0.22, 0.27, 0.3]];
  for (let i = 0; i < 9; i++) {
    const c = rust[r.int(rust.length)]!;
    const plate = r.chance(0.5);
    b.add(box(plate ? r.range(0.8, 1.8) : r.range(0.3, 0.8), plate ? 0.05 : r.range(0.2, 0.6), r.range(0.4, 1.2)), c,
      [r.range(-1, 1), r.range(0.1, 0.9), r.range(-1, 1)], [r.range(-0.8, 0.8), r.range(0, 6), r.range(-0.8, 0.8)], 1, 0.2, 0.25);
  }
  b.add(cyl(0.05, 0.05, 2.2, 4), [0.35, 0.2, 0.13], [0.2, 0.8, 0.1], [0.9, 0.4, 0.5]);
  b.add(cyl(0.04, 0.04, 1.8, 4), [0.3, 0.22, 0.18], [-0.4, 0.6, -0.2], [-0.7, 1.4, 0.9]);
  return b.build();
}

function barrel(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(cyl(0.29, 0.29, 0.88, 9), [0.36, 0.2, 0.12], [0, 0.4, 0], [0, 0, 0.12], 1, 0.3, 0.35);
  b.add(cyl(0.3, 0.3, 0.05, 9), [0.2, 0.3, 0.42], [0.02, 0.62, 0], [0, 0, 0.12]);
  b.add(cyl(0.29, 0.29, 0.88, 9), [0.3, 0.3, 0.27], [0.8, 0.27, 0.3], [Math.PI / 2, 0.6, 0], 1, 0.3, 0.35);
  return b.build();
}

function tire(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.TorusGeometry(0.3, 0.12, 5, 10), [0.07, 0.07, 0.075], [0, 0.11, 0], [Math.PI / 2, 0, 0]);
  b.add(new THREE.TorusGeometry(0.3, 0.12, 5, 10), [0.09, 0.09, 0.09], [0.35, 0.3, 0.1], [1.1, 0.3, 0]);
  return b.build();
}

function plastic(): THREE.BufferGeometry {
  // photodegraded but persistent: sun-bleached bottles, crates, sheet fragments
  const b = new GeoBuilder();
  const r = new Rng(12);
  const cols: RGB[] = [[0.75, 0.75, 0.72], [0.5, 0.62, 0.72], [0.72, 0.45, 0.4], [0.74, 0.7, 0.42], [0.45, 0.62, 0.5], [0.8, 0.8, 0.8]];
  for (let i = 0; i < 7; i++) {
    const c = cols[r.int(cols.length)]!;
    const kind = r.int(3);
    const p: RGB = [r.range(-1.1, 1.1), 0.05, r.range(-1.1, 1.1)];
    if (kind === 0) b.add(cyl(0.045, 0.05, 0.26, 5), c, [p[0], 0.05, p[2]], [Math.PI / 2, r.range(0, 6), 0]);
    else if (kind === 1) b.add(box(r.range(0.25, 0.55), 0.015, r.range(0.2, 0.4)), c, [p[0], 0.03, p[2]], [r.range(-0.2, 0.2), r.range(0, 6), r.range(-0.2, 0.2)]);
    else b.add(box(0.34, 0.2, 0.26), c, [p[0], 0.08, p[2]], [r.range(-0.4, 0.4), r.range(0, 6), 0], 1, 0.3);
  }
  return b.build();
}

function rubble(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const r = new Rng(5);
  for (let i = 0; i < 7; i++) {
    const brick = r.chance(0.4);
    b.add(box(r.range(0.25, 0.7), r.range(0.15, 0.35), r.range(0.2, 0.5)), brick ? [0.45, 0.25, 0.18] : [0.42, 0.41, 0.38],
      [r.range(-0.9, 0.9), 0.1, r.range(-0.9, 0.9)], [r.range(-0.4, 0.4), r.range(0, 6), r.range(-0.4, 0.4)], 1, 0.2, 0.2);
  }
  b.add(blob(0.5, 0, 9, 0.4), [0.2, 0.34, 0.12], [0, 0.1, 0], [0, 0, 0], [1.6, 0.3, 1.4]);
  return b.build();
}

export function buildScatterModels(): ScatterModel[] {
  const m: ScatterModel[] = [];
  m[K.TreeBroad] = { hi: broadleaf(1, 7, 1), lo: broadleaf(0, 4, 1), foliage: true, shadow: true, range: 1, max: 22000 };
  m[K.TreeTall] = { hi: tallTree(1, 2), lo: tallTree(0, 2), foliage: true, shadow: true, range: 1, max: 16000 };
  m[K.Snag] = { hi: snag(), foliage: false, shadow: true, range: 0.7, max: 3000 };
  m[K.Shrub] = { hi: shrub(), foliage: true, shadow: false, range: 0.5, max: 14000 };
  m[K.Rock] = { hi: new GeoBuilder().add(blob(0.8, 1, 4, 0.5), [0.4, 0.39, 0.36], [0, 0.25, 0], [0, 0, 0], [1.2, 0.75, 1], 0.35, 0.2).build(), foliage: false, shadow: true, range: 0.6, max: 5000 };
  m[K.Reed] = { hi: reed(), foliage: true, shadow: false, range: 0.3, max: 9000 };
  m[K.Scrap] = { hi: scrap(), foliage: false, shadow: true, range: 0.6, max: 1500 };
  m[K.Barrel] = { hi: barrel(), foliage: false, shadow: true, range: 0.4, max: 800 };
  m[K.Tire] = { hi: tire(), foliage: false, shadow: false, range: 0.3, max: 1200 };
  m[K.Plastic] = { hi: plastic(), foliage: false, shadow: false, range: 0.22, max: 5000 };
  m[K.Rubble] = { hi: rubble(), foliage: false, shadow: false, range: 0.35, max: 1500 };
  m[K.Log] = { hi: log(), foliage: false, shadow: true, range: 0.45, max: 1500 };
  return m;
}
