/**
 * Chital (Axis axis) skeleton and procedural pose solver — EXPERIMENT (riverbank vertical slice).
 *
 * Pure and deterministic: no DOM, no WebGL, no randomness. Inputs come from the read-only observation contract
 * (position, heading, speed, behaviour family, fear); outputs are per-bone skinning matrices for an instanced
 * shader. Nothing here can write to the simulation.
 *
 * Model space: metres for an adult female at scale 1, +Z forward (heading 0 faces +Z, as in production), +Y up,
 * +X is the animal's left. Ground at the body centre is y = 0.
 *
 * Locomotion model (sources: Muybridge-style footfall studies of cervids; Hildebrand gait diagrams):
 * - walk: lateral-sequence 4-beat (LH, LF, RH, RF), duty factor ~0.65
 * - trot: diagonal pairs, duty ~0.45
 * - gallop: transverse/rotary, duty ~0.3 with a suspension phase
 * Gait phase advances with distance travelled divided by stride length, so a stance hoof stays fixed in the world
 * on a straight path at any speed (no skating). Stride length and frequency scale with body size (Froude scaling).
 */
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------ skeleton

export const BONE = {
  pelvis: 0, chest: 1, neck: 2, head: 3, tail: 4, earL: 5, earR: 6,
  // forelegs: scapula, humerus, radius, cannon, foot (pastern + hoof)
  FL0: 7, FR0: 12,
  // hind legs: femur, tibia, cannon, foot
  HL0: 17, HR0: 21,
} as const;
export const BONE_COUNT = 25;

export type LegId = 'FL' | 'FR' | 'HL' | 'HR';
export const LEGS: readonly LegId[] = ['FL', 'FR', 'HL', 'HR'];

/**
 * Joint positions in bind pose (adult female, withers ~0.82 m). Fore: scapular pivot, shoulder joint, elbow,
 * carpus, fetlock, toe. Hind: hip, stifle, hock, fetlock, toe. Toes are on the ground. The standing pose is
 * flexed (shoulder and hock angles) so stance sweep is reachable, as in real cervid limbs.
 */
