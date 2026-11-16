import * as THREE from 'three';

export interface ReadonlyAnimalAnimState {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly state: 'idle' | 'graze' | 'walk' | 'trot' | 'flee' | 'drink' | 'rest';
  readonly alertLevel: number;
  readonly hasAntlers: boolean;
  readonly phaseOffset: number;
}

export interface LimbRig {
  readonly name: 'FL' | 'FR' | 'BL' | 'BR';
  readonly isHind: boolean;
  readonly socketLocal: THREE.Vector3;
  readonly stanceOffsetX: number;
  readonly stanceOffsetZ: number;
  readonly upper: THREE.Group;
  readonly lower: THREE.Group;
  readonly hoof: THREE.Group;
  readonly hoofBottom: THREE.Object3D;
}

export interface ArticulatedChitalRig {
  readonly root: THREE.Group;
  readonly bodyGroup: THREE.Group;
  readonly neckPivot: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly earLeftPivot: THREE.Group;
  readonly earRightPivot: THREE.Group;
  readonly tailPivot: THREE.Group;
  readonly legFL: LimbRig;
  readonly legFR: LimbRig;
  readonly legBL: LimbRig;
  readonly legBR: LimbRig;
  readonly limbs: readonly [LimbRig, LimbRig, LimbRig, LimbRig];
  lastGroundingDiagnostics: {
    pitchRad: number;
    rollRad: number;
    maxStanceHoofErrorMeters: number;
    perHoofClearanceMeters: Record<'FL' | 'FR' | 'BL' | 'BR', number>;
  };
}

export class ExperimentalResourceTracker {
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();

  trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.add(geo);
    return geo;
  }

  trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.add(mat);
    return mat;
  }

  trackTex<T extends THREE.Texture>(tex: T): T {
    this.textures.add(tex);
    return tex;
  }

  disposeAll(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}

const UPPER_LIMB_LEN = 0.39;
const LOWER_LIMB_LEN = 0.36;
const HOOF_HEIGHT = 0.05;
const TOTAL_LIMB_REACH = UPPER_LIMB_LEN + LOWER_LIMB_LEN; // 0.75m (socket to ankle)

function tagGeometryRegion(geo: THREE.BufferGeometry, regionId: number): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const regions = new Float32Array(count);
  regions.fill(regionId);
  geo.setAttribute('aBodyRegion', new THREE.BufferAttribute(regions, 1));
  return geo;
}

/**
 * Chital (Axis axis) pelage shader with strictly ascending smoothstep(edge0, edge1, x)
 * bounds (edge0 < edge1 guaranteed across all calls).
 */
export const CHITAL_PELAGE_FRAGMENT_PARS = /* glsl */ `
varying vec3 vLocalCoatPos;
varying vec3 vLocalCoatNormal;
varying float vBodyRegion;

float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float chitalSpotPattern(vec3 p) {
  vec3 grid = p * vec3(13.5, 11.0, 12.5);
  vec3 cell = floor(grid);
  vec3 fracPos = fract(grid) - 0.5;
  float rnd = hash31(cell);
  vec3 jitter = (vec3(rnd, fract(rnd * 17.3), fract(rnd * 31.7)) - 0.5) * 0.48;
  float d = length(fracPos - jitter);
  float radius = mix(0.14, 0.25, fract(rnd * 9.1));
  float activeCell = step(0.32, rnd);
  // radius >= 0.14 => (radius - 0.05) < (radius + 0.05) strictly holds
  return activeCell * (1.0 - smoothstep(radius - 0.05, radius + 0.05, d));
}
`;

