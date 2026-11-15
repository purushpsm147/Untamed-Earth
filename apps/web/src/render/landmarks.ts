import * as THREE from 'three';
import { Rng } from '@untamed/core';
import { Building, Valley, Wreck } from '@untamed/worlds';
import { GeoBuilder, RGB, blob, box, cyl } from './geo';

const PLASTER: RGB[] = [[0.62, 0.58, 0.48], [0.5, 0.56, 0.58], [0.63, 0.52, 0.47], [0.55, 0.55, 0.5], [0.58, 0.6, 0.5]];
const BRICK: RGB = [0.45, 0.26, 0.19];
const RUST: RGB = [0.4, 0.22, 0.13];
const VINE: RGB = [0.13, 0.3, 0.09];
const CONCRETE: RGB = [0.46, 0.45, 0.42];

/** Places local-space parts into world space for one landmark. */
class Placer {
  private readonly c: number;
  private readonly s: number;
  constructor(private readonly b: GeoBuilder, private readonly x: number, private readonly y: number, private readonly z: number, private readonly rot: number, private readonly tilt = 0) {
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
  }
  add(geo: THREE.BufferGeometry, color: RGB, p: RGB, r: RGB = [0, 0, 0], scale: RGB | number = 1, shade = 0.15, jitter = 0.12): void {
    // tilt the whole object slightly about its local x axis, then yaw into place
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const ly = p[1] * ct - p[2] * st;
    const lz = p[1] * st + p[2] * ct;
    const wx = this.x + p[0] * this.c + lz * this.s;
    const wz = this.z - p[0] * this.s + lz * this.c;
    this.b.add(geo, color, [wx, this.y + ly, wz], [r[0] + this.tilt, r[1] + this.rot, r[2]], scale, shade, jitter);
  }
}

function building(b: GeoBuilder, v: Valley, bd: Building): void {
  const r = new Rng(bd.seed);
  const y = v.height(bd.x, bd.z) - 0.6;
  const P = new Placer(b, bd.x, y, bd.z, bd.rot);
  if (bd.kind === 'tower') {
    // elevated water tank on a braced steel frame
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(box(0.22, bd.h, 0.22), RUST, [sx * 1.7, bd.h / 2, sz * 1.7]);
    for (let k = 1; k < 4; k++) {
      P.add(box(3.6, 0.1, 0.1), RUST, [0, (bd.h * k) / 4, 1.7], [0, 0, 0.5]);
      P.add(box(3.6, 0.1, 0.1), RUST, [0, (bd.h * k) / 4, -1.7], [0, 0, -0.5]);
      P.add(box(0.1, 0.1, 3.6), RUST, [1.7, (bd.h * k) / 4, 0], [0.5, 0, 0]);
      P.add(box(0.1, 0.1, 3.6), RUST, [-1.7, (bd.h * k) / 4, 0], [-0.5, 0, 0]);
    }
    P.add(cyl(2.5, 2.5, 3.2, 12), [0.44, 0.33, 0.25], [0, bd.h + 1.6, 0], [0, 0, 0], 1, 0.3, 0.3);
    P.add(cyl(0.3, 2.6, 0.9, 12), RUST, [0, bd.h + 3.6, 0]);
    P.add(box(0.5, bd.h * 0.7, 0.06), VINE, [1.75, bd.h * 0.35, 1.86]);
    return;
  }
  const col = PLASTER[r.int(PLASTER.length)]!;
  const t = 0.3;
  const hw = bd.w / 2;
  const hd = bd.d / 2;
  const wallH = bd.h + 0.6;
  // each wall is built from piers with window gaps; collapse lowers and breaks piers
  const wall = (len: number, place: (u: number) => RGB, yaw: number): void => {
    const n = Math.max(3, Math.round(len / 1.6));
    const seg = len / n;
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (i + 0.5) * seg;
      const gap = i % 2 === 1 && i < n - 1;
      const broken = r.next() < bd.collapse * 0.75;
      let h = wallH * (broken ? r.range(0.15, 0.75) : 1);
      const c: RGB = broken && r.chance(0.6) ? BRICK : col;
      const p = place(u);
      if (gap && !broken) {
        P.add(box(seg, wallH * 0.3, t), col, [p[0], wallH * 0.15, p[2]], [0, yaw, 0]);
        P.add(box(seg, wallH * 0.22, t), col, [p[0], wallH * 0.89, p[2]], [0, yaw, 0]);
      } else {
        if (gap) h *= 0.4;
        P.add(box(seg + 0.02, h, t), c, [p[0], h / 2, p[2]], [0, yaw, 0], 1, 0.3, 0.18);
      }
      if (r.chance(0.3 + bd.collapse * 0.25)) P.add(box(seg * r.range(0.5, 1), Math.min(h, wallH * r.range(0.3, 0.95)), 0.08), VINE, [p[0], Math.min(h, wallH) * 0.42, p[2]], [0, yaw, 0], [1, 1, 5.2], 0.3, 0.4);
    }
  };
  wall(bd.w, (u) => [u, 0, hd], 0);
  wall(bd.w, (u) => [u, 0, -hd], 0);
  wall(bd.d, (u) => [hw, 0, u], Math.PI / 2);
  wall(bd.d, (u) => [-hw, 0, u], Math.PI / 2);
  const roofC: RGB = bd.kind === 'house' ? [0.42, 0.25, 0.17] : [0.36, 0.3, 0.26];
  if (bd.collapse < 0.38) {
    const pitch = 0.42;
    const span = hd / Math.cos(pitch) + 0.4;
    P.add(box(bd.w + 0.6, 0.12, span), roofC, [0, wallH + Math.tan(pitch) * hd * 0.5, hd * 0.5], [pitch, 0, 0], 1, 0, 0.3);
    if (r.chance(0.7)) P.add(box(bd.w + 0.6, 0.12, span), roofC, [0, wallH + Math.tan(pitch) * hd * 0.5, -hd * 0.5], [-pitch, 0, 0], 1, 0, 0.3);
    P.add(blob(0.8, 0, bd.seed, 0.5), [0.2, 0.36, 0.12], [r.range(-hw, hw) * 0.6, wallH + 0.5, hd * 0.5], [0, 0, 0], [1.8, 0.25, 1.2]);
  } else if (bd.collapse < 0.75) {
    // one roof plane has slumped into the interior
    P.add(box(bd.w * 0.8, 0.12, bd.d * 0.7), roofC, [0, wallH * 0.35, 0], [0.5, 0.2, 0.15], 1, 0, 0.3);
  }
  if (bd.collapse > 0.45) {
    // a century of succession: a tree has taken the interior
    P.add(cyl(0.12, 0.22, wallH + 1.5, 5), [0.25, 0.19, 0.13], [hw * 0.2, (wallH + 1.5) / 2, -hd * 0.2]);
    P.add(blob(2.2, 1, bd.seed + 1, 0.5, true), [0.12, 0.3, 0.08], [hw * 0.2, wallH + 2.6, -hd * 0.2], [0, 0, 0], [1.2, 0.8, 1.2], 0.55, 0.3);
    for (let i = 0; i < 4; i++) P.add(box(r.range(0.4, 0.9), r.range(0.2, 0.4), r.range(0.3, 0.7)), r.chance(0.5) ? BRICK : CONCRETE, [r.range(-hw, hw), 0.75, r.range(-hd, hd)], [r.range(-0.3, 0.3), r.range(0, 3), 0]);
  }
  if (bd.kind === 'hall') for (let i = -1; i <= 1; i++) P.add(box(0.4, wallH, 0.4), CONCRETE, [i * hw * 0.7, wallH / 2, hd + 2.2]);
}

