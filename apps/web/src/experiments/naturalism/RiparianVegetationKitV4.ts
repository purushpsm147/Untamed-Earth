// Opt-in V4 riparian vegetation prototype; never called by production.
import * as THREE from 'three';

export interface EcotoneSampleContext {
  x: number;
  z: number;
  elevation: number;
  waterLevel: number;
  distToWater: number;
  slopeRadians: number;
}

export interface RiparianKitOptions {
  seed: number;
  boundsRadius: number;
  qualityTier: 'low' | 'medium' | 'high';
  sampleEcotone: (x: number, z: number) => EcotoneSampleContext;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a branching trunk + bough geometry (root flare -> primary trunk -> 3 forked scaffold limbs).
 */
function buildBranchingTrunkGeometry(
  height: number,
  baseRadius: number,
  forkRatio: number,
  spread: number
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const sampleBranch = (pts: THREE.Vector3[], r0: number, r1: number, segs = 10, rad = 7) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const frames = curve.computeFrenetFrames(segs, false);
    const pos: number[] = [];
    const norm: number[] = [];
    const ind: number[] = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      // Root collar flare near base (t < 0.18)
      const flare = t < 0.18 ? 1.0 + 0.42 * Math.pow(1.0 - t / 0.18, 2.0) : 1.0;
      const r = THREE.MathUtils.lerp(r0, r1, t) * flare;
      const N = frames.normals[i];
      const B = frames.binormals[i];
      for (let j = 0; j <= rad; j++) {
        const a = (j / rad) * Math.PI * 2;
        const nx = Math.cos(a) * N.x + Math.sin(a) * B.x;
        const ny = Math.cos(a) * N.y + Math.sin(a) * B.y;
        const nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
        pos.push(p.x + r * nx, p.y + r * ny, p.z + r * nz);
        norm.push(nx, ny, nz);
      }
    }
    const stride = rad + 1;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < rad; j++) {
        const a = i * stride + j;
        const b = (i + 1) * stride + j;
        const c = (i + 1) * stride + (j + 1);
        const d = i * stride + (j + 1);
        ind.push(a, b, d, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    g.setIndex(ind);
    return g;
  };

  const forkY = height * forkRatio;
  parts.push(
    sampleBranch(
      [
        new THREE.Vector3(0, -0.15, 0),
        new THREE.Vector3(0.08, forkY * 0.5, -0.05),
        new THREE.Vector3(-0.04, forkY, 0.06),
      ],
      baseRadius,
      baseRadius * 0.58,
      10,
      8
    )
  );

  // 4 asymmetric scaffold boughs
  const boughAngles = [0.2, 1.85, 3.5, 4.95];
  for (let b = 0; b < boughAngles.length; b++) {
    const ang = boughAngles[b];
    const reach = spread * (0.82 + (b % 2) * 0.28);
    const topY = height * (0.82 + (b % 3) * 0.09);
    parts.push(
      sampleBranch(
        [
          new THREE.Vector3(-0.04, forkY * 0.92, 0.06),
          new THREE.Vector3(Math.cos(ang) * reach * 0.52, (forkY + topY) * 0.52, Math.sin(ang) * reach * 0.52),
          new THREE.Vector3(Math.cos(ang) * reach, topY, Math.sin(ang) * reach),
        ],
        baseRadius * 0.46,
        baseRadius * 0.14,
        8,
        6
      )
    );
  }

  return mergeGeosWithWindWeight(parts, 0.15);
}

/**
 * Builds an irregular multi-cluster leaf canopy (breaking lollipop silhouette into 7 overlapping
 * flattened sub-crowns with scalloped edges and internal self-shadowing vertex AO).
 */
function buildClusteredCanopyGeometry(
  clusters: Array<{ x: number; y: number; z: number; rx: number; ry: number; rz: number }>
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  for (const c of clusters) {
    const ico = new THREE.IcosahedronGeometry(1.0, 2);
    const pos = ico.attributes.position;
    const colors: number[] = [];

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);

      // Organic crown scalloping (never a smooth sphere)
      const ripple =
        1.0 +
        0.18 * Math.sin(vx * 5.3 + vy * 3.7) * Math.cos(vz * 4.9) +
        0.11 * Math.cos(vx * 9.1 - vz * 7.3);

      // Flatten bottom of sub-canopy cluster like real light-starved foliage tiers
      const yScale = vy < 0 ? c.ry * 0.55 : c.ry;
      const px = c.x + vx * c.rx * ripple;
      const py = c.y + vy * yScale * ripple;
      const pz = c.z + vz * c.rz * ripple;
      pos.setXYZ(i, px, py, pz);

      // Bake canopy interior AO + sunward top warmth into vertex color
      const ao = THREE.MathUtils.clamp(0.42 + 0.45 * (vy * 0.5 + 0.5) + 0.13 * (px * 0.15), 0.32, 1.05);
      colors.push(ao, ao, ao);
    }
    ico.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    ico.computeVertexNormals();
    parts.push(ico);
  }

  return mergeGeosWithWindWeight(parts, 1.0);
}

