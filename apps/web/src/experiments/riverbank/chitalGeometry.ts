/**
 * Procedural chital mesh for the riverbank slice — EXPERIMENT. Project-owned procedural geometry (no external assets).
 *
 * One continuous-looking animal from lofted parts that overlap at the joins (body, neck, head) plus tubes for
 * limbs, tail and antlers. Every vertex carries two bone indices and a weight for the rig in chitalRig.ts
 * (linear blend skinning in the vertex shader), and a region code for the coat shader.
 */
import * as THREE from 'three';
import { BONE, LEGS, SKELETON, smooth01 } from './chitalRig';

export const REGION = { coat: 0, leg: 1, hoof: 2, antler: 3, eye: 4, ear: 5, tail: 6 } as const;

interface Part {
  pos: number[];
  bone: number[];
  weight: number[];
  region: number[];
  index: number[];
}

class SkinBuilder {
  private readonly parts: Part[] = [];
  private cur: Part = { pos: [], bone: [], weight: [], region: [], index: [] };

  begin(): void {
    this.cur = { pos: [], bone: [], weight: [], region: [], index: [] };
    this.parts.push(this.cur);
  }
  vert(p: THREE.Vector3, b0: number, b1: number, w0: number, region: number): number {
    const c = this.cur;
    c.pos.push(p.x, p.y, p.z);
    c.bone.push(b0, b1);
    c.weight.push(w0);
    c.region.push(region);
    return c.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.cur.index.push(a, b, d, b, c, d);
  }
  tri(a: number, b: number, c: number): void {
    this.cur.index.push(a, b, c);
  }