export interface LegJoints {
  j: THREE.Vector3[];
  /** Heel of the hoof sole (ground), for sole-contact measurement. */
  heel: THREE.Vector3;
  front: boolean;
  side: 1 | -1;
  bone0: number;
  parent: number;
  /** Bones whose angle is a fixed share of the leg swing (scapula). */
  shares: number[];
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function leg(front: boolean, side: 1 | -1, bone0: number): LegJoints {
  const s = side;
  if (front) {
    return {
      j: [v(s * 0.085, 0.8, 0.2), v(s * 0.1, 0.615, 0.33), v(s * 0.1, 0.46, 0.19), v(s * 0.092, 0.268, 0.245), v(s * 0.09, 0.08, 0.255), v(s * 0.09, 0, 0.3)],
      heel: v(s * 0.09, 0, 0.245), front, side, bone0, parent: BONE.chest, shares: [0.45],
    };
  }
  return {
    j: [v(s * 0.095, 0.76, -0.37), v(s * 0.112, 0.53, -0.25), v(s * 0.095, 0.405, -0.47), v(s * 0.09, 0.08, -0.43), v(s * 0.09, 0, -0.385)],
    heel: v(s * 0.09, 0, -0.44), front, side, bone0, parent: BONE.pelvis, shares: [],
  };
}

export const SKELETON = {
  /** Bind-pose head position of every bone (index = bone id). */
  pos: [] as THREE.Vector3[],
  parent: [] as number[],
  legs: {
    FL: leg(true, 1, BONE.FL0), FR: leg(true, -1, BONE.FR0),
    HL: leg(false, 1, BONE.HL0), HR: leg(false, -1, BONE.HR0),
  } as Record<LegId, LegJoints>,
  /** Muzzle tip in bind pose (for grazing/drinking reach). */
  muzzle: v(0, 1.0, 0.85),
  /** Body pivot used for terrain pitch/roll. */
  pivot: v(0, 0.74, -0.04),
};
{
  const P = SKELETON.pos;
  const par = SKELETON.parent;
  const set = (i: number, p: THREE.Vector3, parent: number): void => {
    P[i] = p;
    par[i] = parent;
  };
  set(BONE.pelvis, v(0, 0.79, -0.3), -1);
  set(BONE.chest, v(0, 0.79, 0.12), BONE.pelvis);
  set(BONE.neck, v(0, 0.7, 0.4), BONE.chest);
  set(BONE.head, v(0, 1.17, 0.6), BONE.neck);
  set(BONE.tail, v(0, 0.8, -0.58), BONE.pelvis);
  set(BONE.earL, v(0.045, 1.215, 0.595), BONE.head);
  set(BONE.earR, v(-0.045, 1.215, 0.595), BONE.head);
  for (const id of LEGS) {
    const L = SKELETON.legs[id];
    for (let k = 0; k < L.j.length - 1; k++) set(L.bone0 + k, L.j[k]!.clone(), k === 0 ? L.parent : L.bone0 + k - 1);
  }
}

const legLen = (L: LegJoints, k: number): number => L.j[k]!.distanceTo(L.j[k + 1]!);
/** Distal pair (forearm+cannon / tibia+cannon) is never driven past this fraction of its full length. */
export const MAX_EXTENSION = 0.985;
/**
 * Largest stance sweep (model metres) the forelimb can cover with the fetlock at standing height: the chain from the
 * scapular pivot at full allowed extension, minus a margin. Forelimbs are the limiting pair in this skeleton.
 */
export const SWEEP_MAX = ((): number => {
  const L = SKELETON.legs.FL;
  const n = L.j.length - 1;
  let chain = 0;
  for (let k = 0; k < n - 1; k++) chain += legLen(L, k) * (k >= n - 3 ? MAX_EXTENSION : 1);
  const h = L.j[0]!.y - L.j[n - 1]!.y;
  return 2 * Math.sqrt(Math.max(0, (chain * 0.96) ** 2 - h * h));
})();
/** Test/diagnostic hook (off in production). */
export const DEBUG = { on: false, log: [] as Record<string, unknown>[] };

// ------------------------------------------------------------------------------------------------ gaits

interface GaitDef {
  duty: number;
  /** Phase offset of each leg's touchdown, fraction of the cycle. */
  offset: Record<LegId, number>;
  /** Swing lift (model metres), front and hind. */
  lift: [number, number];
  /** Vertical body oscillation amplitude (m); negative = lowest at mid-stance (compliant gaits). */
  bob: number;
  /** Spine flexion amplitude (rad) — gallop. */
  flex: number;
  /** Head/neck nod amplitude (rad). */
  nod: number;
  /** Hip roll amplitude (rad). */
  roll: number;
}

export const GAITS: Record<'walk' | 'trot' | 'gallop', GaitDef> = {
  walk: { duty: 0.62, offset: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, lift: [0.075, 0.06], bob: 0.012, flex: 0, nod: 0.05, roll: 0.035 },
  trot: { duty: 0.45, offset: { HL: 0, FR: 0, HR: 0.5, FL: 0.5 }, lift: [0.13, 0.11], bob: -0.022, flex: 0.02, nod: 0.025, roll: 0.02 },
  gallop: { duty: 0.22, offset: { HL: 0, HR: 0.1, FL: 0.45, FR: 0.56 }, lift: [0.2, 0.17], bob: -0.05, flex: 0.11, nod: 0.08, roll: 0.01 },
};

/** Speed bands (m/s, scaled by body size) where gaits blend. */
const WALK_TROT: [number, number] = [1.9, 2.6];
const TROT_GALLOP: [number, number] = [4.6, 6.0];

export const smooth01 = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Gait weights [walk, trot, gallop] for a size-normalised speed. */
export function gaitWeights(vn: number): [number, number, number] {
  const t = smooth01(WALK_TROT[0], WALK_TROT[1], vn);
  const g = smooth01(TROT_GALLOP[0], TROT_GALLOP[1], vn);
  return [(1 - t), t * (1 - g), g];
}

/** Stride (cycle) length in metres for a world speed and body scale. Froude-scaled cadence. */
export function strideLength(speed: number, scale: number): number {
  const vn = speed / Math.sqrt(Math.max(scale, 0.2));
  const freq = (0.9 + 0.62 * Math.pow(Math.max(vn, 0.05), 0.6)) / Math.sqrt(Math.max(scale, 0.2));
  return Math.max(speed, 0.05) / freq;
}

/** Normalised foot path for one leg at cycle phase u. Returns stance flag, forward offset (-0.5..0.5 of sweep), lift 0..1. */
export function footPath(u: number, duty: number): { stance: boolean; f: number; lift: number; swing: number } {
  u = ((u % 1) + 1) % 1;
  if (u < duty) return { stance: true, f: 0.5 - u / duty, lift: 0, swing: 0 };
  const s = (u - duty) / (1 - duty);
  // cycloid-like ease: zero velocity at lift-off and touchdown relative to the ground
  const e = s - Math.sin(2 * Math.PI * s) / (2 * Math.PI);
  const lift = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.85)), 1.2);
  return { stance: false, f: -0.5 + e, lift, swing: s };
}

