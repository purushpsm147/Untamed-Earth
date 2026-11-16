// Isolated V4 experiment — original proposed rig, independently corrected; NOT production.
import * as THREE from 'three';

export type ChitalGaitState = 'idle' | 'walk' | 'trot' | 'flee' | 'graze' | 'drink' | 'alert';

export interface ChitalSimInput {
  id: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  state: ChitalGaitState;
  sex: 'stag' | 'hind' | 'fawn';
  seed: number;
}

export interface TerrainQuery {
  getHeightAt(x: number, z: number): number;
  getNormalAt?(x: number, z: number): THREE.Vector3;
}

export interface ChitalGroundingDiagnostic {
  animalId: number;
  maxStanceFootErrorMeters: number;
  stanceFeetWithin5mm: boolean;
  maxStanceFootHorizontalErrorMeters: number;
  footHorizontalErrorsMeters: [number, number, number, number];
  footHeightsWorld: [number, number, number, number];
  terrainHeightsWorld: [number, number, number, number];
}

interface SpineCrossSection {
  /** Normalized station along spine: 0 = tail base, 1 = nose tip */
  s: number;
  /** Spine center in model space (Y up, +Z forward, meters) */
  y: number;
  z: number;
  /** Half-width (X), dorsal height above center (+Y), ventral depth below center (-Y) */
  rx: number;
  ryTop: number;
  ryBot: number;
  /** Primary and secondary bone indices & weights [b0, b1, w0, w1] */
  skin: [number, number, number, number];
}

/**
 * Bone indices for the unified Chital SkinnedMesh:
 * 0: Root
 * 1: Pelvis
 * 2: SpineMid (Lumbar/Thoracic)
 * 3: Chest (Withers/Scapula)
 * 4: NeckBase
 * 5: NeckUpper
 * 6: Head
 * 7: Jaw
 */
const SPINE_STATIONS: SpineCrossSection[] = [
  // Tail & rump
  { s: 0.00, y: 0.78, z: -0.56, rx: 0.035, ryTop: 0.04, ryBot: 0.04, skin: [1, 1, 1.0, 0.0] },
  { s: 0.06, y: 0.83, z: -0.48, rx: 0.115, ryTop: 0.11, ryBot: 0.14, skin: [1, 1, 1.0, 0.0] },
  // Haunch / Pelvis
  { s: 0.16, y: 0.86, z: -0.34, rx: 0.155, ryTop: 0.14, ryBot: 0.19, skin: [1, 2, 0.85, 0.15] },
  // Flank / Loin (tucked abdomen)
  { s: 0.30, y: 0.84, z: -0.14, rx: 0.148, ryTop: 0.13, ryBot: 0.17, skin: [2, 1, 0.75, 0.25] },
  // Barrel / Ribcage
  { s: 0.45, y: 0.85, z:  0.08, rx: 0.168, ryTop: 0.15, ryBot: 0.23, skin: [2, 3, 0.55, 0.45] },
  // Withers & Brisket (deep chest)
  { s: 0.58, y: 0.89, z:  0.28, rx: 0.152, ryTop: 0.17, ryBot: 0.24, skin: [3, 2, 0.85, 0.15] },
  // Cervico-thoracic transition (smooth shoulder-to-neck blend)
  { s: 0.67, y: 0.96, z:  0.40, rx: 0.098, ryTop: 0.12, ryBot: 0.13, skin: [4, 3, 0.70, 0.30] },
  // Mid-neck taper
  { s: 0.76, y: 1.10, z:  0.49, rx: 0.072, ryTop: 0.09, ryBot: 0.09, skin: [5, 4, 0.75, 0.25] },
  // Throat / Atlas-Axis junction
  { s: 0.83, y: 1.22, z:  0.55, rx: 0.064, ryTop: 0.08, ryBot: 0.08, skin: [5, 6, 0.50, 0.50] },
  // Cranium / Orbital brow ridge
  { s: 0.89, y: 1.25, z:  0.63, rx: 0.074, ryTop: 0.075, ryBot: 0.075, skin: [6, 5, 0.90, 0.10] },
  // Bridge of muzzle
  { s: 0.95, y: 1.20, z:  0.74, rx: 0.044, ryTop: 0.048, ryBot: 0.052, skin: [6, 7, 0.80, 0.20] },
  // Rhinarium / Nose pad tip
  { s: 1.00, y: 1.17, z:  0.82, rx: 0.028, ryTop: 0.032, ryBot: 0.030, skin: [6, 7, 0.75, 0.25] },
];

/**
 * Builds a single continuous, watertight lofted BufferGeometry for the Chital torso, neck, and head
 * with rest-pose body coordinates stored in `aBodyPos` for swim-free procedural pelage mapping.
 */