  /** Merge parts; normals are computed per part (smooth within a part, overlapping seams between parts). */
  build(): THREE.BufferGeometry {
    const pos: number[] = [];
    const nor: number[] = [];
    const bone: number[] = [];
    const weight: number[] = [];
    const region: number[] = [];
    const index: number[] = [];
    for (const p of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setIndex(p.index);
      g.computeVertexNormals();
      const base = pos.length / 3;
      pos.push(...p.pos);
      nor.push(...(g.attributes.normal!.array as Float32Array));
      bone.push(...p.bone);
      weight.push(...p.weight);
      region.push(...p.region);
      for (const i of p.index) index.push(i + base);
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('aBone', new THREE.Float32BufferAttribute(bone, 2));
    out.setAttribute('aWeight', new THREE.Float32BufferAttribute(weight, 1));
    out.setAttribute('aRegion', new THREE.Float32BufferAttribute(region, 1));
    out.setIndex(index);
    out.computeBoundingSphere();
    return out;
  }
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
/** Superellipse coordinate: sign(c)|c|^(2/n). */
const se = (c: number, n: number): number => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

interface Station { z: number; cy: number; rt: number; rb: number; w: number }

/** Adult female torso stations (rump to brisket); interpolated with a Catmull-Rom spline for a smooth profile. */
const TORSO: Station[] = [
  { z: -0.66, cy: 0.775, rt: 0.012, rb: 0.02, w: 0.012 },
  { z: -0.645, cy: 0.775, rt: 0.045, rb: 0.08, w: 0.055 },
  { z: -0.61, cy: 0.765, rt: 0.07, rb: 0.15, w: 0.1 },
  { z: -0.54, cy: 0.75, rt: 0.075, rb: 0.215, w: 0.135 },
  { z: -0.44, cy: 0.74, rt: 0.07, rb: 0.25, w: 0.15 },
  { z: -0.33, cy: 0.735, rt: 0.065, rb: 0.225, w: 0.142 },
  { z: -0.22, cy: 0.73, rt: 0.062, rb: 0.16, w: 0.128 },
  { z: -0.1, cy: 0.725, rt: 0.07, rb: 0.185, w: 0.137 },
  { z: 0.03, cy: 0.725, rt: 0.082, rb: 0.215, w: 0.143 },
  { z: 0.15, cy: 0.725, rt: 0.098, rb: 0.235, w: 0.14 },
  { z: 0.25, cy: 0.72, rt: 0.1, rb: 0.232, w: 0.128 },
  { z: 0.33, cy: 0.715, rt: 0.088, rb: 0.205, w: 0.11 },
  { z: 0.395, cy: 0.71, rt: 0.06, rb: 0.16, w: 0.085 },
  { z: 0.43, cy: 0.71, rt: 0.02, rb: 0.07, w: 0.035 },
];

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}
function stationAt(st: Station[], f: number): Station {
  const n = st.length - 1;
  const x = Math.min(n - 1e-6, Math.max(0, f * n));
  const i = Math.floor(x);
  const t = x - i;
  const g = (k: number): Station => st[Math.min(n, Math.max(0, k))]!;
  const pick = (key: keyof Station): number => catmull(g(i - 1)[key], g(i)[key], g(i + 1)[key], g(i + 2)[key], t);
  return { z: pick('z'), cy: pick('cy'), rt: Math.max(0.004, pick('rt')), rb: Math.max(0.004, pick('rb')), w: Math.max(0.004, pick('w')) };
}

export interface ChitalMeshOptions {
  antlers: boolean;
  /** 1 = full detail; ~0.45 for distant LOD. */
  detail: number;
}

export function buildChitalGeometry(opt: ChitalMeshOptions): THREE.BufferGeometry {
  const B = new SkinBuilder();
  const D = opt.detail;
  const ring = Math.max(10, Math.round(30 * D));
  const P = SKELETON.pos;

  // ------------------------------------------------------------------ torso
  B.begin();
  const nSt = Math.max(16, Math.round(46 * D));
  const rows: number[][] = [];
  for (let i = 0; i <= nSt; i++) {
    const s = stationAt(TORSO, i / nSt);
    const row: number[] = [];
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2; // 0 = dorsal midline, increasing toward +X (left)
      const sx = se(Math.sin(a), 2.08);
      const cy = Math.cos(a);
      const syv = se(cy, 2.04);
      const p = v3(s.w * sx, s.cy + (cy > 0 ? s.rt : s.rb) * syv, s.z);
      // skinning: pelvis -> chest along the spine; low flanks follow the scapula / femur
      const tChest = smooth01(-0.3, 0.06, s.z);
      const body = tChest > 0.5 ? BONE.chest : BONE.pelvis;
      const side = p.x >= 0 ? 1 : -1;
      let legBone: number = body === BONE.chest ? BONE.pelvis : BONE.chest;
      let wLeg = 0;
      const low = smooth01(s.cy - 0.03, s.cy - 0.17, p.y) * smooth01(0.025, 0.08, Math.abs(p.x));
      if (s.z > 0.12) {
        wLeg = low * smooth01(0.12, 0.24, s.z) * 0.5;
        legBone = side > 0 ? BONE.FL0 : BONE.FR0;
      } else if (s.z < -0.24) {
        wLeg = low * smooth01(-0.24, -0.36, s.z) * smooth01(-0.66, -0.56, s.z) * 0.5;
        legBone = side > 0 ? BONE.HL0 : BONE.HR0;
      } else {
        // spine blend between pelvis and chest
        const w = body === BONE.chest ? 1 - tChest : tChest;
        wLeg = Math.min(0.5, w);
      }
      row.push(B.vert(p, body, legBone, 1 - wLeg, REGION.coat));
    }
    rows.push(row);
  }
  for (let i = 0; i < nSt; i++) for (let j = 0; j < ring; j++) B.quad(rows[i]![j]!, rows[i]![(j + 1) % ring]!, rows[i + 1]![(j + 1) % ring]!, rows[i + 1]![j]!);
  // close the rump
  const capR = B.vert(v3(0, 0.775, -0.665), BONE.pelvis, BONE.pelvis, 1, REGION.coat);
  for (let j = 0; j < ring; j++) B.tri(capR, rows[0]![(j + 1) % ring]!, rows[0]![j]!);
  const capF = B.vert(v3(0, 0.71, 0.435), BONE.chest, BONE.chest, 1, REGION.coat);
  for (let j = 0; j < ring; j++) B.tri(capF, rows[nSt]![j]!, rows[nSt]![(j + 1) % ring]!);

