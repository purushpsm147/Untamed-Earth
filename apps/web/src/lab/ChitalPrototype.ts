/**
 * ChitalPrototype — Anatomically Proportioned & Multi-Joint Articulated Chital Deer
 * (*Axis axis*) & Riparian Bird Prototype for Untamed Earth (Assignment C).
 *
 * Why the baseline animal looks like a 1990s game (`animalGeo.ts` / `AnimalView.ts`):
 * 1. Silhouette: A single sphere body + 4 straight 5-sided cylinders (`cyl(..., 5)`) +
 *    cylinder neck + sphere head, with UVs stripped (`deleteAttribute('uv')`).
 * 2. Coat/spots: Vertex-color threshold (`hash3f > 0.62`) on a 12x8 sphere produces
 *    jagged triangular blotches rather than round white spots on a rufous-fawn coat
 *    with a dark dorsal stripe and white throat/underbelly.
 * 3. Animation: Rigid stick legs rotating from the hip with zero knee/hock bending or
 *    hoof lift, and a rigid neck+head block rotating as one piece.
 *
 * What this prototype demonstrates (without modifying `Simulation` or `AnimalView.ts`):
 * - Anatomically tapered torso (chest ribcage, flank waist, rounded haunches, brisket),
 *   S-curved multi-segment neck, sculpted muzzle/jaw, cupped white-lined ears, dark eyes
 *   with preorbital gland detail, lyre-shaped 3-tine antlers (brow tine + main beam +
 *   fork) on adult stags, and two-jointed limbs (upper thigh/humerus + lower cannon/shin +
 *   fetlock/hoof) encoded in compact vertex attributes (`aBone`, `aJoint1`, `aJoint2`).
 * - High-resolution procedural canvas pelage albedo + normal/roughness maps (0 network
 *   bytes, generated once in ~4 ms and shared across all instances) producing crisp
 *   spotted rows, dark dorsal stripe, white bib, and subtle fur sheen.
 * - Read-only ecological pose synthesizer supporting 6 distinct states driven directly
 *   by `Animal` (`beh`, `speed`, `fear`, `hunger`, `thirst`, `energy`):
 *   `idle`, `walking`, `running`, `grazing`, `drinking`, and `alert`.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash3f } from '@untamed/core';
import { type Animal, B } from '@untamed/ecology';

export type ChitalPoseName = 'idle' | 'walking' | 'running' | 'grazing' | 'drinking' | 'alert';

export interface ChitalAnimInputs {
  readonly id: number;
  readonly sex: 0 | 1;
  readonly isAdult: boolean;
  readonly growth: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly beh: number;
  readonly fear: number;
  readonly hunger: number;
  readonly thirst: number;
  readonly energy: number;
}

export interface ChitalPrototypeResources {
  readonly stagMesh: THREE.InstancedMesh;
  readonly doeMesh: THREE.InstancedMesh;
  readonly birdMesh: THREE.InstancedMesh;
  readonly pelageMap: THREE.CanvasTexture;
  readonly pelageNormalMap: THREE.CanvasTexture;
  dispose(): void;
}

/**
 * Maps authoritative read-only `Animal` state into one of the 6 documentary animation poses.
 * Never mutates the animal or simulation state.
 */
export function resolveChitalPose(a: Pick<Animal, 'beh' | 'speed' | 'fear'>): ChitalPoseName {
  if (a.fear > 0.28 || a.beh === B.Flee) {
    return a.speed > 1.2 ? 'running' : 'alert';
  }
  if (a.speed > 4.2 || a.beh === B.Chase) {
    return 'running';
  }
  if (a.speed > 0.25) {
    return 'walking';
  }
  // Searching for water is navigation, not drinking. Only Drink animates contact with water.
  if (a.beh === B.Drink) {
    return 'drinking';
  }
  if (a.beh === B.Forage || a.beh === B.Feed) {
    return 'grazing';
  }
  return 'idle';
}