function buildContinuousBodyGeometry(radialSegments = 24): THREE.BufferGeometry {
  const rings = SPINE_STATIONS.length;
  const positions: number[] = [];
  const bodyPos: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < rings; i++) {
    const st = SPINE_STATIONS[i];
    for (let j = 0; j <= radialSegments; j++) {
      const u = j / radialSegments;
      const theta = u * Math.PI * 2.0; // 0 = dorsal top, PI = ventral belly
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      // Asymmetric anatomical cross-section: pear/teardrop ribcage & flattened muzzle bridge
      const ry = cosT >= 0 ? st.ryTop : st.ryBot;
      const shoulderDefinition = st.s > 0.45 && st.s < 0.65 ? 1.0 - 0.12 * Math.pow(sinT, 4) : 1.0;
      const x = sinT * st.rx * shoulderDefinition;
      const y = st.y + cosT * ry;
      const z = st.z;

      positions.push(x, y, z);
      bodyPos.push(x, y, z);
      uvs.push(st.s, u);
      skinIndices.push(st.skin[0], st.skin[1], 0, 0);
      skinWeights.push(st.skin[2], st.skin[3], 0, 0);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aBodyPos', new THREE.Float32BufferAttribute(bodyPos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  // Cap both nonzero-radius terminal rings; an uncapped loft is NOT watertight.
  const addCapCenter = (st: SpineCrossSection): number => {
    const centerIndex = positions.length / 3;
    positions.push(0, st.y, st.z);
    bodyPos.push(0, st.y, st.z);
    uvs.push(st.s, 0.5);
    skinIndices.push(st.skin[0], st.skin[1], 0, 0);
    skinWeights.push(st.skin[2], st.skin[3], 0, 0);
    return centerIndex;
  };
  const tailCenter = addCapCenter(SPINE_STATIONS[0]);
  const noseCenter = addCapCenter(SPINE_STATIONS[rings - 1]);
  for (let j = 0; j < radialSegments; j++) {
    // Tail cap faces -Z, nose cap faces +Z.
    indices.push(tailCenter, j, j + 1);
    const end = (rings - 1) * stride + j;
    indices.push(noseCenter, end + 1, end);
  }

  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an anatomically tapered limb segment with joint condyle swell and cloven hoof tip.
 */
function buildTaperedLimbSegment(
  length: number,
  rTop: number,
  rMid: number,
  rBot: number,
  isHoofSegment: boolean,
  bodyYOffset: number,
  bodyZOffset: number
): THREE.BufferGeometry {
  const radial = 14;
  const stacks = 10;
  const positions: number[] = [];
  const bodyPos: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= stacks; i++) {
    const t = i / stacks;
    const y = -t * length;
    let r: number;
    if (t < 0.5) {
      r = THREE.MathUtils.lerp(rTop, rMid, t * 2.0);
    } else {
      r = THREE.MathUtils.lerp(rMid, rBot, (t - 0.5) * 2.0);
    }

    for (let j = 0; j <= radial; j++) {
      const u = j / radial;
      const theta = u * Math.PI * 2.0;
      let x = Math.sin(theta) * r;
      let z = Math.cos(theta) * r;

      // Cloven hoof forward wedge & cleft at bottom of cannon bone
      if (isHoofSegment && t > 0.78) {
        const hoofT = (t - 0.78) / 0.22;
        z += hoofT * 0.024 * Math.max(0, Math.cos(theta));
        x *= 1.0 + 0.18 * hoofT;
        const cleft = Math.abs(Math.sin(theta)) < 0.22 && Math.cos(theta) > 0 ? 0.76 : 1.0;
        z *= cleft;
      }

      positions.push(x, y, z);
      bodyPos.push(x, bodyYOffset + y, bodyZOffset + z);
      uvs.push(u, t);
    }
  }

  const stride = radial + 1;
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, d, b, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aBodyPos', new THREE.Float32BufferAttribute(bodyPos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an authentic Axis axis 3-tine lyre antler pair (brow tine + curved main beam + terminal fork).
 */
function buildChitalAntlerGeometry(side: -1 | 1): THREE.BufferGeometry {
  const mergeGeos: THREE.BufferGeometry[] = [];

  const sampleTube = (curve: THREE.CatmullRomCurve3, rStart: number, rEnd: number, segs = 16, rad = 7) => {
    const frames = curve.computeFrenetFrames(segs, false);
    const pos: number[] = [];
    const bPos: number[] = [];
    const ind: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const pt = curve.getPointAt(t);
      const r = THREE.MathUtils.lerp(rStart, rEnd, Math.pow(t, 0.85));
      const N = frames.normals[i];
      const B = frames.binormals[i];
      for (let j = 0; j <= rad; j++) {
        const a = (j / rad) * Math.PI * 2;
        const vx = pt.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x);
        const vy = pt.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y);
        const vz = pt.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z);
        pos.push(vx, vy, vz);
        bPos.push(vx, 1.35 + vy, 0.62 + vz);
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
    g.setAttribute('aBodyPos', new THREE.Float32BufferAttribute(bPos, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  };

  // Main lyre beam: sweeps backward, outward, then upward & slightly inward at tip
  const mainBeam = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.032, 0.00, 0.00),
    new THREE.Vector3(side * 0.075, 0.11, -0.06),
    new THREE.Vector3(side * 0.145, 0.26, -0.14),
    new THREE.Vector3(side * 0.165, 0.44, -0.10),
    new THREE.Vector3(side * 0.130, 0.58, -0.02),
  ]);
  mergeGeos.push(sampleTube(mainBeam, 0.015, 0.0025, 18, 8));

  // Characteristic Axis axis brow tine: springs forward & upward right above burr/pedicle
  const browTine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.048, 0.03, -0.01),
    new THREE.Vector3(side * 0.065, 0.08, 0.07),
    new THREE.Vector3(side * 0.055, 0.16, 0.13),
  ]);
  mergeGeos.push(sampleTube(browTine, 0.011, 0.002, 10, 6));

  // Inner royal/terminal tine fork near upper third of main beam
  const innerTine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.155, 0.37, -0.12),
    new THREE.Vector3(side * 0.105, 0.46, -0.09),
    new THREE.Vector3(side * 0.075, 0.53, -0.06),
  ]);
  mergeGeos.push(sampleTube(innerTine, 0.0085, 0.002, 8, 6));

  return mergeBufferGeometriesSimple(mergeGeos);
}