  // ------------------------------------------------------------------ neck (base inside the chest -> behind the poll)
  const thick = opt.antlers ? 1.18 : 1;
  loftAlong(B, ring, Math.max(10, Math.round(22 * D)),
    (s) => {
      // axis: one straight line along the neck, starting inside the chest (no kink, so no bulge at the brisket)
      const b = P[BONE.neck]!;
      const c = P[BONE.head]!.clone().add(v3(0, 0.0, -0.02));
      const a = b.clone().sub(c.clone().sub(b).normalize().multiplyScalar(0.17));
      return a.clone().lerp(c, s);
    },
    (s) => {
      // lateral half-width and dorso-ventral half-depth; deep ventral throat at the base, thin under the jaw
      // the base starts well inside the chest (no coincident surfaces with the torso) and swells as the neck leaves it
      const inChest = smooth01(0.0, 0.3, s);
      const taper = smooth01(0.3, 0.8, s);
      const w = (0.07 + 0.03 * inChest - 0.048 * taper) * (s > 0.85 ? 1 - 0.2 * smooth01(0.85, 1, s) : 1) * thick;
      const dTop = (0.06 + 0.035 * inChest - 0.05 * taper) * thick;
      const dBot = (0.075 + 0.045 * inChest - 0.078 * taper) * thick;
      return { w, dTop, dBot };
    },
    (s) => (s < 0.32 ? [BONE.chest, BONE.neck, 1 - smooth01(0.12, 0.32, s)] : s > 0.86 ? [BONE.neck, BONE.head, 1 - smooth01(0.86, 1, s) * 0.6] : [BONE.neck, BONE.neck, 1]),
    REGION.coat, true, true);

  // ------------------------------------------------------------------ head (cranium -> muzzle)
  const poll = SKELETON.poll.clone();
  const tip = SKELETON.muzzle.clone();
  loftAlong(B, ring, Math.max(10, Math.round(24 * D)),
    (s) => poll.clone().lerp(tip, s).add(v3(0, -0.012 * Math.sin(Math.PI * s), 0)),
    (s) => {
      // chital head: broad deep cranium with large eyes, tapering to a fine muzzle
      const w = s < 0.32 ? 0.05 + 0.015 * Math.sin((s / 0.32) * Math.PI * 0.5) : 0.065 - 0.045 * Math.pow((s - 0.32) / 0.68, 1.1);
      const dTop = s < 0.3 ? 0.055 + 0.008 * (s / 0.3) : 0.063 - 0.038 * ((s - 0.3) / 0.7);
      const dBot = s < 0.28 ? 0.055 + 0.035 * (s / 0.28) : 0.09 - 0.066 * Math.pow((s - 0.28) / 0.72, 0.85);
      const end = s > 0.93 ? 1 - 0.6 * smooth01(0.93, 1, s) : 1;
      const start = s < 0.06 ? 0.55 + 0.45 * smooth01(0, 0.06, s) : 1;
      return { w: Math.max(0.006, w * end * start), dTop: Math.max(0.006, dTop * end * start), dBot: Math.max(0.006, dBot * end * start) };
    },
    () => [BONE.head, BONE.head, 1], REGION.coat, true, true);

  // eyes: dark, slightly bulging, set at the side of the head below the brow
  for (const sx of [1, -1]) {
    const c = poll.clone().lerp(tip, 0.3).add(v3(sx * 0.056, 0.012, 0));
    sphere(B, c, 0.0115, Math.max(6, Math.round(10 * D)), BONE.head, REGION.eye);
  }