function mergeGeosWithWindWeight(geos: THREE.BufferGeometry[], windScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  const col: number[] = [];
  const ind: number[] = [];
  let offset = 0;

  for (const g of geos) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      norm.push(n.getX(i), n.getY(i), n.getZ(i));
      if (c) {
        col.push(c.getX(i), c.getY(i), c.getZ(i));
      } else {
        col.push(windScale, windScale, windScale);
      }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        ind.push(g.index.getX(i) + offset);
      }
    }
    offset += p.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(ind);
  return out;
}

/**
 * Builds a multi-blade tufted grass/sedge clump geometry.
 */
function buildTuftedGrassClumpGeometry(): THREE.BufferGeometry {
  const blades = 7;
  const pos: number[] = [];
  const norm: number[] = [];
  const col: number[] = [];
  const ind: number[] = [];
  let vOffset = 0;

  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2.0 + (b % 2) * 0.25;
    const rad = 0.04 + (b % 3) * 0.035;
    const bx = Math.cos(ang) * rad;
    const bz = Math.sin(ang) * rad;
    const h = 0.34 + (b % 3) * 0.11;
    const droop = 0.12 + (b % 2) * 0.08;
    const nx = -Math.sin(ang);
    const nz = Math.cos(ang);

    const segments = 3;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const w = 0.022 * (1.0 - t * 0.88);
      const reach = Math.pow(t, 1.65) * droop;
      const cx = bx + Math.cos(ang) * reach;
      const cz = bz + Math.sin(ang) * reach;
      const cy = t * h;

      pos.push(cx - nx * w, cy, cz - nz * w);
      pos.push(cx + nx * w, cy, cz + nz * w);
      norm.push(0, 0.85, 0.52, 0, 0.85, 0.52);

      // Root-to-tip ambient occlusion + golden seed-head tint at tip
      const ao = THREE.MathUtils.lerp(0.38, 1.08, t);
      col.push(ao, ao, ao * (1.0 - t * 0.15));
      col.push(ao, ao, ao * (1.0 - t * 0.15));
    }

    for (let s = 0; s < segments; s++) {
      const r0 = vOffset + s * 2;
      const r1 = r0 + 2;
      ind.push(r0, r1, r0 + 1, r1, r1 + 1, r0 + 1);
    }
    vOffset += (segments + 1) * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(ind);
  return geo;
}

/**
 * Builds shoreline emergent reed & cattail cluster geometry.
 */
function buildRiparianReedClusterGeometry(): THREE.BufferGeometry {
  const stalks = 6;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < stalks; i++) {
    const a = (i / stalks) * Math.PI * 2;
    const h = 0.85 + (i % 3) * 0.22;
    const cyl = new THREE.CylinderGeometry(0.005, 0.014, h, 5, 4);
    const pos = cyl.attributes.position;
    const col: number[] = [];
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) + h * 0.5;
      const t = y / h;
      const sway = Math.pow(t, 1.8) * 0.11;
      pos.setXYZ(
        k,
        pos.getX(k) + Math.cos(a) * (0.06 + sway),
        y,
        pos.getZ(k) + Math.sin(a) * (0.06 + sway)
      );
      const ao = THREE.MathUtils.lerp(0.35, 1.0, t);
      col.push(ao, ao, ao);
    }
    cyl.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    cyl.computeVertexNormals();
    parts.push(cyl);
  }
  return mergeGeosWithWindWeight(parts, 1.0);
}