/**
 * Builds cupped leaf-shaped pinna (ear) geometry.
 */
function buildCuppedEarGeometry(side: -1 | 1): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.045, 10, 8);
  const pos = geo.attributes.position;
  const bPos: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i) + 0.045; // Pivot at base
    let z = pos.getZ(i);
    const t = y / 0.09;
    const widthProfile = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * 0.55;
    x *= widthProfile * 1.1;
    y *= 1.55;
    // Cup concavity facing forward/outward
    z *= 0.32;
    if (z > 0) z *= 0.35;
    pos.setXYZ(i, x * side, y, z);
    bPos.push(x * side, 1.28 + y, 0.58 + z);
  }
  geo.setAttribute('aBodyPos', new THREE.Float32BufferAttribute(bPos, 3));
  geo.computeVertexNormals();
  return geo;
}

function mergeBufferGeometriesSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  const bPos: number[] = [];
  const ind: number[] = [];
  let offset = 0;

  for (const g of geos) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const bp = g.attributes.aBodyPos ?? p;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      norm.push(n.getX(i), n.getY(i), n.getZ(i));
      bPos.push(bp.getX(i), bp.getY(i), bp.getZ(i));
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
  out.setAttribute('aBodyPos', new THREE.Float32BufferAttribute(bPos, 3));
  out.setIndex(ind);
  return out;
}

/**
 * Creates the body-space Axis axis pelage material using onBeforeCompile so standard Three.js
 * PBR lighting, shadow maps, and tone mapping work natively.
 */
