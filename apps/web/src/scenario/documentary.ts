/**
 * The documentary scenario: a repeatable starting point for reviewing the living valley (Assignment D).
 *
 * Everything here is initialisation. The world is generated from a fixed seed and advanced by the ordinary simulation
 * from tick 0 in fixed 1 s steps (the 100x step) to a fixed time of day; no animal, weather or environment field is
 * written. The camera pose is then derived from where the largest chital herd happens to be (the camera moves, the
 * animals do not). After that the
 * simulation runs untouched: nothing is staged or scripted.
 *
 * Pure and headless (no DOM, no renderer) so tests can check it reaches the same state every time.
 */
import { SPECIES_INDEX, type Simulation } from '@untamed/ecology';
import { CHUNK_SIZE, SCATTER_STRIDE, ScatterKind } from '@untamed/worlds';

export const DOCUMENTARY = {
  /**
   * Seed 2: clear late-monsoon afternoon with a 13-deer herd on day 34. (Seed 3 was used until weather got its own
   * random stream; since then a seed's weather no longer changes when animal behaviour changes, and seed 3 is stormy
   * at this hour.)
   */
  seed: 2,
  /** Game hour to fast-forward to on day 0 (the valley starts at 07:00). Late afternoon: chital are crepuscular. */
  hour: 16.5,
  /** Fixed step used for the fast-forward, seconds (one game minute). */
  stepS: 1,
  /** Candidate camera distances from the herd's densest cluster (m), and eye height above the ground (m). */
  distances: [9, 12, 15, 19] as const,
  maxDist: 19,
  height: 1.8,
} as const;

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface DocumentaryStart {
  pose: CameraPose;
  /** What the viewer should find, for the documentation and tests (read from the simulation, not chosen). */
  /**
   * x, z: centre of the herd's densest cluster (`cluster` animals); inSight: of those, in frame with clear terrain and
   * object line of sight; subjectFrac: their mean height as a share of the frame height (estimate from geometry).
   */
  herd: { group: number; members: number; cluster: number; x: number; z: number; inSight: number; subjectFrac: number };
  conditions: { timeH: number; weather: string; season: number; tick: number };
}

/** Advance a freshly generated world to the scenario time. Throws if the world is not at tick 0. */
export function advanceToScenario(sim: Simulation): void {
  if (sim.tick !== 0) throw new Error('documentary scenario needs a fresh world at tick 0');
  const target = Math.floor(sim.env.timeH / 24) * 24 + DOCUMENTARY.hour;
  while (sim.env.timeH < target - 1e-9) sim.step(DOCUMENTARY.stepS);
}

/** Camera: 62 degree vertical field of view (Engine), 16:9 frame assumed for composition. */
const VFOV = (62 * Math.PI) / 180;
const HFOV = 2 * Math.atan(Math.tan(VFOV / 2) * (16 / 9));
/** Rendered chital height at the withers/head, metres (adult model ~1.1 m; the scale varies by animal). */
const SUBJECT_H = 1.1;

/** A scatter object approximated as a vertical cylinder from y0 to y1 above its base (metres). */
interface Occluder {
  x: number;
  z: number;
  base: number;
  r: number;
  y0: number;
  y1: number;
}

