import * as THREE from 'three';
import { hash3f } from '@untamed/core';
import { GeoBuilder, RGB, box, cyl } from './geo';

/**
 * Vertex attributes consumed by the animation shader: aPart = (leg phase sign, head weight, wing side), aPivot = (y, z),
 * aFold = leg fold direction when lying (+1 front legs tuck backward, -1 hind legs tuck forward, 0 not a leg).
 */
const ATTRS = { aPart: 3, aPivot: 2, aFold: 1 };
const sph = (ws = 10, hs = 7): THREE.BufferGeometry => new THREE.SphereGeometry(1, ws, hs);

export interface QuadSpec {
  bodyLen: number; bodyR: number; bodyW: number; legLen: number; legR: number;
  neckLen: number; neckAngle: number; neckR: number;
  headLen: number; headR: number; snout: number; earLen: number; earW: number;
  tailLen: number; tailR: number; tailAngle: number;
  coat: RGB; belly: RGB; leg: RGB; head: RGB; tail: RGB;
  spots?: boolean; antlers?: boolean; mane?: boolean; darkBack?: number;
}

export interface AnimalModel {
  geo: THREE.BufferGeometry;
  /** Vertical drop applied when lying down (legs fold under the body; the belly ends just above the ground). */
  lie: number;
  /** Selection / follow-camera reference height. */
  height: number;
}

export function quadruped(s: QuadSpec): AnimalModel {
  const b = new GeoBuilder();
  const by = s.legLen + s.bodyR;
  b.add(sph(12, 8), s.coat, [0, by, 0], [0, 0, 0], [s.bodyW, s.bodyR, s.bodyLen / 2], 0, 0.1).paint((x, y, z) => {
    const t = (y - by) / s.bodyR;
    if (t < -0.45) return s.belly;
    if (s.spots && t > -0.3 && hash3f(Math.round(x * 40), Math.round(y * 26), Math.round(z * 26)) > 0.62) return [0.93, 0.9, 0.82];
    if (s.darkBack && t > 0.45) return [s.coat[0] * s.darkBack, s.coat[1] * s.darkBack, s.coat[2] * s.darkBack];
    return null;
  });
  // legs: diagonal pairs share a phase (walk / trot)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z = sz * s.bodyLen * 0.34;
      b.add(cyl(s.legR, s.legR * 0.6, s.legLen + s.bodyR * 0.5, 5), s.leg, [sx * s.bodyW * 0.62, (s.legLen + s.bodyR * 0.5) / 2, z], [0, 0, 0], 1, 0.25, 0,
        { aPart: [sx * sz, 0, 0], aPivot: [s.legLen + s.bodyR * 0.4, z], aFold: [sz] });
    }
  }
  // neck + head rotate as one unit about the shoulder
  const sy = by + s.bodyR * 0.35;
  const sz0 = s.bodyLen * 0.4;
  const ca = Math.cos(s.neckAngle);
  const sa = Math.sin(s.neckAngle);
  const hp = { aPart: [0, 1, 0], aPivot: [sy, sz0] };
  b.add(cyl(s.neckR * 0.75, s.neckR, s.neckLen, 6), s.coat, [0, sy + (sa * s.neckLen) / 2, sz0 + (ca * s.neckLen) / 2], [Math.PI / 2 - s.neckAngle, 0, 0], 1, 0, 0.1, hp);
  const hy = sy + sa * s.neckLen;
  const hz = sz0 + ca * s.neckLen;
  b.add(sph(8, 6), s.head, [0, hy, hz + s.headLen * 0.25], [0.15, 0, 0], [s.headR, s.headR, s.headLen / 2], 0, 0.08, hp);
  if (s.snout > 0) b.add(cyl(s.headR * 0.42, s.headR * 0.7, s.snout, 6), s.head, [0, hy - s.headR * 0.25, hz + s.headLen * 0.5 + s.snout * 0.4], [Math.PI / 2 + 0.15, 0, 0], 1, 0, 0, hp);
  b.add(sph(5, 4), [0.05, 0.04, 0.04], [0, hy - s.headR * 0.3, hz + s.headLen * 0.5 + s.snout * 0.85], [0, 0, 0], s.headR * 0.3, 0, 0, hp);
  for (const sx of [-1, 1]) {
    b.add(new THREE.ConeGeometry(s.earW, s.earLen, 4), s.head, [sx * s.headR * 0.8, hy + s.headR * 0.7 + s.earLen * 0.4, hz - s.headLen * 0.05], [-0.2, 0, -sx * 0.45], [1, 1, 0.45], 0, 0, hp);
    b.add(sph(4, 3), [0.03, 0.03, 0.03], [sx * s.headR * 0.78, hy + s.headR * 0.2, hz + s.headLen * 0.28], [0, 0, 0], s.headR * 0.17, 0, 0, hp);
    if (s.antlers) {
      const ant: RGB = [0.5, 0.42, 0.32];
      b.add(cyl(0.012, 0.024, 0.62, 4), ant, [sx * 0.13, hy + 0.36, hz - 0.12], [-0.45, 0, -sx * 0.35], 1, 0, 0, hp);
      b.add(cyl(0.008, 0.016, 0.34, 4), ant, [sx * 0.2, hy + 0.72, hz - 0.2], [0.35, 0, -sx * 0.1], 1, 0, 0, hp);
      b.add(cyl(0.008, 0.016, 0.22, 4), ant, [sx * 0.08, hy + 0.2, hz + 0.04], [0.9, 0, -sx * 0.2], 1, 0, 0, hp);
    }
  }
  if (s.mane) b.add(box(0.05, 0.1, s.bodyLen * 0.8), [0.1, 0.09, 0.08], [0, by + s.bodyR * 0.98, 0.05]);
  const ta = s.tailAngle;
  b.add(cyl(s.tailR, s.tailR * 0.5, s.tailLen, 5), s.tail, [0, by + s.bodyR * 0.3 - (Math.cos(ta) * s.tailLen) / 2, -s.bodyLen / 2 - (Math.sin(ta) * s.tailLen) / 2 + 0.03], [ta, 0, 0]);
  return { geo: b.build(ATTRS), lie: s.legLen * 0.95, height: hy + s.headR };
}