  // ------------------------------------------------------------------ ears: large, cupped, held out to the side
  for (const [bone, sx] of [[BONE.earL, 1], [BONE.earR, -1]] as const) {
    ear(B, P[bone]!, sx, bone, Math.max(4, Math.round(8 * D)));
  }

  // ------------------------------------------------------------------ legs
  for (const id of LEGS) {
    const L = SKELETON.legs[id];
    const n = L.j.length - 1;
    // radii at each joint and a muscle bulge just below the proximal joint of each long bone
    const rad = L.front ? [0.07, 0.06, 0.042, 0.023, 0.019, 0.017] : [0.075, 0.04, 0.026, 0.019, 0.017];
    const bulge = L.front ? [0, 0.01, 0.01, 0, 0] : [0.01, 0.012, 0, 0];
    // scapula, humerus and femur lie inside the torso's shoulder and haunch: the visible limb starts at the elbow / stifle
    const start = L.front ? 2 : 1;
    const segRings = Math.max(3, Math.round(7 * D));
    const pts: { p: THREE.Vector3; r: number; b0: number; b1: number; w: number; region: number; flat: number }[] = [];
    for (let k = start; k < n; k++) {
      const a = L.j[k]!;
      const b = L.j[k + 1]!;
      const isFoot = k === n - 1;
      const steps = isFoot ? segRings + 2 : segRings;
      for (let i = 0; i <= steps; i++) {
        if (i === 0 && k > start) continue;
        const t = i / steps;
        let r = rad[k]! + (rad[k + 1]! - rad[k]!) * t + bulge[k]! * Math.sin(Math.PI * Math.min(1, t * 1.6));
        let region: number = REGION.leg;
        let flat = 0;
        if (isFoot) {
          // pastern then hoof: the hoof widens slightly and ends in a flattened sole at the toe
          if (t > 0.5) {
            region = REGION.hoof;
            r = 0.016 + 0.006 * Math.sin(Math.PI * Math.min(1, (t - 0.5) / 0.55));
            flat = smooth01(0.6, 1, t);
          }
          if (t > 0.97) r *= 0.5;
        }
        const bone = L.bone0 + k;
        // blend across joints so knees and hocks bend smoothly
        let b1 = bone;
        let w = 1;
        if (t < 0.18 && k > 0) { b1 = bone - 1; w = 0.5 + 0.5 * (t / 0.18); }
        else if (t > 0.86 && k < n - 1) { b1 = bone + 1; w = 1 - 0.5 * ((t - 0.86) / 0.14); }
        pts.push({ p: a.clone().lerp(b, t), r, b0: bone, b1, w, region, flat });
      }
    }
    tube(B, pts, ring >= 20 ? 12 : 8, L.front ? 0.82 : 0.78);
  }

  // ------------------------------------------------------------------ tail: hangs over the white rump patch
  const tb = P[BONE.tail]!;
  const tailPts = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    p: v3(0, tb.y - 0.2 * t, tb.z - 0.035 - 0.04 * Math.sin(Math.PI * t * 0.8)),
    r: 0.03 - 0.016 * t + (t > 0.95 ? -0.008 : 0), b0: BONE.tail, b1: t < 0.2 ? BONE.pelvis : BONE.tail, w: t < 0.2 ? 0.6 + 2 * t : 1, region: REGION.tail, flat: 0,
  }));
  tube(B, tailPts, ring >= 20 ? 10 : 6, 0.55);

  // ------------------------------------------------------------------ antlers: lyre-shaped beam, brow tine, terminal fork
  if (opt.antlers) {
    for (const sx of [1, -1]) {
      const base = poll.clone().lerp(tip, 0.16).add(v3(sx * 0.036, 0.042, 0));
      const beam = [v3(0, 0, 0), v3(0.05, 0.1, -0.1), v3(0.14, 0.24, -0.17), v3(0.19, 0.38, -0.13), v3(0.17, 0.5, -0.03), v3(0.12, 0.57, 0.05)].map((q) => base.clone().add(v3(q.x * sx, q.y, q.z)));
      antlerTube(B, beam, [0.021, 0.018, 0.015, 0.012, 0.009, 0.004], Math.max(5, Math.round(8 * D)));
      const browBase = base.clone().add(v3(sx * 0.008, 0.035, -0.012));
      antlerTube(B, [browBase, browBase.clone().add(v3(sx * 0.02, 0.05, 0.09)), browBase.clone().add(v3(sx * 0.035, 0.12, 0.19))], [0.013, 0.01, 0.004], Math.max(5, Math.round(7 * D)));
      const forkBase = beam[3]!.clone().lerp(beam[4]!, 0.35);
      antlerTube(B, [forkBase, forkBase.clone().add(v3(-sx * 0.02, 0.07, -0.05)), forkBase.clone().add(v3(-sx * 0.035, 0.14, -0.09))], [0.01, 0.008, 0.003], Math.max(5, Math.round(7 * D)));
    }
  }

  return B.build();
}