/** Trees (trunk and crown), snags, shrubs, rocks and logs near (x, z), from the world's deterministic scatter. */
export function occludersNear(sim: Simulation, x: number, z: number, radius: number): Occluder[] {
  const out: Occluder[] = [];
  const v = sim.valley;
  const c0x = Math.floor((x - radius) / CHUNK_SIZE);
  const c1x = Math.floor((x + radius) / CHUNK_SIZE);
  const c0z = Math.floor((z - radius) / CHUNK_SIZE);
  const c1z = Math.floor((z + radius) / CHUNK_SIZE);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const sc = v.scatter(cx, cz);
      for (let i = 0; i < sc.length; i += SCATTER_STRIDE) {
        const k = sc[i]!;
        const ox = sc[i + 1]!;
        const oz = sc[i + 3]!;
        if ((ox - x) ** 2 + (oz - z) ** 2 > radius * radius) continue;
        const base = sc[i + 2]!;
        const s = sc[i + 5]!;
        const K = ScatterKind;
        if (k === K.TreeBroad) out.push({ x: ox, z: oz, base, r: 0.35 * s, y0: 0, y1: 4 * s }, { x: ox, z: oz, base, r: 2.6 * s, y0: 3 * s, y1: 7.5 * s });
        else if (k === K.TreeTall) out.push({ x: ox, z: oz, base, r: 0.3 * s, y0: 0, y1: 8 * s }, { x: ox, z: oz, base, r: 1.7 * s, y0: 5.5 * s, y1: 12 * s });
        else if (k === K.Snag) out.push({ x: ox, z: oz, base, r: 0.3 * s, y0: 0, y1: 6.4 * s });
        else if (k === K.Shrub) out.push({ x: ox, z: oz, base, r: 1.0 * s, y0: 0, y1: 1.2 * s });
        else if (k === K.Rock) out.push({ x: ox, z: oz, base, r: 1.0 * s, y0: 0, y1: 0.85 * s });
        else if (k === K.Log) out.push({ x: ox, z: oz, base, r: 1.2 * s, y0: 0, y1: 0.55 * s });
      }
    }
  }
  return out;
}