export const CHITAL_PELAGE_COLOR_CHUNK = /* glsl */ `
vec3 baseRufous = vec3(0.68, 0.37, 0.16);
vec3 warmTan = vec3(0.76, 0.54, 0.34);
vec3 creamWhite = vec3(0.95, 0.93, 0.88);
vec3 darkSpine = vec3(0.24, 0.12, 0.05);
vec3 antlerBone = vec3(0.82, 0.76, 0.64);
vec3 darkHoof = vec3(0.14, 0.12, 0.10);

if (vBodyRegion < 0.5) {
  // Region 0: Torso / Flank — all smoothstep calls strictly satisfy edge0 < edge1
  float bellyPosMask = 1.0 - smoothstep(-0.18, -0.04, vLocalCoatPos.y);
  float bellyNormMask = 1.0 - smoothstep(-0.45, 0.22, vLocalCoatNormal.y);
  float bellyMask = bellyPosMask * bellyNormMask;

  float spineHeightMask = smoothstep(0.12, 0.21, vLocalCoatPos.y);
  float spineWidthMask = 1.0 - smoothstep(0.0, 0.065, abs(vLocalCoatPos.z));
  float spineMask = spineHeightMask * spineWidthMask;

  float flankZone = (1.0 - bellyMask) * (1.0 - spineMask * 0.7) * smoothstep(-0.12, 0.02, vLocalCoatPos.y);
  float spots = chitalSpotPattern(vLocalCoatPos) * flankZone;

  float lineBand = 1.0 - smoothstep(0.0, 0.04, abs(vLocalCoatPos.y + 0.05));
  float lineSpot = lineBand * step(0.35, fract(vLocalCoatPos.x * 16.0));
  spots = clamp(spots + lineSpot * 0.65 * (1.0 - bellyMask), 0.0, 1.0);

  vec3 coat = mix(baseRufous, darkSpine, spineMask * 0.85);
  coat = mix(coat, creamWhite, bellyMask);
  coat = mix(coat, creamWhite, spots * 0.92);
  diffuseColor.rgb = coat;
} else if (vBodyRegion < 1.5) {
  // Region 1: Neck & Head (white throat bib, dark muzzle, no flank spots)
  float throatXMask = smoothstep(0.02, 0.12, vLocalCoatPos.x);
  float throatNormMask = 1.0 - smoothstep(-0.06, 0.05, vLocalCoatNormal.y);
  float throatBib = throatXMask * throatNormMask;

  float muzzleXMask = smoothstep(0.16, 0.25, vLocalCoatPos.x);
  float muzzleYMask = 1.0 - smoothstep(-0.06, 0.04, vLocalCoatPos.y);
  float muzzleDark = muzzleXMask * muzzleYMask;

  vec3 headCoat = mix(baseRufous, creamWhite, throatBib * 0.88);
  headCoat = mix(headCoat, darkHoof, muzzleDark * 0.85);
  diffuseColor.rgb = headCoat;
} else if (vBodyRegion < 2.5) {
  // Region 2: Lower Limbs (unspotted warm tan)
  diffuseColor.rgb = warmTan;
} else if (vBodyRegion < 3.5) {
  // Region 3: Antlers / Hooves
  diffuseColor.rgb = vLocalCoatPos.y > 0.0 ? antlerBone : darkHoof;
} else {
  // Region 4: Tail
  diffuseColor.rgb = vLocalCoatNormal.y < 0.0 ? creamWhite : baseRufous;
}
`;

