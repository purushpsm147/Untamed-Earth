/**
 * The documentary scenario: a repeatable starting point for reviewing the living valley (Assignment D).
 *
 * Everything here is initialisation. The world is generated from a fixed seed and advanced by the ordinary simulation
 * from tick 0 in fixed 1 s steps (the 100x step) to a fixed time of day; no animal, weather or environment field is
 * written. The camera pose is then derived from where the largest chital herd happens to be. After that the
 * simulation runs untouched: nothing is staged or scripted.
 *
 * Pure and headless (no DOM, no renderer) so tests can check it reaches the same state every time.
 */
import { SPECIES_INDEX, type Simulation } from '@untamed/ecology';

export const DOCUMENTARY = {
  /** Seed 3: clear late-monsoon afternoon with a 12-deer herd on day 34 (seeds 1, 2, 5-7 are raining then). */
  seed: 3,
  /** Game hour to fast-forward to on day 0 (the valley starts at 07:00). Late afternoon: chital are crepuscular. */
  hour: 16.5,
  /** Fixed step used for the fast-forward, seconds (one game minute). */
  stepS: 1,
  /** Camera stand-off from the herd's densest cluster, metres, and height above the ground there. */
  standoff: 24,
  height: 4,
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
  /** x, z: centre of the herd's densest cluster (`cluster` animals); inSight: of those, in terrain line of sight. */
  herd: { group: number; members: number; cluster: number; x: number; z: number; inSight: number };
  conditions: { timeH: number; weather: string; season: number; tick: number };
}

/** Advance a freshly generated world to the scenario time. Throws if the world is not at tick 0. */
export function advanceToScenario(sim: Simulation): void {
  if (sim.tick !== 0) throw new Error('documentary scenario needs a fresh world at tick 0');
  const target = Math.floor(sim.env.timeH / 24) * 24 + DOCUMENTARY.hour;
  while (sim.env.timeH < target - 1e-9) sim.step(DOCUMENTARY.stepS);
}

/** Camera pose looking at the largest chital herd, from the bearing with the clearest terrain line of sight. */
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
  // aim at the herd's densest cluster (the member with most herd mates within 15 m, and those mates), not at the
  // centroid of a herd that may be spread over 100 m
  let core = members;
  let coreN = -1;
  for (const m of members) {
    const near = members.filter((o) => Math.hypot(o.x - m.x, o.z - m.z) < 15);
    if (near.length > coreN) {
      coreN = near.length;
      core = near;
    }
  }
  best.x = core.reduce((t, a) => t + a.x, 0) / core.length;
  best.z = core.reduce((t, a) => t + a.z, 0) / core.length;
  // Try 16 stand-off bearings in a fixed order; keep the one from which most herd members are in terrain line of
  // sight (ties: the earlier bearing). Camera spots must be in bounds, outside ruins and on dry ground.
  let pose: CameraPose | null = null;
  let score = -Infinity;
  let seen = 0;
  for (let k = 0; k < 16; k++) {
    const bearing = (k * Math.PI * 2) / 16 + Math.PI / 4;
    const x = best.x + Math.sin(bearing) * DOCUMENTARY.standoff;
    const z = best.z + Math.cos(bearing) * DOCUMENTARY.standoff;
    if (!v.inBounds(x, z, 30) || v.blocked(x, z, 2) || v.waterDepth(x, z, sim.env.stage) > 0) continue;
    const y = v.heightFast(x, z) + DOCUMENTARY.height;
    let n = 0;
    for (const a of core) if (lineOfSight(sim, x, y, z, a.x, v.heightFast(a.x, a.z) + 0.7, a.z)) n++;
    // prefer spots on the herd's side of the river: a view across open water mostly shows water
    let wet = false;
    for (let i = 1; i < 12 && !wet; i++) wet = v.waterDepth(x + (best.x - x) * (i / 12) * 0.85, z + (best.z - z) * (i / 12) * 0.85, sim.env.stage) > 0;
    const sc = n - (wet ? 100 : 0);
    if (sc <= score) continue;
    score = sc;
    seen = n;
    const ty = v.heightFast(best.x, best.z) + 0.8;
    const dx = best.x - x;
    const dz = best.z - z;
    pose = { x, y, z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(ty - y, Math.hypot(dx, dz)) };
  }
  pose ??= { x: best.x, y: v.heightFast(best.x, best.z) + 40, z: best.z - 30, yaw: 0, pitch: -0.9 };
  return {
    pose,
    herd: { group: best.group, members: best.n, cluster: core.length, x: best.x, z: best.z, inSight: seen },
    conditions: { timeH: sim.env.timeH, weather: sim.env.weather, season: sim.env.season, tick: sim.tick },
  };
}

/** True if no terrain rises above the straight line between the two points (trees and ruins are not considered). */
function lineOfSight(sim: Simulation, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (let i = 1; i < 24; i++) {
    const t = i / 24;
    if (sim.valley.heightFast(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > y0 + (y1 - y0) * t - 0.2) return false;
  }
  return true;
}