// ------------------------------------------------------------------------------------------------ state & input

export type Family = 'idle' | 'wander' | 'graze' | 'travel-to-water' | 'drink' | 'rest' | 'flee' | 'court'
  | 'stalk' | 'chase' | 'travel-to-carrion' | 'feed' | 'roost' | 'follow-mother' | 'regroup';

export interface RigInput {
  /** World position of the body centre (interpolated) and smoothed heading (radians, 0 = +Z). */
  x: number;
  z: number;
  heading: number;
  /** Measured ground speed this frame, m/s (from displacement, not commanded). */
  speed: number;
  family: Family;
  fear: number;
  /** Uniform model scale (growth x sex); 1 = adult female. */
  scale: number;
  dt: number;
  /** Presentation time, seconds (idle variation only). */
  time: number;
  seed: number;
}

export interface RigState {
  /** Gait cycles travelled (fractional part = phase). */
  phase: number;
  speed: number;
  gw: [number, number, number];
  move: number;
  lie: number;
  graze: number;
  drink: number;
  alert: number;
  flee: number;
  pitch: number;
  roll: number;
  dy: number;
  yaw: number;
  yawRate: number;
  init: boolean;
}

export function newRigState(): RigState {
  return { phase: 0, speed: 0, gw: [1, 0, 0], move: 0, lie: 0, graze: 0, drink: 0, alert: 0, flee: 0, pitch: 0, roll: 0, dy: 0, yaw: 0, yawRate: 0, init: false };
}

export type TerrainFn = (x: number, z: number) => number;

/** Output of one solve: skinning matrices (12 floats per bone, row-major 3x4) plus diagnostics. */
export interface RigOutput {
  bones: Float32Array;
  /** World-space ground height under the body centre (instance origin y). */
  groundY: number;
  /** Per-leg diagnostics in world space. */
  feet: Record<LegId, { /** Stance position 0.5 (touchdown) .. -0.5 (lift-off); NaN in swing. */ f: number; stance: boolean; toe: THREE.Vector3; heel: THREE.Vector3; terrainToe: number; terrainHeel: number; reach: number }>;
}

// ------------------------------------------------------------------------------------------------ solver

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Skin matrix for a rotation q about bind joint p, applied after parent: S = parent * T(p) R T(-p). */
function rotAbout(parent: THREE.Matrix4, p: THREE.Vector3, q: THREE.Quaternion, out: THREE.Matrix4): THREE.Matrix4 {
  tmpM.makeRotationFromQuaternion(q);
  const e = tmpM.elements;
  // T(p) R T(-p): translation = p - R p
  tmpV.copy(p).applyMatrix3(new THREE.Matrix3().setFromMatrix4(tmpM));
  e[12] = p.x - tmpV.x;
  e[13] = p.y - tmpV.y;
  e[14] = p.z - tmpV.z;
  return out.multiplyMatrices(parent, tmpM);
}

function writeBone(out: Float32Array, i: number, m: THREE.Matrix4): void {
  const e = m.elements;
  const o = i * 12;
  // rows of the 3x4 affine matrix (column-major elements)
  out[o] = e[0]!; out[o + 1] = e[4]!; out[o + 2] = e[8]!; out[o + 3] = e[12]!;
  out[o + 4] = e[1]!; out[o + 5] = e[5]!; out[o + 6] = e[9]!; out[o + 7] = e[13]!;
  out[o + 8] = e[2]!; out[o + 9] = e[6]!; out[o + 10] = e[10]!; out[o + 11] = e[14]!;
}