/** True if neither terrain nor a scatter object blocks the straight line between the two points. */
function clearSight(sim: Simulation, occ: Occluder[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  if (!lineOfSight(sim, x0, y0, z0, x1, y1, z1)) return false;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L2 = dx * dx + dz * dz;
  for (const o of occ) {
    const t = Math.max(0, Math.min(1, ((o.x - x0) * dx + (o.z - z0) * dz) / L2));
    if (t > 0.97) continue; // objects at the subject itself (it stands beside them) do not hide it
    const px = x0 + dx * t - o.x;
    const pz = z0 + dz * t - o.z;
    if (px * px + pz * pz > o.r * o.r) continue;
    const y = y0 + (y1 - y0) * t - o.base;
    if (y > o.y0 && y < o.y1) return false;
  }
  return true;
}

/**
 * Camera pose for the opening shot. Moves the camera, never the animals: candidate spots around the largest herd's
 * densest cluster are scored by how large the visible deer appear (projected height, capped), counting only deer in
 * frame with clear terrain and object line of sight; spots on water, in ruins, inside or right behind objects, or with
 * a large object in the foreground of the frame are penalised or rejected. Deterministic (fixed candidate order).
 */
export function documentaryPose(sim: Simulation): DocumentaryStart {
  const groups = new Map<number, { n: number; x: number; z: number }>();
  for (const a of sim.animals) {
    if (!a.alive || a.sp !== SPECIES_INDEX.chital) continue;
    const g = groups.get(a.group) ?? { n: 0, x: 0, z: 0 };
    g.n++;
    g.x += a.x;
    g.z += a.z;
    groups.set(a.group, g);
  }
  let best = { group: 0, n: 0, x: 1000, z: 1000 };
  for (const [group, g] of groups) if (g.n > best.n || (g.n === best.n && group < best.group)) best = { group, n: g.n, x: g.x / g.n, z: g.z / g.n };
  const v = sim.valley;
  const members = sim.animals.filter((a) => a.alive && a.sp === SPECIES_INDEX.chital && a.group === best.group);
  // the herd's densest cluster: the member with most herd mates within 15 m, and those mates
  let core = members;
  let coreN = -1;
  for (const m of members) {
    const near = members.filter((o) => Math.hypot(o.x - m.x, o.z - m.z) < 15);
    if (near.length > coreN) {
      coreN = near.length;
      core = near;
    }
  }
  const tx = core.reduce((t, a) => t + a.x, 0) / core.length;
  const tz = core.reduce((t, a) => t + a.z, 0) / core.length;
  const ty = v.height(tx, tz) + 0.6;
  const occ = occludersNear(sim, tx, tz, DOCUMENTARY.maxDist + 16);
  let pose: CameraPose | null = null;
  let bestScore = -Infinity;
  let inSight = 0;
  let subjectFrac = 0;
  for (const dist of DOCUMENTARY.distances) {
    for (let k = 0; k < 24; k++) {
      const bearing = (k * Math.PI * 2) / 24;
      const x = tx + Math.sin(bearing) * dist;
      const z = tz + Math.cos(bearing) * dist;
      if (!v.inBounds(x, z, 30) || v.blocked(x, z, 2) || v.waterDepth(x, z, sim.env.stage) > -0.3) continue;
      if (occ.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + 0.8) ** 2)) continue; // not inside a bush or tree
      const y = v.height(x, z) + DOCUMENTARY.height;
      const yaw = Math.atan2(tx - x, tz - z);
      const pitch = Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      let score = 0;
      let seen = 0;
      let frac = 0;
      for (const a of core) {
        const ax = a.x - x;
        const az = a.z - z;
        const d = Math.hypot(ax, az);
        const ang = Math.atan2(ax * fz - az * fx, ax * fx + az * fz);
        if (Math.abs(ang) > HFOV * 0.42 || d < 4) continue; // in frame, with a margin, and not too close
        const ay = v.height(a.x, a.z) + 0.7;
        if (!clearSight(sim, occ, x, y, z, a.x, ay, a.z)) continue;
        const f = SUBJECT_H / (2 * d * Math.tan(VFOV / 2)); // share of frame height
        score += Math.min(f, 0.2);
        frac += f;
        seen++;
      }
      // foreground clutter: objects in the view cone within 14 m, by how much of the frame width they would take
      for (const o of occ) {
        const ox = o.x - x;
        const oz = o.z - z;
        const d = Math.hypot(ox, oz);
        if (d > 14 || d < 0.5) continue;
        const ang = Math.atan2(ox * fz - oz * fx, ox * fx + oz * fz);
        if (Math.abs(ang) > HFOV / 2 + Math.atan(o.r / d)) continue;
        if (o.base + o.y1 < y - Math.tan(VFOV / 2 - pitch) * d) continue; // entirely below the bottom of the frame
        if (o.base + o.y0 > y + Math.tan(VFOV / 2 + pitch) * d) continue; // entirely above (crowns overhead)
        const share = (2 * Math.atan(o.r / d)) / HFOV;
        score -= share > 0.2 ? 1 : share * 0.6;
      }
      // prefer the herd's side of the river: a view across open water mostly shows water
      let wet = false;
      for (let i = 1; i < 12 && !wet; i++) wet = v.waterDepth(x + (tx - x) * (i / 12) * 0.85, z + (tz - z) * (i / 12) * 0.85, sim.env.stage) > 0;
      if (wet) score -= 0.5;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        pose = { x, y, z, yaw, pitch };
        inSight = seen;
        subjectFrac = seen ? frac / seen : 0;
      }
    }
  }
  pose ??= { x: tx, y: v.heightFast(tx, tz) + 40, z: tz - 30, yaw: 0, pitch: -0.9 };
  return {
    pose,
    herd: { group: best.group, members: best.n, cluster: core.length, x: tx, z: tz, inSight, subjectFrac: Math.round(subjectFrac * 1000) / 1000 },
    conditions: { timeH: sim.env.timeH, weather: sim.env.weather, season: sim.env.season, tick: sim.tick },
  };
}

/** True if no terrain rises above the straight line between the two points (objects: see clearSight). */
function lineOfSight(sim: Simulation, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (let i = 1; i < 24; i++) {
    const t = i / 24;
    if (sim.valley.heightFast(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > y0 + (y1 - y0) * t - 0.2) return false;
  }
  return true;
}
