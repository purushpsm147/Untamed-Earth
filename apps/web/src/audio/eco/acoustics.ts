/**
 * Pure propagation helpers (no Web Audio): distance, direction, air absorption, terrain and foliage occlusion.
 *
 * These are perceptual approximations chosen to be plausible and cheap, NOT a calibrated outdoor propagation model.
 *  - Distance: the Web Audio 'inverse' model (the PannerNode applies it; `inverseGain` mirrors it for planning).
 *  - Air absorption: high frequencies fade faster with distance (qualitatively as in ISO 9613-1); modelled as a
 *    low-pass cutoff falling with distance.
 *  - Foliage: dense vegetation adds excess attenuation that grows with the length of path through it, stronger at
 *    high frequencies; modelled as ~6 dB per 100 m of full forest plus a lower cutoff.
 *  - Terrain: when the straight line from source to listener passes below the ground, the sound diffracts over the
 *    ridge: up to -14 dB and a low cutoff (~700 Hz) depending on how deep the line is buried.
 * Coordinates are world metres: x east, y up, z south (the game's frame).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Listener pose. yaw: 0 faces +z, increasing toward +x (same convention as animal heading and the game camera). */
export interface ListenerPose extends Vec3 {
  yaw: number;
}

export interface WorldSampler {
  /** Terrain height at (x, z), metres. */
  height(x: number, z: number): number;
  /** Forest density 0..1 at (x, z). */
  forest(x: number, z: number): number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Web Audio 'inverse' distance model: ref / (ref + rolloff * (max(d, ref) - ref)). */
export function inverseGain(d: number, ref: number, rolloff: number): number {
  return ref / (ref + rolloff * (Math.max(d, ref) - ref));
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Horizontal azimuth of a source relative to the listener's facing, radians in (-PI, PI]:
 * 0 ahead, +PI/2 to the listener's RIGHT, -PI/2 to the left.
 * With forward f = (sin yaw, 0, cos yaw) and up +y in a right-handed frame, right = f x up = (-cos yaw, 0, sin yaw).
 */
export function azimuth(l: ListenerPose, s: Vec3): number {
  const dx = s.x - l.x;
  const dz = s.z - l.z;
  const fwd = dx * Math.sin(l.yaw) + dz * Math.cos(l.yaw);
  const right = -dx * Math.cos(l.yaw) + dz * Math.sin(l.yaw);
  return Math.atan2(right, fwd);
}

export function listenerForward(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

/** Low-pass cutoff standing in for air absorption, Hz. */
export function airAbsorptionCutoff(d: number): number {
  return clamp(18000 * Math.exp(-d / 260), 1800, 18000);
}

export interface Occlusion {
  /** Linear gain multiplier from terrain + foliage (<= 1). */
  gain: number;
  /** Low-pass cutoff combining air absorption, foliage and terrain, Hz. */
  cutoffHz: number;
  /** 0 clear line of sight .. 1 deeply buried behind terrain. */
  terrain: number;
  /** Metres of the path through full-density forest. */
  foliageM: number;
}

const STEPS = 16;

/**
 * Occlusion between a source and the listener. Samples the straight path at STEPS points (cost: 2 x STEPS samples).
 * Call once when a voice starts, not per frame.
 */
export function occlusion(src: Vec3, lis: Vec3, w: WorldSampler): Occlusion {
  const d = distance(src, lis);
  let buried = 0;
  let foliageM = 0;
  const seg = d / STEPS;
  for (let i = 1; i < STEPS; i++) {
    const t = i / STEPS;
    const x = src.x + (lis.x - src.x) * t;
    const z = src.z + (lis.z - src.z) * t;
    const lineY = src.y + (lis.y - src.y) * t;
    const ground = w.height(x, z);
    buried = Math.max(buried, ground - lineY);
    foliageM += w.forest(x, z) * seg;
  }
  // 0 at grazing incidence, 1 when the ridge is >= 6 m above the line
  const terrain = clamp(buried / 6, 0, 1);
  const terrainDb = -14 * terrain;
  const foliageDb = -6 * (foliageM / 100);
  const gain = Math.pow(10, Math.max(-30, terrainDb + foliageDb) / 20);
  let cutoff = airAbsorptionCutoff(d);
  cutoff = Math.min(cutoff, 16000 * Math.exp(-foliageM / 120));
  if (terrain > 0) cutoff = Math.min(cutoff, 700 + (1 - terrain) * 4000);
  return { gain, cutoffHz: clamp(cutoff, 400, 18000), terrain, foliageM };
}