export function bird(len: number, body: RGB, head: RGB, wing: RGB, beak: RGB, leg: RGB, collar?: RGB, patch?: RGB): AnimalModel {
  const b = new GeoBuilder();
  const y = len * 0.42;
  b.add(sph(8, 6), body, [0, y, 0], [-0.25, 0, 0], [len * 0.2, len * 0.19, len * 0.36], 0, 0.08);
  if (collar) b.add(sph(7, 5), collar, [0, y + len * 0.1, len * 0.2], [0, 0, 0], [len * 0.17, len * 0.16, len * 0.15]);
  b.add(sph(7, 5), head, [0, y + len * 0.2, len * 0.33], [0, 0, 0], len * 0.13);
  b.add(new THREE.ConeGeometry(len * 0.045, len * 0.2, 4), beak, [0, y + len * 0.19, len * 0.5], [Math.PI / 2, 0, 0]);
  b.add(box(len * 0.16, len * 0.025, len * 0.36), wing, [0, y - len * 0.03, -len * 0.42], [0.2, 0, 0]);
  for (const sx of [-1, 1]) {
    b.add(box(len * 0.62, len * 0.025, len * 0.36), wing, [sx * len * 0.42, y + len * 0.1, -len * 0.02], [0, 0, 0], 1, 0, 0, { aPart: [0, 0, sx], aPivot: [y + len * 0.1, 0] });
    if (patch) b.add(box(len * 0.2, len * 0.03, len * 0.22), patch, [sx * len * 0.5, y + len * 0.1, 0], [0, 0, 0], 1, 0, 0, { aPart: [0, 0, sx], aPivot: [y + len * 0.1, 0] });
    b.add(cyl(len * 0.012, len * 0.012, len * 0.26, 3), leg, [sx * len * 0.07, len * 0.13, 0]);
    if (patch) b.add(sph(4, 3), patch, [sx * len * 0.1, y + len * 0.22, len * 0.4], [0, 0, 0], len * 0.035);
  }
  return { geo: b.build(ATTRS), lie: 0, height: len * 0.7 };
}