/** Loft elliptical rings along a curve. Ring basis: lateral = X, "up" = sagittal perpendicular to the axis. */
function loftAlong(B: SkinBuilder, ring: number, n: number, axis: (s: number) => THREE.Vector3,
  size: (s: number) => { w: number; dTop: number; dBot: number }, skin: (s: number) => number[], region: number, capStart: boolean, capEnd: boolean): void {
  B.begin();
  const rows: number[][] = [];
  const X = v3(1, 0, 0);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const p = axis(s);
    const t = axis(Math.min(1, s + 0.01)).sub(axis(Math.max(0, s - 0.01))).normalize();
    const up = new THREE.Vector3().crossVectors(t, X).normalize().multiplyScalar(-1);
    if (up.y < 0) up.multiplyScalar(-1);
    const { w, dTop, dBot } = size(s);
    const [b0, b1, w0] = skin(s);
    const row: number[] = [];
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      const c = Math.cos(a);
      const q = p.clone().addScaledVector(X, w * se(Math.sin(a), 2.0)).addScaledVector(up, (c > 0 ? dTop : dBot) * se(c, 2.0));
      row.push(B.vert(q, b0!, b1!, w0!, region));
    }
    rows.push(row);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < ring; j++) B.quad(rows[i]![j]!, rows[i]![(j + 1) % ring]!, rows[i + 1]![(j + 1) % ring]!, rows[i + 1]![j]!);
  const [sb0, sb1, sw] = skin(0);
  const [eb0, eb1, ew] = skin(1);
  if (capStart) {
    const c = B.vert(axis(0), sb0!, sb1!, sw!, region);
    for (let j = 0; j < ring; j++) B.tri(c, rows[0]![(j + 1) % ring]!, rows[0]![j]!);
  }
  if (capEnd) {
    const c = B.vert(axis(1).add(axis(1).sub(axis(0.98)).normalize().multiplyScalar(0.004)), eb0!, eb1!, ew!, region);
    for (let j = 0; j < ring; j++) B.tri(c, rows[n]![j]!, rows[n]![(j + 1) % ring]!);
  }
}