function wreck(b: GeoBuilder, v: Valley, w: Wreck): void {
  const r = new Rng(w.seed);
  const y = v.height(w.x, w.z);
  const paints: RGB[] = [[0.42, 0.24, 0.14], [0.36, 0.2, 0.12], [0.3, 0.36, 0.4], [0.5, 0.46, 0.36], [0.4, 0.2, 0.18], [0.3, 0.38, 0.3]];
  const paint = paints[r.int(paints.length)]!;
  const dark: RGB = [0.07, 0.07, 0.08];
  const P = new Placer(b, w.x, y, w.z, w.rot, w.kind === 'pylon' ? w.tilt : w.tilt * 0.5);
  switch (w.kind) {
    case 'car':
      P.add(box(1.7, 0.6, 4.0), paint, [0, 0.5, 0], [0, 0, 0], 1, 0.3, 0.3);
      P.add(box(1.5, 0.5, 2.0), RUST, [0, 1.02, -0.2], [0, 0, 0], 1, 0.1, 0.3);
      P.add(box(1.52, 0.3, 1.6), dark, [0, 1.0, -0.2]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(cyl(0.3, 0.3, 0.2, 8), dark, [sx * 0.85, 0.22, sz * 1.25], [0, 0, Math.PI / 2]);
      P.add(blob(0.7, 0, w.seed, 0.5), [0.2, 0.35, 0.12], [0.2, 0.82, 1.3], [0, 0, 0], [1.4, 0.2, 1]);
      break;
    case 'bus':
      P.add(box(2.4, 2.3, 9.5), paint, [0, 1.5, 0], [0, 0, 0], 1, 0.3, 0.3);
      P.add(box(2.42, 0.7, 8.4), dark, [0, 1.95, 0]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(cyl(0.45, 0.45, 0.28, 8), dark, [sx * 1.15, 0.35, sz * 3.2], [0, 0, Math.PI / 2]);
      P.add(box(1.2, 1.8, 0.1), [0.13, 0.3, 0.09], [1.23, 1.2, 1.5], [0, Math.PI / 2, 0], [1, 1, 3]);
      break;
    case 'truck':
      P.add(box(2.2, 1.7, 1.9), paint, [0, 1.35, 2.6], [0, 0, 0], 1, 0.3, 0.3);
      P.add(box(2.3, 0.25, 5.0), RUST, [0, 0.95, -1.0]);
      P.add(box(2.3, 0.9, 0.1), RUST, [0, 1.5, -3.5]);
      P.add(box(0.1, 0.9, 5.0), RUST, [1.15, 1.5, -1.0]);
      for (const sx of [-1, 1]) for (const sz of [-1, 0.2, 1]) P.add(cyl(0.48, 0.48, 0.3, 8), dark, [sx * 1.05, 0.4, sz * 2.6], [0, 0, Math.PI / 2]);
      break;
    case 'excavator':
      for (const sx of [-1, 1]) P.add(box(0.6, 0.7, 4.2), dark, [sx * 1.2, 0.35, 0]);
      P.add(box(2.6, 1.5, 3.0), [0.55, 0.42, 0.14], [0, 1.5, -0.3], [0, 0, 0], 1, 0.3, 0.35);
      P.add(box(1.1, 1.3, 1.3), [0.2, 0.22, 0.22], [-0.7, 2.6, 0.5]);
      P.add(box(0.4, 0.5, 5.2), [0.5, 0.36, 0.13], [0.6, 3.6, 2.6], [-0.75, 0, 0], 1, 0.2, 0.35);
      P.add(box(0.35, 0.4, 3.8), [0.48, 0.34, 0.13], [0.6, 3.5, 5.6], [0.95, 0, 0], 1, 0.2, 0.35);
      P.add(box(0.9, 0.8, 0.9), RUST, [0.6, 1.6, 6.8], [0.5, 0, 0]);
      break;
    case 'container': {
      const c: RGB[] = [[0.2, 0.38, 0.4], [0.45, 0.2, 0.15], [0.22, 0.3, 0.45], [0.42, 0.4, 0.3]];
      P.add(box(2.44, 2.6, 6.06), c[r.int(c.length)]!, [0, 1.25, 0], [0, 0, 0], 1, 0.35, 0.35);
      if (r.chance(0.4)) P.add(box(2.44, 2.6, 6.06), c[r.int(c.length)]!, [0.3, 3.85, 0.4], [0, 0.15, 0], 1, 0.2, 0.35);
      break;
    }
    case 'pylon': {
      const h = 24;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.add(box(0.14, h, 0.14), [0.36, 0.33, 0.31], [sx * 1.1, h / 2, sz * 1.1], [sz * 0.045, 0, -sx * 0.045]);
      for (let k = 1; k <= 5; k++) {
        const yy = (h * k) / 5.4;
        const wd = 2.4 - k * 0.3;
        P.add(box(wd, 0.08, 0.08), [0.33, 0.3, 0.28], [0, yy, wd / 2]);
        P.add(box(wd, 0.08, 0.08), [0.33, 0.3, 0.28], [0, yy, -wd / 2]);
        P.add(box(0.08, 0.08, wd), [0.33, 0.3, 0.28], [wd / 2, yy, 0]);
        P.add(box(0.08, 0.08, wd), [0.33, 0.3, 0.28], [-wd / 2, yy, 0]);
      }
      P.add(box(9, 0.14, 0.14), [0.35, 0.3, 0.27], [0, h - 1.2, 0]);
      P.add(box(6.5, 0.14, 0.14), [0.35, 0.3, 0.27], [0, h - 4.2, 0]);
      break;
    }
    case 'bridge': {
      // local z runs along the road, across the river; the middle span has dropped into the channel
      const deckY = v.waterSurface(w.z) + 2.6 - y;
      for (const s of [-1, 1]) {
        P.add(box(6.5, 0.55, 13), CONCRETE, [0, deckY, s * 15], [0, 0, 0], 1, 0.1, 0.15);
        P.add(box(1.4, 6, 1.6), CONCRETE, [0, deckY - 3.1, s * 9.5], [0, 0, 0], 1, 0.4, 0.2);
        P.add(box(0.2, 0.9, 13), RUST, [3.1, deckY + 0.7, s * 15]);
        P.add(box(0.2, 0.9, 13), RUST, [-3.1, deckY + 0.7, s * 15]);
        P.add(box(6.5, 1.6, 0.1), [0.13, 0.3, 0.09], [0, deckY - 0.8, s * 8.6], [0, 0, 0], [1, 1, 3], 0.3, 0.4);
      }
      P.add(box(6.5, 0.55, 9), CONCRETE, [0.4, deckY - 2.3, 1.5], [0.42, 0.06, 0.1], 1, 0.1, 0.15);
      break;
    }
  }
}

/** All ruins and wrecks merged into a single static mesh (one draw call). */
export function buildLandmarks(v: Valley): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const bd of v.buildings) building(b, v, bd);
  for (const w of v.wrecks) wreck(b, v, w);
  return b.build();
}