/** Two-bone IK: root a, target c, lengths la, lb, pole direction. Returns middle joint (clamped reach). */
function twoBone(a: THREE.Vector3, c: THREE.Vector3, la: number, lb: number, pole: THREE.Vector3, out: THREE.Vector3): number {
  const d = tmpV2.subVectors(c, a);
  let dist = d.length();
  const reach = dist;
  dist = Math.min(Math.max(dist, Math.abs(la - lb) + 1e-4), la + lb - 1e-4);
  const dir = d.normalize();
  const cosA = (la * la + dist * dist - lb * lb) / (2 * la * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(a).addScaledVector(dir, la * cosA).addScaledVector(pp, la * sinA);
  return reach;
}

/** Rotation that takes bind direction (rotated by base) to the new direction, composed with base. */
function boneRotation(base: THREE.Quaternion, bindDir: THREE.Vector3, newDir: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const bd = bindDir.clone().applyQuaternion(base).normalize();
  tmpQ.setFromUnitVectors(bd, newDir.clone().normalize());
  return out.multiplyQuaternions(tmpQ, base);
}

const approach = (cur: number, target: number, rate: number, dt: number): number => cur + (target - cur) * Math.min(1, dt * rate);

/** Smoothly varying deterministic noise in [-1, 1]. */
function wobble(t: number, seed: number): number {
  return Math.sin(t * 1.13 + seed * 1.7) * 0.6 + Math.sin(t * 2.71 + seed * 3.1) * 0.4;
}

/**
 * Advance the per-animal state and solve the pose. `terrain` returns world ground height.
 * `bonesOut` must hold BONE_COUNT * 12 floats.
 */
export function solveRig(st: RigState, inp: RigInput, terrain: TerrainFn, bonesOut: Float32Array): RigOutput {
  const dt = Math.min(inp.dt, 0.1);
  const sc = inp.scale;
  const sinH = Math.sin(inp.heading);
  const cosH = Math.cos(inp.heading);
  // model (x, z) -> world, without scale for directions
  const wx = (mx: number, mz: number): number => inp.x + (mx * cosH + mz * sinH) * sc;
  const wz = (mx: number, mz: number): number => inp.z + (-mx * sinH + mz * cosH) * sc;
  const groundY = terrain(inp.x, inp.z);
  const toModelY = (wy: number): number => (wy - groundY) / sc;

  // ---- behaviour layers (smoothed)
  if (!st.init) {
    st.init = true;
    st.yaw = inp.heading;
    st.speed = inp.speed;
    st.lie = inp.family === 'rest' && inp.speed < 0.05 ? 1 : 0;
  }
  let dyaw = inp.heading - st.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  st.yawRate = approach(st.yawRate, dt > 0 ? dyaw / dt : 0, 6, dt);
  st.yaw = inp.heading;
  st.speed = approach(st.speed, inp.speed, 10, dt);
  const moving = st.speed > 0.06;
  const fam = inp.family;
  const eating = !moving && (fam === 'graze' || fam === 'drink' || fam === 'feed');
  st.move = approach(st.move, moving ? 1 : 0, moving ? 8 : 5, dt);
  // lying down is slow (~1.6 s); getting up is quick (~0.5 s): the simulation may already be moving the animal
  const wantLie = fam === 'rest' && !moving ? 1 : 0;
  st.lie = wantLie ? Math.min(1, st.lie + dt / 1.6) : Math.max(0, st.lie - dt / 0.5);
  st.graze = approach(st.graze, eating && fam !== 'drink' ? 1 : 0, 2.2, dt);
  st.drink = approach(st.drink, eating && fam === 'drink' ? 1 : 0, 2.2, dt);
  st.alert = approach(st.alert, inp.fear > 0.3 && st.lie < 0.5 ? 1 : 0, 4, dt);
  st.flee = approach(st.flee, fam === 'flee' ? 1 : 0, 3, dt);
  const lie = st.lie * st.lie * (3 - 2 * st.lie);
  const vn = st.speed / Math.sqrt(sc);
  const target = gaitWeights(vn);
  for (let i = 0; i < 3; i++) st.gw[i] = approach(st.gw[i]!, target[i]!, 5, dt);
  const gw = st.gw;
  const G = [GAITS.walk, GAITS.trot, GAITS.gallop];
  const mix = (f: (g: GaitDef) => number): number => gw[0] * f(G[0]!) + gw[1] * f(G[1]!) + gw[2] * f(G[2]!);
  // phase advances with distance travelled; when standing it settles to the nearest all-feet-down point
  // stride is capped by what the limbs can sweep in stance; beyond that, cadence rises instead (no foot slip)
  const duty = mix((g) => g.duty);
  // on steep ground deer shorten their steps: the stride cap shrinks with the body's pitch (previous frame's value)
  const slopeK = 1 / (1 + 2.2 * Math.abs(Math.tan(st.pitch)));
  const L = Math.min(strideLength(Math.max(st.speed, 0.4), sc), (SWEEP_MAX * sc * slopeK) / duty);
  if (moving) st.phase += (st.speed * dt) / L;
  const u = st.phase - Math.floor(st.phase);
  const amp = st.move * (1 - lie);

  const sweep = ((duty * L) / sc) * amp;

  // ---- terrain attitude: pitch from fore/hind ground, roll from left/right
  const hF = toModelY(terrain(wx(0, 0.28), wz(0, 0.28)));
  const hH = toModelY(terrain(wx(0, -0.41), wz(0, -0.41)));
  const hLft = toModelY(terrain(wx(0.12, -0.05), wz(0.12, -0.05)));
  const hRgt = toModelY(terrain(wx(-0.12, -0.05), wz(-0.12, -0.05)));
  const tPitch = Math.max(-0.45, Math.min(0.45, Math.atan2(hF - hH, 0.69)));
  const tRoll = Math.max(-0.2, Math.min(0.2, Math.atan2(hLft - hRgt, 0.24))) * 0.6;
  st.pitch = approach(st.pitch, tPitch, 10, dt);
  st.roll = approach(st.roll, tRoll, 10, dt);

  // ---- gait-driven body motion (weight transfer)
  const mid = (o: number): number => o + duty / 2;
  const off = (id: LegId): number => mix((g) => g.offset[id]);
  const bobAmp = mix((g) => g.bob) * amp;
  const chestBob = bobAmp * Math.cos(4 * Math.PI * (u - mid(off('FL'))));
  const pelvisBob = bobAmp * Math.cos(4 * Math.PI * (u - mid(off('HL'))));
  const flex = mix((g) => g.flex) * amp * Math.sin(2 * Math.PI * (u - 0.2));
  const hipRoll = mix((g) => g.roll) * amp * Math.sin(2 * Math.PI * (u - mid(off('HL'))));
  // lateral sway toward the supporting side in a walk
  const sway = 0.012 * gw[0] * amp * Math.sin(2 * Math.PI * (u - 0.05));

  const lieDrop = 0.47 * lie;
  const grazeDrop = 0.035 * Math.max(st.graze, st.drink) * (1 - lie);
  st.dy = approach(st.dy, (hF + hH) / 2, 12, dt);
  // steep ground: lower the centre of mass (limbs flex), as deer do on banks
  const crouch = 0.08 * smooth01(0.18, 0.45, Math.abs(st.pitch)) * (1 - lie);
  const baseY = st.dy - lieDrop - grazeDrop - crouch + (chestBob + pelvisBob) * 0.5;

  // body frame B = T(0, baseY, 0) * T(pivot) * R(pitch, roll) * T(-pivot)
  const pitch = st.pitch + 0.06 * Math.max(st.graze, st.drink) * (1 - lie) + (chestBob - pelvisBob) * 1.2;
  const B = new THREE.Matrix4();
  const qBody = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, 0, st.roll * (1 - lie), 'YXZ'));
  rotAbout(new THREE.Matrix4().makeTranslation(sway, baseY, 0), SKELETON.pivot, qBody, B);

  const S: THREE.Matrix4[] = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
  const P = SKELETON.pos;
  const qPelvis = new THREE.Quaternion().setFromEuler(new THREE.Euler(flex * 0.5, 0, hipRoll, 'YXZ'));
  rotAbout(B, P[BONE.pelvis]!, qPelvis, S[BONE.pelvis]!);
  // spine: flexion (gallop), bend into turns
  const bend = Math.max(-0.25, Math.min(0.25, st.yawRate * 0.12)) * (1 - lie);
  const qChest = new THREE.Quaternion().setFromEuler(new THREE.Euler(-flex, bend, -hipRoll * 0.6, 'YXZ'));
  rotAbout(S[BONE.pelvis]!, P[BONE.chest]!, qChest, S[BONE.chest]!);

  // ---- neck and head
  const nod = mix((g) => g.nod) * amp * Math.cos(4 * Math.PI * (u - mid(off('FL')) - 0.06));
  const idleLook = (1 - st.move) * (1 - st.graze) * (1 - st.drink);
  const lookYaw = idleLook * 0.35 * wobble(inp.time * 0.23, inp.seed) + bend * 1.4;
  // neck pitch: + lowers. Standing ~0 (bind holds the head up at ~55 deg neck angle).
  let neckPitch = nod + 0.18 * gw[2] * amp - 0.22 * st.alert * (1 - lie) + 0.12 * lie;
  let headPitch = -nod * 0.6 + 0.05 * gw[1] * amp - 0.1 * st.alert;
  // grazing/drinking: solve neck angle so the muzzle reaches the ground ahead of the forefeet
  const eat = Math.max(st.graze, st.drink) * (1 - lie);
  if (eat > 0.001) {
    const chewBob = st.graze * 0.05 * Math.sin(inp.time * 2.3 + inp.seed);
    const groundAhead = toModelY(terrain(wx(0, 0.72), wz(0, 0.72)));
    const reachPitch = solveNeckReach(S[BONE.chest]!, groundAhead + 0.03, st.drink > st.graze ? 0.25 : 0.0);
    neckPitch = neckPitch * (1 - eat) + reachPitch.neck * eat + chewBob * eat;
    headPitch = headPitch * (1 - eat) + reachPitch.head * eat;
  }
  const qNeck = new THREE.Quaternion().setFromEuler(new THREE.Euler(neckPitch, lookYaw * 0.6, 0, 'YXZ'));
  rotAbout(S[BONE.chest]!, P[BONE.neck]!, qNeck, S[BONE.neck]!);
  const qHead = new THREE.Quaternion().setFromEuler(new THREE.Euler(headPitch, lookYaw * 0.4, 0, 'YXZ'));
  rotAbout(S[BONE.neck]!, P[BONE.head]!, qHead, S[BONE.head]!);
  // ears: forward when alert, otherwise slow independent flicks
  for (const [b, side] of [[BONE.earL, 1], [BONE.earR, -1]] as const) {
    const flick = Math.max(0, Math.sin(inp.time * 0.9 + inp.seed * 2.3 + side * 1.9) - 0.92) * 9;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35 * st.alert + 0.25 * flick, side * (0.25 * flick - 0.3 * st.alert), side * 0.1 * wobble(inp.time * 0.4, inp.seed + side), 'YXZ'));
    rotAbout(S[BONE.head]!, P[b]!, q, S[b]!);
  }
  // tail: hangs and swishes; raised (white flag) in alarm and flight
  const flag = Math.max(st.flee, st.alert * 0.6);
  const swish = (1 - flag) * 0.22 * wobble(inp.time * 1.6, inp.seed + 7);
  const qTail = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.25 * flag + 0.1 * amp, swish, 0, 'YXZ'));
  rotAbout(S[BONE.pelvis]!, P[BONE.tail]!, qTail, S[BONE.tail]!);

  // ---- legs: foot targets from the gait, placed on terrain, solved with IK
  const feet = {} as RigOutput['feet'];
  const liftF = mix((g) => g.lift[0]);
  const liftH = mix((g) => g.lift[1]);
  const qBodyRot = new THREE.Quaternion();
  for (const id of LEGS) {
    const Lg = SKELETON.legs[id];
    const parentM = S[Lg.parent]!;
    const parentQ = qBodyRot.setFromRotationMatrix(parentM);
    const nb = Lg.j.length - 1; // bones in this leg; the last is the foot
    const iToe = nb;
    const iFet = nb - 1;
    const J0 = Lg.j[0]!.clone().applyMatrix4(parentM);
    // gait foot path; the phase offset of each leg is blended across gaits
    const fp = footPath(u - off(id), duty);
    const lift = (Lg.front ? liftF : liftH) * fp.lift * amp;
    const toeBind = Lg.j[iToe]!;
    // in locomotion the sweep centres under the limb pivot (scapula / hip), standing it returns to the rest stance
    const zRest = toeBind.z * (1 - amp) + (Lg.j[0]!.z + (Lg.front ? 0.01 : -0.01)) * amp;
    // lying: hooves tucked under the body (fore) and forward beside the belly (hind)
    const toeLieZ = Lg.front ? 0.04 : -0.12;
    const toeLieX = Lg.front ? Lg.side * 0.07 : Lg.side * 0.2;
    const tx = toeBind.x * (1 - lie) + toeLieX * lie;
    const tz = (zRest + fp.f * sweep) * (1 - lie) + toeLieZ * lie;
    const groundToe = toModelY(terrain(wx(tx, tz), wz(tx, tz)));
    const T = new THREE.Vector3(tx, groundToe + lift + 0.012 * lie, tz);
    // pastern: follows body pitch in stance, flexes in swing, folds when lying
    const pastern = toeBind.clone().sub(Lg.j[iFet]!);
    // breakover: late in stance the heel lifts and the hoof rolls over the toe; the roll unwinds early in swing
    const roll = 0.55 * amp * (fp.stance ? smooth01(-0.2, -0.5, fp.f) : Math.pow(1 - fp.swing, 3));
    const flexA = (Lg.front ? 1.3 : 1.0) * Math.sin(Math.PI * fp.swing) * amp + roll + (Lg.front ? 2.0 : 1.4) * lie;
    const qFoot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-st.pitch * (1 - lie), 0, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(X, flexA));
    pastern.applyQuaternion(qFoot);
    const F = T.clone().sub(pastern);
    // leg swing angle in the parent (body) frame, relative to bind
    const parentInv = parentQ.clone().invert();
    const legBind = Lg.j[iFet]!.clone().sub(Lg.j[0]!);
    const legNow = F.clone().sub(J0).applyQuaternion(parentInv);
    const swingA = Math.atan2(legNow.z, -legNow.y) - Math.atan2(legBind.z, -legBind.y);
    const joints: THREE.Vector3[] = [J0];
    const place = (from: THREE.Vector3, k: number, a: number): THREE.Vector3 =>
      from.clone().addScaledVector(Lg.j[k + 1]!.clone().sub(Lg.j[k]!).applyAxisAngle(X, -a).applyQuaternion(parentQ).normalize(), legLen(Lg, k));
    // 1) share bones (scapula): a share of the swing, folded back when lying. If the rest of the limb cannot then
    //    reach, the bone turns toward the hoof (bisection) only as far as needed.
    let k = 0;
    for (const share of Lg.shares) {
      const from = joints[k]!;
      const a0 = swingA * share - 0.35 * lie;
      const rest = (legLen(Lg, k + 1) + (legLen(Lg, k + 2) + legLen(Lg, k + 3)) * MAX_EXTENSION) * 0.995;
      let a = a0;
      if (place(from, k, a0).distanceTo(F) > rest) {
        const bd = Lg.j[k + 1]!.clone().sub(Lg.j[k]!);
        const toF = F.clone().sub(from).applyQuaternion(parentInv);
        const aF = Math.atan2(toF.z, -toF.y) - Math.atan2(bd.z, -bd.y);
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 14; i++) {
          const t = (lo + hi) / 2;
          if (place(from, k, a0 + (aF - a0) * t).distanceTo(F) > rest) lo = t;
          else hi = t;
        }
        a = a0 + (aF - a0) * hi;
      }
      joints.push(place(from, k, a));
      k++;
    }
    // 2) one searched bone (humerus / femur): starts from a share of the swing, then rotates only as far as needed
    //    to keep the distal pair just short of full extension. This is where ungulates get stance reach.
    const upper0 = swingA * (Lg.front ? 0.3 : 0.45) + (Lg.front ? -0.8 : 0.75) * lie;
    const lim = (legLen(Lg, k + 1) + legLen(Lg, k + 2)) * MAX_EXTENSION;
    const base = joints[k]!;
    const over = (a: number): number => place(base, k, a).distanceTo(F) - lim;
    let upperA = upper0;
    if (over(upper0) > 0) {
      let best = upper0;
      let bestCost = Infinity;
      for (let i = -30; i <= 30; i++) {
        const a = upper0 + i * 0.04;
        const cost = Math.max(0, over(a)) * 40 + Math.abs(a - upper0);
        if (cost < bestCost) { bestCost = cost; best = a; }
      }
      upperA = best;
    }
    joints.push(place(base, k, upperA));
    if (DEBUG.on) DEBUG.log.push({ id, f: fp.f, stance: fp.stance, d: J0.distanceTo(F), over: over(upperA), upper0, upperA, Fz: F.z, J0z: J0.z, J0y: J0.y });
    k++;
    // 3) two-bone IK: carpus displaces forward (fore), hock backward (hind)
    const pole = Z.clone().multiplyScalar(Lg.front ? 1 : -1).applyQuaternion(parentQ);
    const mid = new THREE.Vector3();
    const reach = twoBone(joints[k]!, F, legLen(Lg, k), legLen(Lg, k + 1), pole, mid);
    joints.push(mid);
    joints.push(mid.clone().add(F.clone().sub(mid).normalize().multiplyScalar(legLen(Lg, k + 1))));
    // 4) foot
    joints.push(joints[joints.length - 1]!.clone().add(pastern));
    // bone rotations
    const qPrev = parentQ.clone();
    for (let b = 0; b < nb; b++) {
      const bindDir = Lg.j[b + 1]!.clone().sub(Lg.j[b]!);
      const newDir = joints[b + 1]!.clone().sub(joints[b]!);
      // the hoof keeps its planned orientation (flat sole in stance); other bones take the shortest arc from the previous
      const q = b === nb - 1 ? qFoot.clone() : boneRotation(qPrev, bindDir, newDir, new THREE.Quaternion());
      const m = S[Lg.bone0 + b]!.makeRotationFromQuaternion(q);
      const pr = Lg.j[b]!.clone().applyQuaternion(q);
      m.setPosition(joints[b]!.x - pr.x, joints[b]!.y - pr.y, joints[b]!.z - pr.z);
      qPrev.copy(q);
    }
    // diagnostics: world toe and heel (sole) vs terrain
    const footM = S[Lg.bone0 + nb - 1]!;
    const toeM = toeBind.clone().applyMatrix4(footM);
    const heelM = Lg.heel.clone().applyMatrix4(footM);
    const toW = (p: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(wx(p.x, p.z), groundY + p.y * sc, wz(p.x, p.z));
    const toeW = toW(toeM);
    const heelW = toW(heelM);
    feet[id] = { f: fp.stance ? fp.f : NaN, stance: fp.stance || amp < 0.05, toe: toeW, heel: heelW, terrainToe: terrain(toeW.x, toeW.z), terrainHeel: terrain(heelW.x, heelW.z), reach: reach / (legLen(Lg, nb - 3) + legLen(Lg, nb - 2)) };
  }

  for (let i = 0; i < BONE_COUNT; i++) writeBone(bonesOut, i, S[i]!);
  return { bones: bonesOut, groundY, feet };
}