export function buildAnimalModels(): Record<string, AnimalModel> {
  const chital: QuadSpec = {
    bodyLen: 1.08, bodyR: 0.235, bodyW: 0.19, legLen: 0.6, legR: 0.045, neckLen: 0.42, neckAngle: 0.95, neckR: 0.09,
    headLen: 0.27, headR: 0.085, snout: 0.1, earLen: 0.15, earW: 0.05, tailLen: 0.22, tailR: 0.03, tailAngle: 0.5,
    coat: [0.56, 0.35, 0.19], belly: [0.9, 0.86, 0.78], leg: [0.62, 0.48, 0.34], head: [0.5, 0.33, 0.2], tail: [0.85, 0.8, 0.72], spots: true,
  };
  return {
    chital: quadruped(chital),
    stag: quadruped({ ...chital, antlers: true, neckR: 0.11, coat: [0.5, 0.31, 0.17] }),
    boar: quadruped({
      bodyLen: 1.25, bodyR: 0.31, bodyW: 0.25, legLen: 0.36, legR: 0.06, neckLen: 0.2, neckAngle: 0.15, neckR: 0.2,
      headLen: 0.36, headR: 0.15, snout: 0.22, earLen: 0.12, earW: 0.06, tailLen: 0.22, tailR: 0.02, tailAngle: 0.2,
      coat: [0.19, 0.16, 0.14], belly: [0.26, 0.22, 0.19], leg: [0.13, 0.11, 0.1], head: [0.17, 0.14, 0.13], tail: [0.12, 0.1, 0.09], mane: true,
    }),
    jackal: quadruped({
      bodyLen: 0.74, bodyR: 0.14, bodyW: 0.115, legLen: 0.36, legR: 0.03, neckLen: 0.2, neckAngle: 0.7, neckR: 0.07,
      headLen: 0.2, headR: 0.075, snout: 0.11, earLen: 0.1, earW: 0.04, tailLen: 0.34, tailR: 0.055, tailAngle: 0.7,
      coat: [0.6, 0.47, 0.29], belly: [0.8, 0.72, 0.56], leg: [0.62, 0.45, 0.26], head: [0.6, 0.45, 0.28], tail: [0.4, 0.31, 0.2], darkBack: 0.55,
    }),
    hare: quadruped({
      bodyLen: 0.42, bodyR: 0.105, bodyW: 0.09, legLen: 0.13, legR: 0.025, neckLen: 0.07, neckAngle: 0.8, neckR: 0.06,
      headLen: 0.12, headR: 0.055, snout: 0.02, earLen: 0.16, earW: 0.028, tailLen: 0.06, tailR: 0.035, tailAngle: 1.2,
      coat: [0.5, 0.4, 0.27], belly: [0.82, 0.78, 0.68], leg: [0.52, 0.42, 0.3], head: [0.48, 0.38, 0.26], tail: [0.9, 0.88, 0.82], darkBack: 0.7,
    }),
    crow: bird(0.42, [0.05, 0.05, 0.06], [0.04, 0.04, 0.05], [0.04, 0.04, 0.06], [0.03, 0.03, 0.03], [0.05, 0.05, 0.05], [0.36, 0.35, 0.36]),
    myna: bird(0.25, [0.3, 0.19, 0.12], [0.05, 0.05, 0.05], [0.2, 0.13, 0.09], [0.9, 0.7, 0.1], [0.85, 0.65, 0.1], undefined, [0.92, 0.9, 0.85]),
  };
}