export function createChitalPelageMaterial(seed = 150): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.02,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCoatSeed = { value: (seed % 97) * 0.137 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aBodyPos;
        varying vec3 vBodyPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBodyPos = aBodyPos;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uCoatSeed;
        varying vec3 vBodyPos;

        float hash31(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195) + uCoatSeed);
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        // Cellular spot distance field in rest-pose body space
        vec2 chitalSpots(vec3 bp) {
          // Longitudinal alignment along flank flow lines
          vec3 q = vec3(bp.x * 16.0, (bp.y - 0.76) * 18.0 + bp.z * 1.8, bp.z * 14.5);
          vec3 i = floor(q);
          vec3 f = fract(q);
          float minDist = 8.0;
          for (int dz = -1; dz <= 1; dz++) {
            for (int dy = -1; dy <= 1; dy++) {
              for (int dx = -1; dx <= 1; dx++) {
                vec3 neighbor = vec3(float(dx), float(dy), float(dz));
                float h = hash31(i + neighbor);
                vec3 jitter = vec3(
                  fract(h * 13.7),
                  fract(h * 29.3),
                  fract(h * 47.1)
                ) * 0.72 + 0.14;
                vec3 diff = neighbor + jitter - f;
                // Slightly elongated horizontal rosette shape
                diff.z *= 0.82;
                float d = length(diff);
                if (h > 0.28) {
                  minDist = min(minDist, d);
                }
              }
            }
          }
          return vec2(minDist, hash31(q * 2.3));
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 bp = vBodyPos;
        float absX = abs(bp.x);

        // Base rufous-fawn pelage gradient (richer chestnut on saddle, warmer fawn on flanks)
        vec3 rufousSaddle = vec3(0.58, 0.28, 0.12);
        vec3 fawnFlank    = vec3(0.73, 0.43, 0.21);
        vec3 creamBelly   = vec3(0.92, 0.88, 0.80);
        vec3 darkSpine    = vec3(0.22, 0.10, 0.05);
        vec3 darkNose     = vec3(0.08, 0.07, 0.07);
        vec3 darkHoof     = vec3(0.12, 0.10, 0.09);

        float dorsalFactor = smoothstep(0.80, 0.96, bp.y) * (1.0 - smoothstep(0.20, 0.42, bp.z));
        vec3 coat = mix(fawnFlank, rufousSaddle, dorsalFactor);

        // Characteristic dark dorsal stripe from shoulders to tail base
        float spineStripe = (1.0 - smoothstep(0.004, 0.028, absX))
                          * smoothstep(0.82, 0.87, bp.y)
                          * smoothstep(-0.52, -0.35, bp.z)
                          * (1.0 - smoothstep(0.32, 0.44, bp.z));
        coat = mix(coat, darkSpine, spineStripe * 0.85);

        // White spots mask: restricted to flanks, haunches, and back (never on belly, legs, or head)
        float spotRegionZ = smoothstep(-0.48, -0.36, bp.z) * (1.0 - smoothstep(0.30, 0.42, bp.z));
        float spotRegionY = smoothstep(0.68, 0.74, bp.y) * (1.0 - smoothstep(0.98, 1.04, bp.y));
        float spotRegionX = smoothstep(0.018, 0.045, absX);
        float spotMask = spotRegionZ * spotRegionY * spotRegionX;

        vec2 sp = chitalSpots(bp);
        // Dorsal line of aligned spots near spine
        float dorsalRow = (1.0 - smoothstep(0.022, 0.045, abs(absX - 0.036)))
                        * (1.0 - smoothstep(0.18, 0.38, fract(bp.z * 22.0)));
        float rosette = max((1.0 - smoothstep(0.16, 0.34, sp.x)), dorsalRow * 0.75) * spotMask;
        coat = mix(coat, vec3(0.95, 0.92, 0.86), rosette * 0.92);

        // Cream ventrum (underbelly, inner legs, throat bib, chin, and undertail)
        float bellyMask = 1.0 - smoothstep(0.65, 0.74, bp.y);
        float throatBib = smoothstep(0.50, 0.62, bp.z)
                        * smoothstep(1.06, 1.20, bp.y)
                        * (1.0 - smoothstep(0.038, 0.062, absX))
                        * (1.0 - smoothstep(0.68, 0.75, bp.z));
        float chinPatch = smoothstep(0.70, 0.80, bp.z) * (1.0 - smoothstep(1.16, 1.21, bp.y));
        float lowerLegFade = 1.0 - smoothstep(0.28, 0.56, bp.y);
        coat = mix(coat, creamBelly, clamp(bellyMask * 0.88 + throatBib + chinPatch, 0.0, 1.0));
        coat = mix(coat, vec3(0.82, 0.74, 0.63), lowerLegFade * 0.65);

        // Dark wet rhinarium (nose tip) and cloven hooves
        float noseMask = smoothstep(0.77, 0.805, bp.z) * smoothstep(1.13, 1.18, bp.y);
        float hoofMask = 1.0 - smoothstep(0.00, 0.075, bp.y);
        coat = mix(coat, darkNose, noseMask);
        coat = mix(coat, darkHoof, hoofMask);

        diffuseColor.rgb = coat;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float noseWet = smoothstep(0.77, 0.805, vBodyPos.z) * smoothstep(1.13, 1.18, vBodyPos.y);
        float hoofPolished = 1.0 - smoothstep(0.00, 0.075, vBodyPos.y);
        roughnessFactor = mix(roughnessFactor, 0.16, noseWet);
        roughnessFactor = mix(roughnessFactor, 0.38, hoofPolished);`
      );
  };

  return mat;
}

export class ChitalPrototypeV4 {
  public readonly root = new THREE.Group();
  public readonly skinnedBody: THREE.SkinnedMesh;
  public readonly bones: THREE.Bone[] = [];

  private readonly skeleton: THREE.Skeleton;
  private readonly pelageMaterial: THREE.MeshStandardMaterial;
  private readonly antlerMaterial: THREE.MeshStandardMaterial;
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly clayMaterial: THREE.MeshStandardMaterial;

  // Articulated limb hierarchy: [FL, FR, HL, HR]
  private readonly limbRoots: THREE.Group[] = [];
  private readonly upperLimbs: THREE.Group[] = [];
  private readonly lowerLimbs: THREE.Group[] = [];
  private readonly hoofPivot: THREE.Group[] = [];
  private readonly antlersGroup = new THREE.Group();
  private readonly earLeft: THREE.Mesh;
  private readonly earRight: THREE.Mesh;
  private readonly tailGroup = new THREE.Group();

  // Continuous gait phase & world-space stance foot locking (prevents skating)
  private gaitPhase = 0;
  private lastGroundPosition: THREE.Vector2 | null = null;
  private readonly stanceLockedWorld: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  private readonly isFootInStance: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private lastDiagnostic: ChitalGroundingDiagnostic;

  // Anatomical segment lengths (meters)
  private readonly upperLen = [0.39, 0.39, 0.42, 0.42];
  private readonly lowerLen = [0.41, 0.41, 0.44, 0.44];
  private readonly hipOffsets = [
    new THREE.Vector3(-0.105, 0.76,  0.27), // FL (Scapula/Shoulder)
    new THREE.Vector3( 0.105, 0.76,  0.27), // FR
    new THREE.Vector3(-0.115, 0.80, -0.34), // HL (Pelvis/Acetabulum)
    new THREE.Vector3( 0.115, 0.80, -0.34), // HR
  ];

  constructor(seed = 150, sex: 'stag' | 'hind' | 'fawn' = 'stag') {
    this.pelageMaterial = createChitalPelageMaterial(seed);
    this.antlerMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4c3a3,
      roughness: 0.52,
      metalness: 0.05,
    });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0x110d0a,
      roughness: 0.12,
      metalness: 0.1,
    });
    this.clayMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8b4ae,
      roughness: 0.78,
      metalness: 0.0,
    });

    // 1. Build 8-bone spine/neck/head skeleton
    const boneSpecs: Array<[string, number, number, number, number]> = [
      ['Root',      -1, 0,  0.00,  0.00],
      ['Pelvis',     0, 0,  0.84, -0.36],
      ['SpineMid',   1, 0,  0.01,  0.34],
      ['Chest',      2, 0,  0.04,  0.30],
      ['NeckBase',   3, 0,  0.07,  0.12],
      ['NeckUpper',  4, 0,  0.16,  0.10],
      ['Head',       5, 0,  0.13,  0.11],
      ['Jaw',        6, 0, -0.04,  0.08],
    ];

    for (let i = 0; i < boneSpecs.length; i++) {
      const [name, parentIdx, x, y, z] = boneSpecs[i];
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      this.bones.push(b);
      if (parentIdx >= 0) {
        this.bones[parentIdx].add(b);
      }
    }
    // Skeleton root is a child of the skinned mesh, not a detached sibling.

    // 2. Build continuous welded body SkinnedMesh
    const bodyGeo = buildContinuousBodyGeometry(24);
    this.skinnedBody = new THREE.SkinnedMesh(bodyGeo, this.pelageMaterial);
    this.skinnedBody.castShadow = true;
    this.skinnedBody.receiveShadow = true;
    this.skinnedBody.add(this.bones[0]);
    this.root.add(this.skinnedBody);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.skeleton.calculateInverses();
    this.skinnedBody.bind(this.skeleton);

    // 3. Head details attached to Head bone (bone[6]): Eyes, Cupped Ears, and Stag Antlers
    const headBone = this.bones[6];
    const eyeGeo = new THREE.SphereGeometry(0.014, 10, 8);
    for (const side of [-1, 1] as const) {
      const eye = new THREE.Mesh(eyeGeo, this.eyeMaterial);
      eye.position.set(side * 0.058, 0.015, 0.035);
      headBone.add(eye);
    }

    this.earLeft = new THREE.Mesh(buildCuppedEarGeometry(-1), this.pelageMaterial);
    this.earLeft.position.set(-0.052, 0.042, -0.035);
    this.earLeft.rotation.set(-0.25, -0.35, 0.58);
    this.earLeft.castShadow = true;
    headBone.add(this.earLeft);

    this.earRight = new THREE.Mesh(buildCuppedEarGeometry(1), this.pelageMaterial);
    this.earRight.position.set(0.052, 0.042, -0.035);
    this.earRight.rotation.set(-0.25, 0.35, -0.58);
    this.earRight.castShadow = true;
    headBone.add(this.earRight);

    if (sex === 'stag') {
      const leftAntler = new THREE.Mesh(buildChitalAntlerGeometry(-1), this.antlerMaterial);
      const rightAntler = new THREE.Mesh(buildChitalAntlerGeometry(1), this.antlerMaterial);
      leftAntler.castShadow = true;
      rightAntler.castShadow = true;
      this.antlersGroup.position.set(0, 0.055, -0.01);
      this.antlersGroup.add(leftAntler, rightAntler);
      headBone.add(this.antlersGroup);
    }

    // 4. Tail attached to Pelvis bone (bone[1])
    const tailGeo = buildTaperedLimbSegment(0.22, 0.032, 0.024, 0.010, false, 0.76, -0.56);
    const tailMesh = new THREE.Mesh(tailGeo, this.pelageMaterial);
    tailMesh.castShadow = true;
    this.tailGroup.position.set(0, -0.04, -0.20);
    this.tailGroup.rotation.x = 0.38;
    this.tailGroup.add(tailMesh);
    this.bones[1].add(this.tailGroup);

    // 5. Four articulated limbs with true anatomical joint bending & calcaneal hock
    for (let i = 0; i < 4; i++) {
      const isHind = i >= 2;
      const hip = new THREE.Group();
      hip.position.copy(this.hipOffsets[i]);
      this.root.add(hip);
      this.limbRoots.push(hip);

      const upper = new THREE.Group();
      const uLen = this.upperLen[i];
      const uGeo = buildTaperedLimbSegment(
        uLen,
        isHind ? 0.088 : 0.072,
        isHind ? 0.056 : 0.046,
        0.036,
        false,
        this.hipOffsets[i].y,
        this.hipOffsets[i].z
      );
      const uMesh = new THREE.Mesh(uGeo, this.pelageMaterial);
      uMesh.castShadow = true;
      uMesh.receiveShadow = true;
      upper.add(uMesh);
      hip.add(upper);
      this.upperLimbs.push(upper);

      const lower = new THREE.Group();
      lower.position.set(0, -uLen, 0);
      const lLen = this.lowerLen[i];
      const lGeo = buildTaperedLimbSegment(
        lLen,
        0.035,
        0.022,
        0.026,
        true,
        this.hipOffsets[i].y - uLen,
        this.hipOffsets[i].z
      );
      const lMesh = new THREE.Mesh(lGeo, this.pelageMaterial);
      lMesh.castShadow = true;
      lMesh.receiveShadow = true;
      lower.add(lMesh);

      // Prominent calcaneal tuber (hock point) on hind limbs
      if (isHind) {
        const hockGeo = new THREE.SphereGeometry(0.026, 8, 6);
        hockGeo.scale(0.75, 1.35, 1.45);
        // Custom pelage shaders require aBodyPos on EVERY pelage-shaded geometry.
        const hp = hockGeo.getAttribute('position');
        const hockBodyPos = new Float32Array(hp.count * 3);
        for (let k = 0; k < hp.count; k++) {
          hockBodyPos[k * 3] = hp.getX(k);
          hockBodyPos[k * 3 + 1] = this.hipOffsets[i].y - uLen + 0.015 + hp.getY(k);
          hockBodyPos[k * 3 + 2] = this.hipOffsets[i].z - 0.022 + hp.getZ(k);
        }
        hockGeo.setAttribute('aBodyPos', new THREE.BufferAttribute(hockBodyPos, 3));
        const hockMesh = new THREE.Mesh(hockGeo, this.pelageMaterial);
        hockMesh.position.set(0, 0.015, -0.022);
        lower.add(hockMesh);
      }

      upper.add(lower);
      this.lowerLimbs.push(lower);

      const hoof = new THREE.Group();
      hoof.position.set(0, -lLen, 0);
      lower.add(hoof);
      this.hoofPivot.push(hoof);
    }

    if (sex === 'hind') {
      this.root.scale.setScalar(0.91);
    } else if (sex === 'fawn') {
      this.root.scale.setScalar(0.64);
    }

    this.lastDiagnostic = {
      animalId: 0,
      maxStanceFootErrorMeters: 0,
      stanceFeetWithin5mm: true,
      maxStanceFootHorizontalErrorMeters: 0,
      footHorizontalErrorsMeters: [0, 0, 0, 0],
      footHeightsWorld: [0, 0, 0, 0],
      terrainHeightsWorld: [0, 0, 0, 0],
    };
  }

  /**
   * Switches between neutral matte clay material (for silhouette/anatomy verification)
   * and final shaded pelage material.
   */
  public setClayMode(enabled: boolean): void {
    this.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (enabled) {
          mesh.material = this.clayMaterial;
        } else if (this.antlersGroup.children.includes(mesh)) {
          mesh.material = this.antlerMaterial;
        } else if (mesh.geometry.type === 'SphereGeometry' && mesh.parent === this.bones[6]) {
          mesh.material = this.eyeMaterial;
        } else {
          mesh.material = this.pelageMaterial;
        }
      }
    });
  }

  /**
   * Updates pose, continuous gait phase, terrain slope alignment, and world-space foot IK.
   */
  public update(sim: ChitalSimInput, dt: number, terrain: TerrainQuery, elapsedSec: number): ChitalGroundingDiagnostic {
    void dt; // The V4 gait phase follows actual world displacement, not wall-clock ticks.
    const scale = this.root.scale.y;
    const groundCenter = terrain.getHeightAt(sim.x, sim.z);

    // Measure fore-aft terrain slope under animal
    const forwardX = Math.sin(sim.heading);
    const forwardZ = Math.cos(sim.heading);
    const hFront = terrain.getHeightAt(sim.x + forwardX * 0.45, sim.z + forwardZ * 0.45);
    const hRear  = terrain.getHeightAt(sim.x - forwardX * 0.45, sim.z - forwardZ * 0.45);
    const terrainPitch = Math.atan2(hFront - hRear, 0.90);

    // Continuous gait phase integration (never jumps on speed transitions)
    const speedNorm = Math.max(0, sim.speed);
    // The experimental rig follows actual displacement, not an invented cadence.
    // Distance phase avoids leg cycling when the agent's commanded speed and
    // authoritative world displacement disagree. dt is still used for transitions.
    const currentPosition = new THREE.Vector2(sim.x, sim.z);
    const traveled = this.lastGroundPosition?.distanceTo(currentPosition) ?? 0;
    this.lastGroundPosition = currentPosition;
    const strideMeters = Math.max(0.35, 0.55 + speedNorm * 0.08);
    this.gaitPhase = (this.gaitPhase + (speedNorm > 0.08 ? traveled / strideMeters : 0)) % 1.0;

    // Subtle body suspension bob synchronized with diagonal footfalls
    const stepBob = speedNorm > 0.08
      ? Math.sin(this.gaitPhase * Math.PI * 4.0) * 0.016 * Math.min(1.5, speedNorm)
      : Math.sin(elapsedSec * 1.9 + sim.seed) * 0.004;

    this.root.position.set(sim.x, groundCenter + stepBob * scale, sim.z);
    this.root.rotation.set(0, sim.heading, 0);

    // Pitch spine mildly to match slope without burying hooves
    this.bones[1].rotation.x = -terrainPitch * 0.55;
    this.bones[2].rotation.x = terrainPitch * 0.25;

    // 6-State Head/Neck Articulation (idle, walk, trot/flee, graze, drink, alert)
    this.applyCervicalPose(sim.state, speedNorm, elapsedSec, sim.seed, terrainPitch);

    // Quadruped phase offsets: lateral sequence walk [0.0, 0.5, 0.25, 0.75]
    const phaseOffsets = [0.0, 0.50, 0.25, 0.75];
    const stanceDuty = speedNorm > 2.2 ? 0.52 : 0.68; // Shorter stance in trot/flee
    const strideLength = Math.min(0.42, speedNorm * 0.16);
    const swingLift = Math.min(0.14, 0.055 + speedNorm * 0.025);

    let maxStanceErr = 0;
    let maxHorizontalErr = 0;
    const footXZErr: [number, number, number, number] = [0, 0, 0, 0];
    const footY: [number, number, number, number] = [0, 0, 0, 0];
    const terrY: [number, number, number, number] = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const isHind = i >= 2;
      const hipLocal = this.hipOffsets[i];

      // World position of hip/shoulder joint
      const hipWorld = hipLocal.clone().multiplyScalar(scale);
      hipWorld.applyAxisAngle(new THREE.Vector3(0, 1, 0), sim.heading);
      hipWorld.add(this.root.position);

      // Rest foot anchor on ground directly under shoulder/hip (with slight graze splay)
      const grazeSplayZ = (sim.state === 'graze' || sim.state === 'drink') && !isHind ? 0.05 : 0.0;
      const nominalLocalZ = hipLocal.z + grazeSplayZ;
      const nominalLocalX = hipLocal.x * ((sim.state === 'drink' && !isHind) ? 1.18 : 1.0);

      const footPhase = (this.gaitPhase + phaseOffsets[i]) % 1.0;
      const inStance = speedNorm <= 0.08 || footPhase < stanceDuty;

      let targetWorldX: number;
      let targetWorldZ: number;
      let liftMeters = 0;

      if (inStance) {
        if (!this.isFootInStance[i]) {
          // Lock foot in world space at touchdown to guarantee zero skating
          const touchOffsetZ = speedNorm > 0.08 ? strideLength * 0.45 : 0.0;
          const localTouch = new THREE.Vector3(nominalLocalX, 0, nominalLocalZ + touchOffsetZ).multiplyScalar(scale);
          localTouch.applyAxisAngle(new THREE.Vector3(0, 1, 0), sim.heading);
          this.stanceLockedWorld[i].set(sim.x + localTouch.x, 0, sim.z + localTouch.z);
          this.isFootInStance[i] = true;
        }
        // Clamp lock distance if animal teleported or accelerated abruptly
        const nominalWorld = new THREE.Vector3(nominalLocalX, 0, nominalLocalZ)
          .multiplyScalar(scale)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), sim.heading)
          .add(this.root.position);
        if (this.stanceLockedWorld[i].distanceToSquared(nominalWorld) > 0.28) {
          this.stanceLockedWorld[i].copy(nominalWorld);
        }
        targetWorldX = this.stanceLockedWorld[i].x;
        targetWorldZ = this.stanceLockedWorld[i].z;
      } else {
        this.isFootInStance[i] = false;
        const swingU = (footPhase - stanceDuty) / (1.0 - stanceDuty); // 0..1
        const swingOffsetZ = THREE.MathUtils.lerp(-strideLength * 0.5, strideLength * 0.5, swingU);
        const localSwing = new THREE.Vector3(nominalLocalX, 0, nominalLocalZ + swingOffsetZ).multiplyScalar(scale);
        localSwing.applyAxisAngle(new THREE.Vector3(0, 1, 0), sim.heading);
        targetWorldX = sim.x + localSwing.x;
        targetWorldZ = sim.z + localSwing.z;
        liftMeters = Math.sin(swingU * Math.PI) * swingLift * scale;
      }

      const groundY = terrain.getHeightAt(targetWorldX, targetWorldZ);
      const targetWorldY = groundY + liftMeters;

      // Convert world target into limb-local (dy, dz) relative to hipWorld
      const dxWorld = targetWorldX - hipWorld.x;
      const dzWorld = targetWorldZ - hipWorld.z;
      const localDz = (dxWorld * forwardX + dzWorld * forwardZ) / scale;
      const localDy = (targetWorldY - hipWorld.y) / scale;

      this.solveTwoBoneLimbIK(i, localDy, localDz, isHind);

      // Compute exact post-IK world hoof height for 5 mm grounding diagnostic
      this.root.updateMatrixWorld(true);
      const hoofWorldPos = new THREE.Vector3();
      this.hoofPivot[i].getWorldPosition(hoofWorldPos);
      footY[i] = hoofWorldPos.y;
      terrY[i] = groundY;

      if (inStance) {
        const err = Math.abs(hoofWorldPos.y - groundY);
        if (err > maxStanceErr) maxStanceErr = err;
        const lock = this.stanceLockedWorld[i];
        const xzError = Math.hypot(hoofWorldPos.x - lock.x, hoofWorldPos.z - lock.z);
        footXZErr[i] = xzError;
        maxHorizontalErr = Math.max(maxHorizontalErr, xzError);
      }
    }

    this.lastDiagnostic = {
      animalId: sim.id,
      maxStanceFootErrorMeters: maxStanceErr,
      stanceFeetWithin5mm: maxStanceErr <= 0.005,
      maxStanceFootHorizontalErrorMeters: maxHorizontalErr,
      footHorizontalErrorsMeters: footXZErr,
      footHeightsWorld: footY,
      terrainHeightsWorld: terrY,
    };
    return this.lastDiagnostic;
  }

  /**
   * Analytical 2-bone limb IK enforcing opposite anatomical bending directions:
   * - Forelimb (isHind = false): Carpus/knee bends BACKWARD (caudally, lowerAngle >= 0)
   * - Hindlimb (isHind = true): Tarsus/hock bends FORWARD/UPWARD with calcaneus projecting caudally (lowerAngle <= 0)
   */
  private solveTwoBoneLimbIK(limbIndex: number, dy: number, dz: number, isHind: boolean): void {
    const L1 = this.upperLen[limbIndex];
    const L2 = this.lowerLen[limbIndex];
    const maxReach = (L1 + L2) * 0.998;
    const minReach = Math.abs(L1 - L2) + 0.02;

    const distRaw = Math.hypot(dy, dz);
    const dist = THREE.MathUtils.clamp(distRaw, minReach, maxReach);

    // Angle of target vector from downward vertical (-Y)
    const targetAngle = Math.atan2(dz, -dy);

    // Law of cosines for interior knee/hock deflection
    const cosUpper = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const cosKnee  = THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1);

    const alpha = Math.acos(cosUpper);
    const kneeFlex = Math.PI - Math.acos(cosKnee);

    if (!isHind) {
      // Forelimb: Humerus angles slightly backward, radius/cannon bends caudally at carpus
      this.upperLimbs[limbIndex].rotation.x = targetAngle + alpha;
      this.lowerLimbs[limbIndex].rotation.x = -kneeFlex;
    } else {
      // Hindlimb: Femur angles forward, tibia/metatarsus angles backward to hock then down to hoof
      this.upperLimbs[limbIndex].rotation.x = targetAngle - alpha;
      this.lowerLimbs[limbIndex].rotation.x = kneeFlex;
    }
  }

  private applyCervicalPose(
    state: ChitalGaitState,
    speed: number,
    elapsedSec: number,
    seed: number,
    terrainPitch: number
  ): void {
    const neckBase = this.bones[4];
    const neckUpper = this.bones[5];
    const head = this.bones[6];
    const breathe = Math.sin(elapsedSec * 2.1 + seed) * 0.025;

    if (state === 'graze') {
      const chew = Math.sin(elapsedSec * 6.5 + seed) * 0.035;
      neckBase.rotation.set(1.08 - terrainPitch * 0.5, Math.sin(elapsedSec * 0.6 + seed) * 0.08, 0);
      neckUpper.rotation.set(0.62, 0, 0);
      head.rotation.set(-0.38 + chew, 0, 0);
    } else if (state === 'drink') {
      const lap = Math.sin(elapsedSec * 4.2 + seed) * 0.018;
      neckBase.rotation.set(1.18 - terrainPitch * 0.5, 0, 0);
      neckUpper.rotation.set(0.70, 0, 0);
      head.rotation.set(-0.52 + lap, 0, 0);
    } else if (state === 'alert') {
      neckBase.rotation.set(-0.22, 0, 0);
      neckUpper.rotation.set(-0.14, Math.sin(elapsedSec * 0.8 + seed) * 0.22, 0);
      head.rotation.set(0.18, 0, 0);
      this.earLeft.rotation.z = 0.35;
      this.earRight.rotation.z = -0.35;
      this.tailGroup.rotation.x = 1.15; // Alarm tail-raise (white underside flash)
      return;
    } else if (speed > 0.15) {
      const nod = Math.sin(this.gaitPhase * Math.PI * 2.0) * 0.06 * Math.min(1.5, speed);
      neckBase.rotation.set(0.18 + nod, 0, 0);
      neckUpper.rotation.set(0.06 - nod * 0.5, 0, 0);
      head.rotation.set(-0.12, 0, 0);
    } else {
      neckBase.rotation.set(0.05 + breathe, Math.sin(elapsedSec * 0.45 + seed) * 0.09, 0);
      neckUpper.rotation.set(0.02, 0, 0);
      head.rotation.set(-0.04 - breathe * 0.5, 0, 0);
    }

    // Default ear & tail micro-motion
    const earFlick = Math.pow(Math.max(0, Math.sin(elapsedSec * 3.7 + seed * 2.1)), 12) * 0.25;
    this.earLeft.rotation.z = 0.58 - earFlick;
    this.earRight.rotation.z = -0.58 + earFlick * 0.6;
    this.tailGroup.rotation.x = 0.38;
    this.tailGroup.rotation.z = Math.sin(elapsedSec * 2.8 + seed) * 0.08;
  }

  public getLastDiagnostic(): ChitalGroundingDiagnostic {
    return this.lastDiagnostic;
  }

  public dispose(): void {
    this.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).geometry.dispose();
      }
    });
    this.skeleton.dispose();
    this.pelageMaterial.dispose();
    this.antlerMaterial.dispose();
    this.eyeMaterial.dispose();
    this.clayMaterial.dispose();
  }
}