export class RiparianVegetationKit {
  public readonly group = new THREE.Group();
  private readonly windUniform = { value: 0 };
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(options: RiparianKitOptions) {
    const rng = mulberry32(options.seed + 701);
    const tierMul = options.qualityTier === 'high' ? 1.0 : options.qualityTier === 'medium' ? 0.68 : 0.42;

    // Materials with vertex wind shader hook
    const barkMat = new THREE.MeshStandardMaterial({
      color: 0x4b3b2c,
      roughness: 0.92,
      metalness: 0.0,
    });
    const canopyMatA = this.createWindFoliageMaterial(0x3f5e2a, 0.78, 0.14);
    const canopyMatB = this.createWindFoliageMaterial(0x4e6830, 0.82, 0.16);
    const grassMat   = this.createWindFoliageMaterial(0x556f31, 0.76, 0.22);
    const reedMat    = this.createWindFoliageMaterial(0x49612d, 0.72, 0.26);
    const cobbleMat  = new THREE.MeshStandardMaterial({
      color: 0x56514a,
      roughness: 0.65,
      metalness: 0.04,
    });

    this.materials.push(barkMat, canopyMatA, canopyMatB, grassMat, reedMat, cobbleMat);

    // 1. Tree Form A: Riverbank Arjun/Jamun (branching trunk + irregular 7-cluster dome canopy)
    const trunkGeoA = buildBranchingTrunkGeometry(5.6, 0.34, 0.48, 2.2);
    const canopyGeoA = buildClusteredCanopyGeometry([
      { x:  0.0, y: 5.4, z:  0.0, rx: 2.1, ry: 1.35, rz: 2.0 },
      { x: -1.6, y: 4.6, z:  0.8, rx: 1.65, ry: 1.10, rz: 1.55 },
      { x:  1.7, y: 4.8, z: -0.7, rx: 1.75, ry: 1.15, rz: 1.6 },
      { x:  0.6, y: 4.3, z:  1.6, rx: 1.50, ry: 0.95, rz: 1.45 },
      { x: -1.1, y: 4.2, z: -1.5, rx: 1.45, ry: 0.95, rz: 1.45 },
      { x:  0.2, y: 6.2, z: -0.2, rx: 1.40, ry: 0.90, rz: 1.35 },
      { x: -0.5, y: 3.7, z:  0.4, rx: 1.30, ry: 0.75, rz: 1.25 },
    ]);

    // 2. Tree Form B: Slender Layered Riparian Acacia (umbrella tiers breaking horizon repetition)
    const trunkGeoB = buildBranchingTrunkGeometry(6.4, 0.24, 0.56, 2.8);
    const canopyGeoB = buildClusteredCanopyGeometry([
      { x: -1.2, y: 5.5, z:  0.4, rx: 2.4, ry: 0.65, rz: 2.1 },
      { x:  1.4, y: 6.1, z: -0.5, rx: 2.6, ry: 0.68, rz: 2.3 },
      { x:  0.1, y: 6.7, z:  0.8, rx: 2.1, ry: 0.58, rz: 1.9 },
      { x: -0.4, y: 4.6, z: -1.3, rx: 1.7, ry: 0.55, rz: 1.6 },
    ]);

    const grassGeo  = buildTuftedGrassClumpGeometry();
    const reedGeo   = buildRiparianReedClusterGeometry();
    const cobbleGeo = new THREE.DodecahedronGeometry(0.18, 1);
    cobbleGeo.scale(1.35, 0.52, 1.1);
    cobbleGeo.computeVertexNormals();

    // Sample ecotone matrices
    const treeAMatrices: THREE.Matrix4[] = [];
    const treeBMatrices: THREE.Matrix4[] = [];
    const grassMatrices: THREE.Matrix4[] = [];
    const reedMatrices: THREE.Matrix4[] = [];
    const cobbleMatrices: THREE.Matrix4[] = [];

    const dummy = new THREE.Object3D();
    const R = options.boundsRadius;

    // Populate trees (Zone 4: distToWater >= 6.5m, slope < 28 deg, keeping central camera sightline clear)
    const maxTreeCandidates = Math.floor(140 * tierMul);
    for (let i = 0; i < maxTreeCandidates; i++) {
      const x = (rng() * 2 - 1) * R;
      const z = (rng() * 2 - 1) * R;
      // Preserve foreground-to-herd camera corridor near origin
      if (Math.abs(x) < 7.5 && z > -18 && z < 14) continue;

      const eco = options.sampleEcotone(x, z);
      if (eco.distToWater < 6.0 || eco.elevation <= eco.waterLevel + 0.35 || eco.slopeRadians > 0.48) continue;

      const s = 0.78 + rng() * 0.48;
      dummy.position.set(x, eco.elevation - 0.08, z);
      dummy.rotation.set((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08);
      dummy.scale.set(s, s * (0.92 + rng() * 0.18), s);
      dummy.updateMatrix();

      if (rng() < 0.62) {
        treeAMatrices.push(dummy.matrix.clone());
      } else {
        treeBMatrices.push(dummy.matrix.clone());
      }
    }

    // Populate emergent reeds & sedges (Zone 2: 0.4m <= distToWater <= 4.8m)
    const maxReedCandidates = Math.floor(650 * tierMul);
    for (let i = 0; i < maxReedCandidates; i++) {
      const x = (rng() * 2 - 1) * R * 0.85;
      const z = (rng() * 2 - 1) * R * 0.85;
      const eco = options.sampleEcotone(x, z);
      if (eco.distToWater < 0.25 || eco.distToWater > 4.8 || eco.elevation < eco.waterLevel - 0.12) continue;

      const s = 0.75 + rng() * 0.65;
      dummy.position.set(x, eco.elevation - 0.04, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      reedMatrices.push(dummy.matrix.clone());
    }

    // Populate alluvial river cobbles & wet-mud stones (Zone 1: 0.0m <= distToWater <= 3.2m)
    const maxCobbleCandidates = Math.floor(420 * tierMul);
    for (let i = 0; i < maxCobbleCandidates; i++) {
      const x = (rng() * 2 - 1) * R * 0.8;
      const z = (rng() * 2 - 1) * R * 0.8;
      const eco = options.sampleEcotone(x, z);
      if (eco.distToWater < -0.3 || eco.distToWater > 3.2) continue;

      const sx = 0.6 + rng() * 1.4;
      const sy = 0.5 + rng() * 0.8;
      const sz = 0.6 + rng() * 1.3;
      dummy.position.set(x, eco.elevation - 0.03, z);
      dummy.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      cobbleMatrices.push(dummy.matrix.clone());
    }

    // Populate tufted groundcover grass (Zone 3: distToWater >= 2.2m, slope < 32 deg)
    const maxGrassCandidates = Math.floor(2200 * tierMul);
    for (let i = 0; i < maxGrassCandidates; i++) {
      const x = (rng() * 2 - 1) * R * 0.9;
      const z = (rng() * 2 - 1) * R * 0.9;
      const eco = options.sampleEcotone(x, z);
      if (eco.distToWater < 2.0 || eco.elevation <= eco.waterLevel + 0.15 || eco.slopeRadians > 0.55) continue;

      const s = 0.70 + rng() * 0.75;
      dummy.position.set(x, eco.elevation - 0.02, z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      grassMatrices.push(dummy.matrix.clone());
    }

    this.addInstancedPair(trunkGeoA, barkMat, treeAMatrices, true, true);
    this.addInstancedPair(canopyGeoA, canopyMatA, treeAMatrices, true, true);
    this.addInstancedPair(trunkGeoB, barkMat, treeBMatrices, true, true);
    this.addInstancedPair(canopyGeoB, canopyMatB, treeBMatrices, true, true);
    this.addInstancedPair(reedGeo, reedMat, reedMatrices, true, true);
    this.addInstancedPair(cobbleGeo, cobbleMat, cobbleMatrices, true, true);
    this.addInstancedPair(grassGeo, grassMat, grassMatrices, false, true);
  }

  private addInstancedPair(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    matrices: THREE.Matrix4[],
    castShadow: boolean,
    receiveShadow: boolean
  ): void {
    const count = Math.max(1, matrices.length);
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = castShadow;
    inst.receiveShadow = receiveShadow;
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]);
    }
    if (matrices.length === 0) {
      inst.count = 0;
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    this.meshes.push(inst);
  }

  private createWindFoliageMaterial(hexColor: number, roughness: number, windAmp: number): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: hexColor,
      roughness,
      metalness: 0.02,
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windUniform;
      shader.uniforms.uWindAmp = { value: windAmp };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWindTime;
          uniform float uWindAmp;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float heightFactor = clamp(position.y / 3.5, 0.0, 1.5);
          float phase = uWindTime * 1.65 + position.x * 0.7 + position.z * 0.5;
          transformed.x += sin(phase) * uWindAmp * heightFactor * 0.12;
          transformed.z += cos(phase * 0.85) * uWindAmp * heightFactor * 0.08;`
        );
    };

    return mat;
  }

  public update(elapsedSec: number): void {
    this.windUniform.value = elapsedSec;
  }

  public dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }
  }
}