export function createChitalPelageMaterial(tracker: ExperimentalResourceTracker): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb86b35,
    roughness: 0.72,
    metalness: 0.02,
  });

  mat.customProgramCacheKey = () => 'chital_pelage_natural_v3';

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aBodyRegion;
        varying vec3 vLocalCoatPos;
        varying vec3 vLocalCoatNormal;
        varying float vBodyRegion;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLocalCoatPos = position;
        vLocalCoatNormal = normal;
        vBodyRegion = aBodyRegion;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CHITAL_PELAGE_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CHITAL_PELAGE_COLOR_CHUNK}`);
  };

  return tracker.trackMat(mat);
}

export function createArticulatedChitalRig(
  tracker: ExperimentalResourceTracker,
  material: THREE.Material,
  hasAntlers = true
): ArticulatedChitalRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  bodyGroup.rotation.order = 'ZXY';
  bodyGroup.position.set(0, 0.72, 0);
  root.add(bodyGroup);

  // 1. Torso
  const torsoGeo = tracker.trackGeo(new THREE.CylinderGeometry(0.175, 0.205, 0.72, 16, 4));
  torsoGeo.rotateZ(Math.PI * 0.5);
  torsoGeo.scale(1.0, 1.08, 0.88);
  tagGeometryRegion(torsoGeo, 0.0);
  const torsoMesh = new THREE.Mesh(torsoGeo, material);
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  bodyGroup.add(torsoMesh);

  const chestGeo = tracker.trackGeo(new THREE.SphereGeometry(0.205, 16, 12));
  chestGeo.scale(0.95, 1.06, 0.86);
  chestGeo.translate(0.32, -0.01, 0);
  tagGeometryRegion(chestGeo, 0.0);
  const chestMesh = new THREE.Mesh(chestGeo, material);
  chestMesh.castShadow = true;
  chestMesh.receiveShadow = true;
  bodyGroup.add(chestMesh);

  const rumpGeo = tracker.trackGeo(new THREE.SphereGeometry(0.185, 16, 12));
  rumpGeo.scale(1.05, 1.04, 0.88);
  rumpGeo.translate(-0.33, 0.02, 0);
  tagGeometryRegion(rumpGeo, 0.0);
  const rumpMesh = new THREE.Mesh(rumpGeo, material);
  rumpMesh.castShadow = true;
  rumpMesh.receiveShadow = true;
  bodyGroup.add(rumpMesh);

  // 2. Neck Pivot
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0.36, 0.08, 0);
  bodyGroup.add(neckPivot);

  const neckLen = 0.38;
  const neckGeo = tracker.trackGeo(new THREE.CylinderGeometry(0.072, 0.118, neckLen, 14, 3));
  neckGeo.translate(0, neckLen * 0.5, 0);
  neckGeo.rotateZ(-0.42);
  tagGeometryRegion(neckGeo, 1.0);
  const neckMesh = new THREE.Mesh(neckGeo, material);
  neckMesh.castShadow = true;
  neckPivot.add(neckMesh);

  // 3. Head Pivot
  const headPivot = new THREE.Group();
  headPivot.position.set(Math.sin(0.42) * neckLen, Math.cos(0.42) * neckLen, 0);
  neckPivot.add(headPivot);

  const craniumGeo = tracker.trackGeo(new THREE.SphereGeometry(0.088, 14, 10));
  craniumGeo.scale(1.35, 0.92, 0.85);
  craniumGeo.translate(0.05, 0.02, 0);
  tagGeometryRegion(craniumGeo, 1.0);
  const craniumMesh = new THREE.Mesh(craniumGeo, material);
  craniumMesh.castShadow = true;
  headPivot.add(craniumMesh);

  const snoutGeo = tracker.trackGeo(new THREE.CylinderGeometry(0.036, 0.068, 0.19, 12));
  snoutGeo.rotateZ(-Math.PI * 0.5 - 0.15);
  snoutGeo.translate(0.16, -0.01, 0);
  tagGeometryRegion(snoutGeo, 1.0);
  const snoutMesh = new THREE.Mesh(snoutGeo, material);
  snoutMesh.castShadow = true;
  headPivot.add(snoutMesh);

  const buildEar = (side: 1 | -1): THREE.Group => {
    const earPivot = new THREE.Group();
    earPivot.position.set(-0.01, 0.07, side * 0.065);
    earPivot.rotation.set(side * 0.45, -side * 0.25, 0.35);
    const earGeo = tracker.trackGeo(new THREE.ConeGeometry(0.032, 0.13, 8));
    earGeo.scale(0.55, 1.0, 1.0);
    earGeo.translate(0, 0.065, 0);
    tagGeometryRegion(earGeo, 1.0);
    const earMesh = new THREE.Mesh(earGeo, material);
    earMesh.castShadow = true;
    earPivot.add(earMesh);
    headPivot.add(earPivot);
    return earPivot;
  };
  const earLeftPivot = buildEar(1);
  const earRightPivot = buildEar(-1);

  if (hasAntlers) {
    const buildAntlerBeam = (side: 1 | -1) => {
      const antlerGroup = new THREE.Group();
      antlerGroup.position.set(0.0, 0.08, side * 0.042);

      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-0.08, 0.16, side * 0.09),
        new THREE.Vector3(-0.18, 0.34, side * 0.15),
        new THREE.Vector3(-0.12, 0.48, side * 0.11),
      ]);
      const beamGeo = tracker.trackGeo(new THREE.TubeGeometry(curve, 12, 0.012, 6, false));
      tagGeometryRegion(beamGeo, 3.0);
      const beamMesh = new THREE.Mesh(beamGeo, material);
      beamMesh.castShadow = true;
      antlerGroup.add(beamMesh);

      const browCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.02, 0.04, side * 0.02),
        new THREE.Vector3(0.09, 0.11, side * 0.04),
      ]);
      const browGeo = tracker.trackGeo(new THREE.TubeGeometry(browCurve, 6, 0.009, 5, false));
      tagGeometryRegion(browGeo, 3.0);
      antlerGroup.add(new THREE.Mesh(browGeo, material));

      const innerCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.15, 0.28, side * 0.13),
        new THREE.Vector3(-0.09, 0.39, side * 0.07),
      ]);
      const innerGeo = tracker.trackGeo(new THREE.TubeGeometry(innerCurve, 6, 0.008, 5, false));
      tagGeometryRegion(innerGeo, 3.0);
      antlerGroup.add(new THREE.Mesh(innerGeo, material));

      headPivot.add(antlerGroup);
    };
    buildAntlerBeam(1);
    buildAntlerBeam(-1);
  }

  // 4. Tail Pivot
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-0.49, 0.05, 0);
  bodyGroup.add(tailPivot);
  const tailGeo = tracker.trackGeo(new THREE.ConeGeometry(0.034, 0.22, 8));
  tailGeo.translate(0, -0.11, 0);
  tailGeo.rotateZ(-0.35);
  tagGeometryRegion(tailGeo, 4.0);
  const tailMesh = new THREE.Mesh(tailGeo, material);
  tailMesh.castShadow = true;
  tailPivot.add(tailMesh);

  // 5. Four Articulated Limbs with Top-Socket Origins & Plantar Hoof Markers
  const buildLeg = (
    name: 'FL' | 'FR' | 'BL' | 'BR',
    hipX: number,
    hipY: number,
    hipZ: number,
    isHind: boolean
  ): LimbRig => {
    const upper = new THREE.Group();
    upper.rotation.order = 'XZY';
    upper.position.set(hipX, hipY, hipZ);
    bodyGroup.add(upper);

    const topRadius = isHind ? 0.088 : 0.072;
    const kneeRadius = 0.042;
    const upperGeo = tracker.trackGeo(new THREE.CylinderGeometry(topRadius, kneeRadius, UPPER_LIMB_LEN, 10));
    upperGeo.translate(0, -UPPER_LIMB_LEN * 0.5, 0);
    tagGeometryRegion(upperGeo, isHind ? 0.0 : 2.0);
    const upperMesh = new THREE.Mesh(upperGeo, material);
    upperMesh.castShadow = true;
    upper.add(upperMesh);

    const jointCapGeo = tracker.trackGeo(new THREE.SphereGeometry(kneeRadius * 1.04, 8, 8));
    jointCapGeo.translate(0, -UPPER_LIMB_LEN, 0);
    tagGeometryRegion(jointCapGeo, 2.0);
    upper.add(new THREE.Mesh(jointCapGeo, material));

    const lower = new THREE.Group();
    lower.position.set(0, -UPPER_LIMB_LEN, 0);
    upper.add(lower);

    const lowerGeo = tracker.trackGeo(new THREE.CylinderGeometry(kneeRadius * 0.92, 0.026, LOWER_LIMB_LEN, 10));
    lowerGeo.translate(0, -LOWER_LIMB_LEN * 0.5, 0);
    tagGeometryRegion(lowerGeo, 2.0);
    const lowerMesh = new THREE.Mesh(lowerGeo, material);
    lowerMesh.castShadow = true;
    lower.add(lowerMesh);

    const hoof = new THREE.Group();
    hoof.rotation.order = 'XZY';
    hoof.position.set(0, -LOWER_LIMB_LEN, 0);
    lower.add(hoof);

    const hoofGeo = tracker.trackGeo(new THREE.CylinderGeometry(0.026, 0.035, HOOF_HEIGHT, 8));
    hoofGeo.translate(0.01, -HOOF_HEIGHT * 0.5, 0);
    tagGeometryRegion(hoofGeo, 3.0);
    const hoofMesh = new THREE.Mesh(hoofGeo, material);
    hoofMesh.castShadow = true;
    hoof.add(hoofMesh);

    // Exact plantar contact point at the bottom of the hoof cylinder (-HOOF_HEIGHT)
    const hoofBottom = new THREE.Object3D();
    hoofBottom.position.set(0.01, -HOOF_HEIGHT, 0);
    hoof.add(hoofBottom);

    return {
      name,
      isHind,
      socketLocal: new THREE.Vector3(hipX, hipY, hipZ),
      stanceOffsetX: isHind ? hipX - 0.03 : hipX + 0.02,
      stanceOffsetZ: hipZ,
      upper,
      lower,
      hoof,
      hoofBottom,
    };
  };

  const legFL = buildLeg('FL', 0.28, -0.02, 0.11, false);
  const legFR = buildLeg('FR', 0.28, -0.02, -0.11, false);
  const legBL = buildLeg('BL', -0.30, 0.0, 0.12, true);
  const legBR = buildLeg('BR', -0.30, 0.0, -0.12, true);

  return {
    root,
    bodyGroup,
    neckPivot,
    headPivot,
    earLeftPivot,
    earRightPivot,
    tailPivot,
    legFL,
    legFR,
    legBL,
    legBR,
    limbs: [legFL, legFR, legBL, legBR],
    lastGroundingDiagnostics: {
      pitchRad: 0,
      rollRad: 0,
      maxStanceHoofErrorMeters: 0,
      perHoofClearanceMeters: { FL: 0, FR: 0, BL: 0, BR: 0 },
    },
  };
}

/**
 * Solves 3D two-bone analytical IK for a single quadruped limb so that `limb.hoof`
 * reaches `ankleTargetBodyLocal` (in `bodyGroup` space) and `limb.hoofBottom`
 * aligns with the terrain slope under that specific hoof.
 */
function solveLimbIK3D(
  limb: LimbRig,
  ankleTargetBodyLocal: THREE.Vector3,
  localGroundSlopePitch: number
): void {
  const dx = ankleTargetBodyLocal.x - limb.socketLocal.x;
  const dy = ankleTargetBodyLocal.y - limb.socketLocal.y;
  const dz = ankleTargetBodyLocal.z - limb.socketLocal.z;

  // 1. Hip abduction around local X axis to align the leg plane with (dy, dz)
  const rYZ = Math.max(1e-4, Math.hypot(dy, dz));
  const thetaAbduct = THREE.MathUtils.clamp(Math.atan2(-dz, -dy), -0.35, 0.35);

  // 2. Sagittal 2-bone Law of Cosines in (dx, rYZ)
  const rawDist = Math.hypot(dx, rYZ);
  const minReach = Math.abs(UPPER_LIMB_LEN - LOWER_LIMB_LEN) + 0.015;
  const maxReach = TOTAL_LIMB_REACH * 0.998;
  const d = THREE.MathUtils.clamp(rawDist, minReach, maxReach);

  const cosAlpha = THREE.MathUtils.clamp(
    (UPPER_LIMB_LEN * UPPER_LIMB_LEN + d * d - LOWER_LIMB_LEN * LOWER_LIMB_LEN) /
      (2 * UPPER_LIMB_LEN * d),
    -1.0,
    1.0
  );
  const cosBeta = THREE.MathUtils.clamp(
    (UPPER_LIMB_LEN * UPPER_LIMB_LEN + LOWER_LIMB_LEN * LOWER_LIMB_LEN - d * d) /
      (2 * UPPER_LIMB_LEN * LOWER_LIMB_LEN),
    -1.0,
    1.0
  );

  const alpha = Math.acos(cosAlpha);
  const beta = Math.acos(cosBeta);
  const gamma = Math.atan2(dx, rYZ);

  // Forelimbs flex backward at knee (-Z); hindlimbs flex forward at hock (+Z)
  let theta1: number;
  let theta2: number;
  if (limb.isHind) {
    theta1 = gamma - alpha;
    theta2 = Math.PI - beta;
  } else {
    theta1 = gamma + alpha;
    theta2 = -(Math.PI - beta);
  }

  limb.upper.rotation.set(thetaAbduct, 0, theta1);
  limb.lower.rotation.set(0, 0, theta2);
  limb.hoof.rotation.set(-thetaAbduct, 0, localGroundSlopePitch - (theta1 + theta2));
}

const _tmpWorldSocket = new THREE.Vector3();
const _tmpWorldAnkle = new THREE.Vector3();
const _tmpLocalAnkle = new THREE.Vector3();
const _tmpHoofBottomWorld = new THREE.Vector3();

/**
 * Updates the articulated chital rig with:
 * - True two-axis terrain alignment (longitudinal pitch + lateral cross-slope roll)
 * - Per-hoof terrain elevation sampling & 3D two-bone analytical IK grounding
 * - Counter-rotated neck/head grazing & alert postures
 */
export function updateArticulatedChitalRig(
  rig: ArticulatedChitalRig,
  state: ReadonlyAnimalAnimState,
  timeSec: number,
  sampleTerrainHeight: (x: number, z: number) => number
): void {
  const isMoving =
    state.speed > 0.06 ||
    state.state === 'walk' ||
    state.state === 'trot' ||
    state.state === 'flee';

  const cycleRate = state.state === 'flee' ? 9.2 : state.state === 'trot' ? 6.4 : 3.5;
  const strideExcursion =
    state.state === 'flee' ? 0.24 : state.state === 'trot' ? 0.17 : isMoving ? 0.11 : 0.0;
  const stepLiftHeight =
    state.state === 'flee' ? 0.14 : state.state === 'trot' ? 0.09 : isMoving ? 0.055 : 0.0;

  const basePhase = timeSec * cycleRate + state.phaseOffset;
  const limbPhaseOffsets: Record<'FL' | 'FR' | 'BL' | 'BR', number> = {
    FL: 0.0,
    BR: Math.PI * 0.5,
    FR: Math.PI,
    BL: Math.PI * 1.5,
  };

  const cosH = Math.cos(state.heading);
  const sinH = Math.sin(state.heading);

  // 1. Compute per-hoof world horizontal positions, terrain heights, slopes, and swing lifts
  const hoofTargets: Record<
    'FL' | 'FR' | 'BL' | 'BR',
    {
      worldX: number;
      worldZ: number;
      groundY: number;
      liftY: number;
      ankleWorldY: number;
      groundSlopePitch: number;
      isStance: boolean;
    }
  > = {} as any;

  for (const limb of rig.limbs) {
    const phase = (((basePhase + limbPhaseOffsets[limb.name]) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // Stance during [0, PI] (sin(phase) >= 0); swing during (PI, 2*PI) (sin(phase) < 0)
    const sinP = Math.sin(phase);
    const isStance = !isMoving || sinP >= 0;
    const dxStride = isMoving ? Math.cos(phase) * strideExcursion : 0;
    const liftY = isStance ? 0 : Math.pow(-sinP, 1.5) * stepLiftHeight;

    const localFootX = limb.stanceOffsetX + dxStride;
    const localFootZ = limb.stanceOffsetZ;

    const worldX = state.x + localFootX * cosH + localFootZ * sinH;
    const worldZ = state.z - localFootX * sinH + localFootZ * cosH;
    const groundY = sampleTerrainHeight(worldX, worldZ);

    const eps = 0.08;
    const groundAheadY = sampleTerrainHeight(worldX + eps * cosH, worldZ - eps * sinH);
    const groundSlopePitch = Math.atan2(groundAheadY - groundY, eps);

    hoofTargets[limb.name] = {
      worldX,
      worldZ,
      groundY,
      liftY,
      ankleWorldY: groundY + HOOF_HEIGHT + liftY,
      groundSlopePitch,
      isStance,
    };
  }

  // 2. Two-Axis Terrain Alignment (Pitch + Roll) from the 4 sampled hoof ground elevations
  const yFore = 0.5 * (hoofTargets.FL.groundY + hoofTargets.FR.groundY);
  const yHind = 0.5 * (hoofTargets.BL.groundY + hoofTargets.BR.groundY);
  const yLeft = 0.5 * (hoofTargets.FL.groundY + hoofTargets.BL.groundY);
  const yRight = 0.5 * (hoofTargets.FR.groundY + hoofTargets.BR.groundY);
  const meanGroundY = 0.25 * (yFore * 2 + yHind * 2);

  const wheelbaseX = 0.58; // +0.28 - (-0.30)
  const trackWidthZ = 0.23; // +0.115 - (-0.115)

  const thetaPitch = THREE.MathUtils.clamp(Math.atan2(yFore - yHind, wheelbaseX), -0.40, 0.40);
  const thetaRoll = THREE.MathUtils.clamp(Math.atan2(yRight - yLeft, trackWidthZ), -0.35, 0.35);

  rig.root.position.set(state.x, meanGroundY, state.z);
  rig.root.rotation.set(0, state.heading, 0);

  // Subtle gait suspension bounce during trot/flee
  const gaitBob = isMoving ? Math.sin(basePhase * 2.0) * (state.state === 'flee' ? 0.022 : 0.012) : 0;
  const nominalBodyY = 0.70 + gaitBob;

  rig.bodyGroup.position.set(0, nominalBodyY, 0);
  rig.bodyGroup.rotation.set(thetaRoll * 0.85, 0, thetaPitch);
  rig.root.updateMatrixWorld(true);

  // 3. Adaptive Pelvis Height Check: ensure no stance limb exceeds 98.5% of max 2-bone reach on steep banks
  let requiredBodyDrop = 0;
  const maxSafeSocketToAnkle = TOTAL_LIMB_REACH * 0.985;
  for (const limb of rig.limbs) {
    const target = hoofTargets[limb.name];
    _tmpWorldSocket.copy(limb.socketLocal).applyMatrix4(rig.bodyGroup.matrixWorld);
    const horizDistSq =
      (_tmpWorldSocket.x - target.worldX) ** 2 + (_tmpWorldSocket.z - target.worldZ) ** 2;
    const maxVertSpan = Math.sqrt(Math.max(0.01, maxSafeSocketToAnkle ** 2 - horizDistSq));
    const currentVertSpan = _tmpWorldSocket.y - target.ankleWorldY;
    if (currentVertSpan > maxVertSpan) {
      requiredBodyDrop = Math.max(requiredBodyDrop, currentVertSpan - maxVertSpan);
    }
  }

  if (requiredBodyDrop > 0) {
    rig.bodyGroup.position.y = Math.max(0.48, nominalBodyY - requiredBodyDrop);
    rig.root.updateMatrixWorld(true);
  }

  // 4. Solve Per-Limb 3D Two-Bone Analytical IK & Measure Ground Clearance Error
  let maxStanceError = 0;
  const perHoofClearance: Record<'FL' | 'FR' | 'BL' | 'BR', number> = {
    FL: 0,
    FR: 0,
    BL: 0,
    BR: 0,
  };

  for (const limb of rig.limbs) {
    const target = hoofTargets[limb.name];
    _tmpWorldAnkle.set(target.worldX, target.ankleWorldY, target.worldZ);
    _tmpLocalAnkle.copy(_tmpWorldAnkle);
    rig.bodyGroup.worldToLocal(_tmpLocalAnkle);

    const localSlopePitch = target.groundSlopePitch - thetaPitch;
    solveLimbIK3D(limb, _tmpLocalAnkle, localSlopePitch);

    // The initial ankle solve is exact at the ankle, but hoof pitch/abduction
    // changes the sole's vertical offset. Compensate using the ACTUAL world
    // plantar marker, then solve again. This corrects contact at the foot rather
    // than loosening the strict 5mm acceptance threshold.
    for (let pass = 0; pass < 3; pass++) {
      limb.upper.updateMatrixWorld(true);
      limb.hoofBottom.getWorldPosition(_tmpHoofBottomWorld);
      const soleError = _tmpHoofBottomWorld.y - target.groundY;
      if (Math.abs(soleError) <= 0.0001) break;
      _tmpWorldAnkle.y -= soleError;
      _tmpLocalAnkle.copy(_tmpWorldAnkle);
      rig.bodyGroup.worldToLocal(_tmpLocalAnkle);
      solveLimbIK3D(limb, _tmpLocalAnkle, localSlopePitch);
    }

    limb.upper.updateMatrixWorld(true);
    limb.hoofBottom.getWorldPosition(_tmpHoofBottomWorld);
    const clearance = _tmpHoofBottomWorld.y - target.groundY;
    perHoofClearance[limb.name] = clearance;
    if (target.isStance) {
      maxStanceError = Math.max(maxStanceError, Math.abs(clearance));
    }
  }

  rig.lastGroundingDiagnostics = {
    pitchRad: thetaPitch,
    rollRad: thetaRoll,
    maxStanceHoofErrorMeters: maxStanceError,
    perHoofClearanceMeters: perHoofClearance,
  };

  // 5. Neck, Head, Ears & Tail Articulation
  if (state.state === 'graze' || state.state === 'drink') {
    const nibble = Math.sin(timeSec * 5.2 + state.phaseOffset) * 0.045;
    rig.neckPivot.rotation.z = -1.02 + nibble * 0.4;
    rig.headPivot.rotation.z = 0.64 + nibble;
    rig.headPivot.rotation.y = Math.sin(timeSec * 1.3 + state.phaseOffset) * 0.12;
  } else if (state.alertLevel > 0.5) {
    rig.neckPivot.rotation.z = 0.16;
    rig.headPivot.rotation.z = -0.12;
    rig.headPivot.rotation.y = Math.sin(timeSec * 2.1 + state.phaseOffset) * 0.35;
  } else {
    const breath = Math.sin(timeSec * 2.0 + state.phaseOffset) * 0.03;
    rig.neckPivot.rotation.z = -0.06 + breath;
    rig.headPivot.rotation.z = 0.04 - breath * 0.5;
    rig.headPivot.rotation.y = Math.sin(timeSec * 0.8 + state.phaseOffset) * 0.18;
  }

  const earTwitch = Math.pow(Math.max(0, Math.sin(timeSec * 3.7 + state.phaseOffset)), 8.0) * 0.28;
  rig.earLeftPivot.rotation.y = -0.25 + earTwitch;
  rig.earRightPivot.rotation.y = 0.25 - earTwitch * 0.7;
  rig.tailPivot.rotation.x = Math.sin(timeSec * 4.5 + state.phaseOffset) * 0.16;
}

export function isInsideSightlineCorridor(
  px: number,
  pz: number,
  camPos: THREE.Vector3,
  targetPos: THREE.Vector3,
  corridorRadius = 2.2
): boolean {
  const vx = targetPos.x - camPos.x;
  const vz = targetPos.z - camPos.z;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-4) return false;
  const t = THREE.MathUtils.clamp(((px - camPos.x) * vx + (pz - camPos.z) * vz) / lenSq, 0.0, 1.05);
  const projX = camPos.x + t * vx;
  const projZ = camPos.z + t * vz;
  const distSq = (px - projX) * (px - projX) + (pz - projZ) * (pz - projZ);
  return distSq < corridorRadius * corridorRadius;
}