/** Tube through points with per-point radius and skinning; elliptical (lateral radius * aspect). */
function tube(B: SkinBuilder, pts: { p: THREE.Vector3; r: number; b0: number; b1: number; w: number; region: number; flat: number }[], sides: number, aspect: number): void {
  B.begin();
  const rows: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!.p;
    const next = pts[Math.min(pts.length - 1, i + 1)]!.p;
    const t = next.clone().sub(prev).normalize();
    const side = v3(1, 0, 0);
    const fwd = new THREE.Vector3().crossVectors(side, t).normalize();
    const lat = new THREE.Vector3().crossVectors(t, fwd).normalize();
    const row: number[] = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const q = c.p.clone().addScaledVector(lat, Math.cos(a) * c.r * aspect).addScaledVector(fwd, Math.sin(a) * c.r);
      // hoof sole: flatten the underside so the hoof rests on it
      if (c.flat > 0) q.y = Math.max(q.y, c.p.y - c.r * (1 - 0.8 * c.flat));
      row.push(B.vert(q, c.b0, c.b1, c.w, c.region));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < sides; j++) B.quad(rows[i]![j]!, rows[i]![(j + 1) % sides]!, rows[i + 1]![(j + 1) % sides]!, rows[i + 1]![j]!);
  const last = pts[pts.length - 1]!;
  const cap = B.vert(last.p, last.b0, last.b1, last.w, last.region);
  for (let j = 0; j < sides; j++) B.tri(cap, rows[rows.length - 1]![j]!, rows[rows.length - 1]![(j + 1) % sides]!);
}

function antlerTube(B: SkinBuilder, ctrl: THREE.Vector3[], radii: number[], sides: number): void {
  const curve = new THREE.CatmullRomCurve3(ctrl);
  const n = 14;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = t * (radii.length - 1);
    const k = Math.min(radii.length - 2, Math.floor(x));
    // burr (coronet) just above the pedicle
    const burr = t < 0.06 ? 0.006 * Math.sin((t / 0.06) * Math.PI) : 0;
    pts.push({ p: curve.getPoint(t), r: radii[k]! + (radii[k + 1]! - radii[k]!) * (x - k) + burr, b0: BONE.head, b1: BONE.head, w: 1, region: REGION.antler, flat: 0 });
  }
  tube(B, pts, sides, 1);
}

function sphere(B: SkinBuilder, c: THREE.Vector3, r: number, seg: number, bone: number, region: number): void {
  B.begin();
  const rows: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI;
    const row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const ph = (j / seg) * Math.PI * 2;
      row.push(B.vert(c.clone().add(v3(Math.sin(th) * Math.cos(ph) * r, Math.cos(th) * r, Math.sin(th) * Math.sin(ph) * r)), bone, bone, 1, region));
    }
    rows.push(row);
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) B.quad(rows[i]![j]!, rows[i]![(j + 1) % seg]!, rows[i + 1]![(j + 1) % seg]!, rows[i + 1]![j]!);
}

/** Cupped leaf-shaped ear with thickness; outer and inner surfaces. */
function ear(B: SkinBuilder, base: THREE.Vector3, sx: number, bone: number, n: number): void {
  B.begin();
  const len = 0.135;
  const wid = 0.042;
  const dir = v3(sx * 0.78, 0.6, -0.18).normalize();
  const across = v3(0, 0.25, 1).cross(dir).normalize();
  const nrm = new THREE.Vector3().crossVectors(dir, across).normalize();
  if (nrm.z < 0) nrm.multiplyScalar(-1); // concave side faces forward
  const cols = 6;
  const grid: number[][][] = [[], []];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const width = wid * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)), 0.7) * (1 - 0.25 * u);
      const row: number[] = [];
      for (let j = 0; j <= cols; j++) {
        const vv = (j / cols) * 2 - 1;
        const cup = -0.018 * (1 - vv * vv) * Math.sin(Math.PI * Math.min(1, u * 1.1));
        const p = base.clone().addScaledVector(dir, len * u).addScaledVector(across, width * vv).addScaledVector(nrm, cup + (layer ? -0.003 : 0.003));
        row.push(B.vert(p, bone, bone, 1, REGION.ear));
      }
      grid[layer]!.push(row);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < cols; j++) {
      const o = grid[0]!;
      const b = grid[1]!;
      B.quad(o[i]![j]!, o[i]![j + 1]!, o[i + 1]![j + 1]!, o[i + 1]![j]!);
      B.quad(b[i]![j]!, b[i + 1]![j]!, b[i + 1]![j + 1]!, b[i]![j + 1]!);
    }
  }
}