/**
 * Neck and head pitch (rad, + lowers) that bring the muzzle to model height `groundY` ahead of the forefeet.
 * Bisection on the neck angle with the head angled toward vertical; pure geometry on the bind skeleton.
 */
function solveNeckReach(chest: THREE.Matrix4, groundY: number, extraHead: number): { neck: number; head: number } {
  const P = SKELETON.pos;
  const m = new THREE.Matrix4();
  const mh = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  // the head flexes at the poll so the face points down and slightly forward (~0.3 rad from vertical) whatever
  // the neck angle: total head-axis rotation = bind face angle - target face angle
  const face = SKELETON.muzzle.clone().sub(P[BONE.head]!);
  const bindFace = Math.atan2(face.z, -face.y);
  const total = bindFace - (0.3 - extraHead);
  const muzzleY = (neck: number): number => {
    q.setFromEuler(new THREE.Euler(neck, 0, 0));
    rotAbout(chest, P[BONE.neck]!, q, m);
    q.setFromEuler(new THREE.Euler(total - neck, 0, 0));
    rotAbout(m, P[BONE.head]!, q, mh);
    return SKELETON.muzzle.clone().applyMatrix4(mh).y;
  };
  let lo = 0;
  let hi = 1.9;
  for (let i = 0; i < 18; i++) {
    const midA = (lo + hi) / 2;
    if (muzzleY(midA) > groundY) lo = midA;
    else hi = midA;
  }
  const neck = (lo + hi) / 2;
  return { neck, head: total - neck };
}

// keep tree-shakers from flagging helpers used only in tests
export const _internal = { rotAbout, twoBone, tmpM2 };