/**
 * Generates a 512x512 procedural spotted-deer (*Axis axis*) pelage texture and
 * matching fur-grain normal map in memory (CC0 / 100% original procedural canvas).
 * Memory footprint: ~1.05 MB GPU RGBA each, 0 KB network download.
 */
export function createChitalPelageTextures(): {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
} {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  // Base rufous-chestnut gradient (UV.y: 0 = belly/throat, 0.5 = flank, 1.0 = dorsal spine)
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0.0, '#3a2010'); // dark dorsal spine
  grad.addColorStop(0.14, '#7d4620'); // upper rich chestnut
  grad.addColorStop(0.58, '#a66332'); // warm golden-rufous flank
  grad.addColorStop(0.76, '#c89b6e'); // lower flank transition
  grad.addColorStop(0.86, '#efe7dc'); // cream-white belly & throat
  grad.addColorStop(1.0, '#f4eee6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Fine directional hair strokes
  for (let i = 0; i < 6500; i++) {
    const u = hash3f(i, 1, 17);
    const v = hash3f(i, 2, 17);
    const x = u * size;
    const y = v * size;
    const shade = (hash3f(i, 3, 17) - 0.5) * 22;
    ctx.strokeStyle =
      shade > 0 ? `rgba(255,235,210,0.12)` : `rgba(35,16,6,0.14)`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 5, y + 1.5);
    ctx.stroke();
  }

  // Characteristic chital white spots arranged in longitudinal chains along flanks
  for (let row = 0; row < 11; row++) {
    const vCenter = 0.14 + (row / 10) * 0.56;
    const spotsInRow = 18;
    for (let col = 0; col < spotsInRow; col++) {
      const seed = row * 100 + col;
      const u = (col + 0.5 + (hash3f(seed, 4, 9) - 0.5) * 0.55) / spotsInRow;
      const v = vCenter + (hash3f(seed, 5, 9) - 0.5) * 0.038;
      // Avoid spots on head/legs region (u > 0.78)
      if (u > 0.78) continue;
      const r = (4.2 + hash3f(seed, 6, 9) * 4.5) * (1 - Math.abs(v - 0.42) * 0.6);
      const sx = u * size;
      const sy = v * size;
      const rg = ctx.createRadialGradient(sx, sy, r * 0.15, sx, sy, r);
      rg.addColorStop(0, 'rgba(250, 245, 235, 0.95)');
      rg.addColorStop(0.65, 'rgba(242, 232, 215, 0.82)');
      rg.addColorStop(1, 'rgba(166, 99, 50, 0.0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * 1.15, r * 0.88, (hash3f(seed, 7, 9) - 0.5) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const albedo = new THREE.CanvasTexture(c);
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.needsUpdate = true;

  // Normal map canvas (short fur grain)
  const nc = document.createElement('canvas');
  nc.width = 256;
  nc.height = 256;
  const nctx = nc.getContext('2d')!;
  const img = nctx.createImageData(256, 256);
  const data = img.data;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const idx = (y * 256 + x) * 4;
      const hL = hash3f((x - 1) & 255, y, 31);
      const hR = hash3f((x + 1) & 255, y, 31);
      const hU = hash3f(x, (y - 1) & 255, 31);
      const hD = hash3f(x, (y + 1) & 255, 31);
      const dx = (hL - hR) * 0.35;
      const dy = (hU - hD) * 0.2;
      data[idx] = Math.round((dx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((dy * 0.5 + 0.5) * 255);
      data[idx + 2] = 235;
      data[idx + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  const normal = new THREE.CanvasTexture(nc);
  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.RepeatWrapping;
  normal.needsUpdate = true;

  return { albedo, normal };
}

/**
 * Helper to build a sculptable part with cylindrical/anatomical UVs and vertex bone tags:
 * `aBone`:
 *   x = partId (0 = torso, 1 = FL leg, 2 = FR leg, 3 = HL leg, 4 = HR leg, 5 = neck, 6 = head, 7 = earL, 8 = earR, 9 = tail)
 *   y = segmentWeight (0..1 along part for smooth bending; for legs: 0..1 upper limb, 1..2 lower limb/cannon, >2 hoof)
 *   z = pivotY (primary joint Y in model space)
 *   w = pivotZ (primary joint Z in model space)
 * `aSubPivot`:
 *   x = secondary joint Y (knee/hock/poll Y)
 *   y = secondary joint Z (knee/hock/poll Z)
 */
function tagGeometry(
  geo: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  boneId: number,
  pivotY: number,
  pivotZ: number,
  subPivotY: number,
  subPivotZ: number,
  uvMode: 'torso' | 'limb' | 'head' | 'antler' | 'white' | 'dark',
  weightFn?: (localY: number, worldY: number, worldZ: number) => number,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position!;
  const n = pos.count;

  const localYArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    localYArr[i] = pos.getY(i);
  }

  g.applyMatrix4(matrix);
  g.computeVertexNormals();

  const uvs = new Float32Array(n * 2);
  const cols = new Float32Array(n * 3);
  const aBone = new Float32Array(n * 4);
  const aSub = new Float32Array(n * 2);

  for (let i = 0; i < n; i++) {
    const wx = pos.getX(i);
    const wy = pos.getY(i);
    const wz = pos.getZ(i);
    const ly = localYArr[i]!;

    // Compute UVs into the pelage atlas
    let u = 0.85;
    let v = 0.45;
    let r = 1.0;
    let gr = 1.0;
    let b = 1.0;

    if (uvMode === 'torso') {
      u = THREE.MathUtils.clamp((wz + 0.65) / 1.35, 0.02, 0.74);
      // Map vertical position relative to torso midline into dorsal (0) -> belly (1)
      const relY = (wy - 0.68) / 0.46;
      const side = Math.abs(wx) / 0.22;
      v = THREE.MathUtils.clamp(0.52 - relY * 0.48 + (1 - side) * (relY < 0 ? 0.15 : 0), 0.02, 0.98);
    } else if (uvMode === 'head') {
      u = 0.86;
      v = THREE.MathUtils.clamp(0.32 - (wy - 1.15) * 0.5, 0.12, 0.78);
    } else if (uvMode === 'limb') {
      u = 0.88;
      v = THREE.MathUtils.clamp(0.68 + (0.65 - wy) * 0.35, 0.52, 0.92);
    } else if (uvMode === 'antler') {
      u = 0.92;
      v = 0.75;
      const tip = THREE.MathUtils.clamp((wy - 1.35) / 0.55, 0, 1);
      r = THREE.MathUtils.lerp(0.46, 0.88, tip);
      gr = THREE.MathUtils.lerp(0.38, 0.82, tip);
      b = THREE.MathUtils.lerp(0.28, 0.7, tip);
    } else if (uvMode === 'white') {
      u = 0.9;
      v = 0.95;
      r = 0.98;
      gr = 0.96;
      b = 0.93;
    } else if (uvMode === 'dark') {
      u = 0.9;
      v = 0.04;
      r = 0.12;
      gr = 0.1;
      b = 0.09;
    }

    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
    cols[i * 3] = r;
    cols[i * 3 + 1] = gr;
    cols[i * 3 + 2] = b;

    const w = weightFn ? weightFn(ly, wy, wz) : 1.0;
    aBone[i * 4] = boneId;
    aBone[i * 4 + 1] = w;
    aBone[i * 4 + 2] = pivotY;
    aBone[i * 4 + 3] = pivotZ;

    aSub[i * 2] = subPivotY;
    aSub[i * 2 + 1] = subPivotZ;
  }

  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.setAttribute('aBone', new THREE.BufferAttribute(aBone, 4));
  g.setAttribute('aSubPivot', new THREE.BufferAttribute(aSub, 2));
  return g;
}

/**
 * Builds an anatomical Chital deer geometry (`stag` with lyre 3-tine antlers or `doe` without).
 */
export function buildAnatomicalChitalGeometry(withAntlers: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  const addPart = (
    geo: THREE.BufferGeometry,
    pos: [number, number, number],
    rot: [number, number, number],
    scale: [number, number, number],
    boneId: number,
    pivot: [number, number],
    subPivot: [number, number],
    uvMode: 'torso' | 'limb' | 'head' | 'antler' | 'white' | 'dark',
    weightFn?: (ly: number, wy: number, wz: number) => number,
  ): void => {
    m.compose(p.set(...pos), q.setFromEuler(e.set(...rot)), s.set(...scale));
    parts.push(
      tagGeometry(geo, m, boneId, pivot[0], pivot[1], subPivot[0], subPivot[1], uvMode, weightFn),
    );
    geo.dispose();
  };

  // 1. Sculpted anatomical torso: deep chest/brisket, tapered flank/loin, muscular haunches/rump
  const torsoGeo = new THREE.SphereGeometry(1, 24, 16);
  const tp = torsoGeo.attributes.position!;
  for (let i = 0; i < tp.count; i++) {
    let x = tp.getX(i);
    let y = tp.getY(i);
    const z = tp.getZ(i); // -1 = rump, +1 = chest
    // Pinch waist/flank around z = -0.15, widen chest (z > 0.3) and haunches (z < -0.45)
    const chestBulge = Math.exp(-((z - 0.45) ** 2) / 0.22) * 0.16;
    const haunchBulge = Math.exp(-((z + 0.55) ** 2) / 0.2) * 0.14;
    const waistTuck = y < 0 ? Math.exp(-((z + 0.12) ** 2) / 0.18) * 0.22 : 0;
    const withersLift = y > 0 ? Math.exp(-((z - 0.38) ** 2) / 0.15) * 0.14 : 0;
    x *= 0.88 + chestBulge + haunchBulge;
    y = y * (0.92 + chestBulge * 0.5) + waistTuck + withersLift;
    tp.setXYZ(i, x, y, z);
  }
  addPart(torsoGeo, [0, 0.84, 0.0], [0, 0, 0], [0.21, 0.24, 0.58], 0, [0.84, 0], [0.84, 0], 'torso');

  // White throat bib / brisket patch
  addPart(
    new THREE.SphereGeometry(1, 12, 10),
    [0, 0.79, 0.49],
    [0.25, 0, 0],
    [0.12, 0.15, 0.14],
    0,
    [0.84, 0],
    [0.84, 0],
    'white',
  );

  // 2. Four 3-segment articulated limbs (upper thigh/shoulder + lower cannon + dark cloven hoof)
  const limbConfigs: Array<{ sx: number; sz: number; boneId: number; isHind: boolean }> = [
    { sx: -1, sz: 1, boneId: 1, isHind: false },
    { sx: 1, sz: 1, boneId: 2, isHind: false },
    { sx: -1, sz: -1, boneId: 3, isHind: true },
    { sx: 1, sz: -1, boneId: 4, isHind: true },
  ];

  for (const lc of limbConfigs) {
    const lx = lc.sx * (lc.isHind ? 0.135 : 0.125);
    const hipZ = lc.sz * (lc.isHind ? 0.41 : 0.39);
    const hipY = lc.isHind ? 0.82 : 0.79;
    const kneeY = 0.42;
    const kneeZ = hipZ + (lc.isHind ? -0.04 : 0.02);

    // Upper muscular thigh / humerus
    addPart(
      new THREE.CylinderGeometry(lc.isHind ? 0.088 : 0.068, 0.038, 0.44, 10, 4),
      [lx, 0.61, (hipZ + kneeZ) * 0.5],
      [lc.isHind ? 0.1 : -0.05, 0, 0],
      [1, 1, lc.isHind ? 1.25 : 1.05],
      lc.boneId,
      [hipY, hipZ],
      [kneeY, kneeZ],
      'torso',
      (_ly, wy) => THREE.MathUtils.clamp((hipY - wy) / Math.max(0.05, hipY - kneeY), 0, 1),
    );

    // Knee / hock joint sphere
    addPart(
      new THREE.SphereGeometry(0.036, 8, 6),
      [lx, kneeY, kneeZ],
      [0, 0, 0],
      [0.95, 1.05, 1.05],
      lc.boneId,
      [hipY, hipZ],
      [kneeY, kneeZ],
      'limb',
      () => 1.0,
    );

    // Slender lower cannon bone / shin
    addPart(
      new THREE.CylinderGeometry(0.033, 0.022, 0.38, 9, 4),
      [lx, 0.22, kneeZ + (lc.isHind ? 0.015 : 0)],
      [lc.isHind ? -0.04 : 0.02, 0, 0],
      [1, 1, 1],
      lc.boneId,
      [hipY, hipZ],
      [kneeY, kneeZ],
      'limb',
      (_ly, wy) => 1.0 + THREE.MathUtils.clamp((kneeY - wy) / 0.38, 0, 1),
    );

    // Dark cloven hoof + pastern
    addPart(
      new THREE.CylinderGeometry(0.023, 0.031, 0.065, 8, 1),
      [lx, 0.032, kneeZ + 0.015],
      [0.12, 0, 0],
      [0.95, 1, 1.25],
      lc.boneId,
      [hipY, hipZ],
      [kneeY, kneeZ],
      'dark',
      () => 2.0,
    );
  }

  // 3. Graceful S-curved neck (boneId = 5, base pivot at shoulder [0.94, 0.44], poll sub-pivot [1.28, 0.62])
  const neckBase: [number, number] = [0.94, 0.44];
  const pollPivot: [number, number] = [1.28, 0.61];
  const neckGeo = new THREE.CylinderGeometry(0.068, 0.115, 0.46, 12, 6);
  addPart(
    neckGeo,
    [0, 1.11, 0.525],
    [0.42, 0, 0],
    [0.88, 1, 1.08],
    5,
    neckBase,
    pollPivot,
    'torso',
    (_ly, wy) => THREE.MathUtils.clamp((wy - 0.9) / 0.38, 0, 1),
  );
  // White throat stripe along front of neck
  addPart(
    new THREE.CylinderGeometry(0.038, 0.055, 0.42, 8, 4),
    [0, 1.09, 0.575],
    [0.42, 0, 0],
    [0.7, 1, 0.5],
    5,
    neckBase,
    pollPivot,
    'white',
    (_ly, wy) => THREE.MathUtils.clamp((wy - 0.9) / 0.38, 0, 1),
  );

  // 4. Sculpted head, tapering muzzle, dark nose pad, and eyes (boneId = 6)
  addPart(
    new THREE.SphereGeometry(1, 14, 10),
    [0, 1.3, 0.64],
    [0.18, 0, 0],
    [0.078, 0.082, 0.12],
    6,
    neckBase,
    pollPivot,
    'head',
    () => 1.0,
  );
  // Tapering muzzle / bridge of nose
  addPart(
    new THREE.CylinderGeometry(0.036, 0.062, 0.19, 10, 2),
    [0, 1.265, 0.765],
    [Math.PI / 2 + 0.22, 0, 0],
    [0.92, 1, 0.88],
    6,
    neckBase,
    pollPivot,
    'head',
    () => 1.0,
  );
  // Rhinarium (wet dark nose pad)
  addPart(
    new THREE.SphereGeometry(0.032, 8, 6),
    [0, 1.245, 0.855],
    [0, 0, 0],
    [1.0, 0.85, 0.7],
    6,
    neckBase,
    pollPivot,
    'dark',
    () => 1.0,
  );

  // Eyes & cupped ears (boneId = 7 for left ear, 8 for right ear)
  for (const sx of [-1, 1]) {
    addPart(
      new THREE.SphereGeometry(0.018, 8, 6),
      [sx * 0.068, 1.315, 0.68],
      [0, 0, 0],
      [0.7, 1, 1.15],
      6,
      neckBase,
      pollPivot,
      'dark',
      () => 1.0,
    );
    const earBone = sx < 0 ? 7 : 8;
    // Outer ear pinna
    addPart(
      new THREE.ConeGeometry(0.042, 0.165, 8, 2),
      [sx * 0.085, 1.39, 0.58],
      [-0.28, 0, -sx * 0.58],
      [0.65, 1, 0.38],
      earBone,
      neckBase,
      pollPivot,
      'head',
      () => 1.0,
    );
    // White inner ear lining
    addPart(
      new THREE.ConeGeometry(0.028, 0.13, 6, 1),
      [sx * 0.088, 1.385, 0.592],
      [-0.28, 0, -sx * 0.58],
      [0.55, 1, 0.25],
      earBone,
      neckBase,
      pollPivot,
      'white',
      () => 1.0,
    );
  }

  // 5. Lyre-shaped 3-tine Chital Stag Antlers (pedicle + brow tine + sweeping main beam + royal fork)
  if (withAntlers) {
    for (const sx of [-1, 1]) {
      // Lower main beam sweeping back and outward
      addPart(
        new THREE.CylinderGeometry(0.014, 0.022, 0.36, 7, 3),
        [sx * 0.095, 1.48, 0.52],
        [-0.58, 0, -sx * 0.36],
        [1, 1, 1],
        6,
        neckBase,
        pollPivot,
        'antler',
        () => 1.0,
      );
      // Upper lyre beam curving upward and slightly inward toward tips
      addPart(
        new THREE.CylinderGeometry(0.006, 0.014, 0.38, 7, 3),
        [sx * 0.165, 1.72, 0.37],
        [-0.12, 0, -sx * 0.08],
        [1, 1, 1],
        6,
        neckBase,
        pollPivot,
        'antler',
        () => 1.0,
      );
      // Characteristic forward-arching brow tine (forms ~90 deg angle with beam)
      addPart(
        new THREE.CylinderGeometry(0.005, 0.014, 0.22, 6, 2),
        [sx * 0.075, 1.42, 0.67],
        [1.05, 0, -sx * 0.18],
        [1, 1, 1],
        6,
        neckBase,
        pollPivot,
        'antler',
        () => 1.0,
      );
      // Inner trez / fork tine on upper beam
      addPart(
        new THREE.CylinderGeometry(0.005, 0.011, 0.19, 6, 2),
        [sx * 0.13, 1.66, 0.46],
        [0.48, 0, sx * 0.22],
        [1, 1, 1],
        6,
        neckBase,
        pollPivot,
        'antler',
        () => 1.0,
      );
    }
  }

  // 6. Tail with rufous dorsal top and bright white underside (boneId = 9, flashes up when alert/fleeing)
  const tailPivot: [number, number] = [0.92, -0.54];
  addPart(
    new THREE.CylinderGeometry(0.032, 0.016, 0.24, 8, 3),
    [0, 0.84, -0.59],
    [0.42, 0, 0],
    [0.85, 1, 0.85],
    9,
    tailPivot,
    tailPivot,
    'torso',
    (_ly, wy) => THREE.MathUtils.clamp((0.92 - wy) / 0.22, 0, 1),
  );
  addPart(
    new THREE.CylinderGeometry(0.026, 0.014, 0.22, 6, 2),
    [0, 0.83, -0.575],
    [0.42, 0, 0],
    [0.75, 1, 0.5],
    9,
    tailPivot,
    tailPivot,
    'white',
    (_ly, wy) => THREE.MathUtils.clamp((0.92 - wy) / 0.22, 0, 1),
  );

  const merged = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Multi-joint vertex-shader material for Chital deer:
 * Consumes per-instance attributes:
 * - `iPoseA` (vec4):
 *   x = gait phase (rad)
 *   y = gait amplitude (0 = idle, 0.45 = walk, 0.85 = run)
 *   z = neck angle delta (rad: +1.15 when grazing/drinking, -0.22 when alert)
 *   w = head pitch delta relative to neck (rad: level scoop when grazing/drinking, raised when alert)
 * - `iPoseB` (vec4):
 *   x = alert factor (0..1: raises white tail flag, perks ears forward)
 *   y = ear/tail idle flick phase (rad)
 *   z = breath & chew phase (rad)
 *   w = knee/hock bend multiplier
 */
export function createChitalPBRMaterial(
  pelageMap: THREE.CanvasTexture,
  pelageNormalMap: THREE.CanvasTexture,
  sunDirUniform: { value: THREE.Vector3 },
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: pelageMap,
    normalMap: pelageNormalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    vertexColors: true,
    roughness: 0.74,
    metalness: 0.02,
  });
  mat.customProgramCacheKey = () => 'chital-anatomical-pbr-v1';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = sunDirUniform;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aBone;
        attribute vec2 aSubPivot;
        attribute vec4 iPoseA;
        attribute vec4 iPoseB;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;

        vec2 rot2D(vec2 p, vec2 piv, float a) {
          vec2 d = p - piv;
          float c = cos(a), s = sin(a);
          return piv + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        int boneId = int(aBone.x + 0.5);
        float segW = aBone.y;
        vec2 piv1 = aBone.zw;
        vec2 piv2 = aSubPivot;

        float phase = iPoseA.x;
        float amp = iPoseA.y;
        float neckAng = iPoseA.z;
        float headAng = iPoseA.w;
        float alertF = iPoseB.x;
        float flickT = iPoseB.y;
        float breathT = iPoseB.z;

        // 0: Torso ribcage breathing + subtle gait spine pitch/bob
        if (boneId == 0) {
          float breath = sin(breathT * 2.4) * 0.008;
          transformed.x *= (1.0 + breath);
          transformed.y += breath * 0.5;
          if (amp > 0.05) {
            transformed.y += abs(sin(phase)) * amp * 0.045;
          }
        }
        // 1..4: Two-jointed limbs (1=FL, 2=FR, 3=HL, 4=HR)
        else if (boneId >= 1 && boneId <= 4) {
          // 4-beat walk / diagonal trot phase offsets
          float legOffset = (boneId == 1) ? 0.0 : (boneId == 4) ? 0.45 : (boneId == 2) ? 3.14159 : 3.59;
          float lp = phase + legOffset;
          float swing = sin(lp) * amp;
          // Forelegs splay slightly when grazing/drinking deep
          float grazeStance = clamp(neckAng - 0.35, 0.0, 0.8) * ((boneId == 1) ? 0.14 : (boneId == 2) ? -0.14 : 0.0);
          float upperAng = swing * 0.68 + grazeStance;

          transformed.yz = rot2D(transformed.yz, piv1, upperAng);

          // Knee / hock flexion during forward protraction (lifts hoof clear of ground)
          if (segW >= 0.95) {
            float lift = max(0.0, cos(lp)) * amp * iPoseB.w;
            float isHind = (boneId >= 3) ? -1.0 : 1.0;
            float lowerAng = isHind * lift * 0.92;
            vec2 movedKnee = rot2D(piv2, piv1, upperAng);
            transformed.yz = rot2D(transformed.yz, movedKnee, lowerAng);
          }
        }
        // 5..8: Neck (5), Head (6), and Ears (7, 8)
        else if (boneId >= 5 && boneId <= 8) {
          float wNeck = (boneId == 5) ? segW : 1.0;
          transformed.yz = rot2D(transformed.yz, piv1, neckAng * wNeck);

          if (boneId >= 6) {
            vec2 movedPoll = rot2D(piv2, piv1, neckAng);
            // Subtle grazing chew / drinking lap nod
            float nod = sin(breathT * 5.2) * 0.045 * clamp(neckAng, 0.0, 1.0);
            transformed.yz = rot2D(transformed.yz, movedPoll, headAng + nod);

            // Lateral look scan when idle/alert
            float scanYaw = sin(flickT * 0.7) * (0.08 + alertF * 0.18);
            vec2 dxz = transformed.xz - vec2(0.0, movedPoll.y);
            float cy = cos(scanYaw), sy = sin(scanYaw);
            transformed.xz = vec2(0.0, movedPoll.y) + vec2(dxz.x * cy - dxz.y * sy, dxz.x * sy + dxz.y * cy);

            // Ear flick & alert forward cup
            if (boneId == 7 || boneId == 8) {
              float side = (boneId == 7) ? -1.0 : 1.0;
              float flick = sin(flickT * 3.8 + side * 1.4) * 0.12 + alertF * 0.35;
              transformed.z += flick * 0.025;
            }
          }
        }
        // 9: Tail swish & white-flag alarm raise
        else if (boneId == 9) {
          float flagUp = -alertF * 1.35 * segW;
          transformed.yz = rot2D(transformed.yz, piv1, flagUp);
          transformed.x += sin(flickT * 4.5) * 0.035 * segW;
        }`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          mat4 wm = modelMatrix * instanceMatrix;
        #else
          mat4 wm = modelMatrix;
        #endif
        vWorldPos = (wm * vec4(transformed, 1.0)).xyz;
        vWorldNormal = normalize(mat3(wm) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `// Velvet rim-lighting / fur sheen along grazing view angles
        vec3 viewDirW = normalize(cameraPosition - vWorldPos);
        vec3 nW = normalize(vWorldNormal);
        float rim = pow(1.0 - max(dot(nW, viewDirW), 0.0), 3.2);
        float sunForward = max(dot(viewDirW, -normalize(uSunDir)), 0.0);
        vec3 rimGlow = vec3(0.95, 0.82, 0.62) * rim * (0.18 + 0.45 * sunForward);
        gl_FragColor.rgb += rimGlow;
        #include <dithering_fragment>`,
      );
  };

  return mat;
}

/**
 * Computes per-instance pose vectors (`iPoseA`, `iPoseB`) from authoritative animal state.
 */
export function computeChitalInstancePose(
  input: ChitalAnimInputs,
  phase: number,
  timeSec: number,
): { poseA: [number, number, number, number]; poseB: [number, number, number, number] } {
  const pose = resolveChitalPose({ beh: input.beh, speed: input.speed, fear: input.fear });

  let amp = 0;
  let neckAng = 0;
  let headAng = 0;
  let alertF = THREE.MathUtils.clamp(input.fear * 1.6, 0, 1);
  let kneeMult = 1.0;

  switch (pose) {
    case 'running':
      amp = 0.88;
      neckAng = 0.28;
      headAng = -0.18;
      alertF = 1.0;
      kneeMult = 1.35;
      break;
    case 'walking':
      amp = 0.48;
      neckAng = 0.08 + Math.sin(phase * 2) * 0.04;
      headAng = -0.05;
      kneeMult = 1.05;
      break;
    case 'grazing':
      amp = 0.0;
      // Deep neck reach to ground + counter-angled head so muzzle meets grass blades
      neckAng = 1.02 + Math.sin(timeSec * 1.8 + input.id) * 0.06;
      headAng = -0.52;
      break;
    case 'drinking':
      amp = 0.0;
      // Deeper reach to water surface at river edge
      neckAng = 1.14;
      headAng = -0.62 + Math.sin(timeSec * 3.5 + input.id) * 0.03;
      break;
    case 'alert':
      amp = 0.0;
      // Erect posture, raised head, perked ears, raised white tail flag
      neckAng = -0.24;
      headAng = 0.22;
      alertF = 1.0;
      break;
    case 'idle':
    default:
      amp = 0.0;
      neckAng = Math.sin(timeSec * 0.7 + input.id) * 0.05;
      headAng = Math.cos(timeSec * 0.9 + input.id * 1.3) * 0.04;
      break;
  }

  return {
    poseA: [phase, amp, neckAng, headAng],
    poseB: [alertF, timeSec + input.id * 1.7, timeSec + input.id * 0.9, kneeMult],
  };
}
