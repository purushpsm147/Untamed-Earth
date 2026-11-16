import { describe, expect, it } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { DOCUMENTARY, advanceToScenario, documentaryPose, occludersNear } from '../../apps/web/src/scenario/documentary';

describe('documentary scenario', () => {
  it('reaches the same world, time, conditions and camera every time, by ordinary simulation only', () => {
    const run = (): { hash: number; d: ReturnType<typeof documentaryPose> } => {
      const sim = new Simulation(DOCUMENTARY.seed);
      advanceToScenario(sim);
      return { hash: sim.stateHash(), d: documentaryPose(sim) };
    };
    const a = run();
    const b = run();
    expect(b.hash).toBe(a.hash);
    expect(b.d).toEqual(a.d);
    // identical to stepping a fresh world by hand: the scenario writes nothing into the simulation
    const manual = new Simulation(DOCUMENTARY.seed);
    while (manual.tick < a.d.conditions.tick) manual.step(DOCUMENTARY.stepS);
    expect(manual.stateHash()).toBe(a.hash);
    // the documented conditions (docs/DOCUMENTARY.md)
    expect(a.d.conditions.timeH % 24).toBeCloseTo(DOCUMENTARY.hour, 2);
    expect(a.d.conditions.weather).toBe('clear');
    expect(a.d.herd.members).toBeGreaterThanOrEqual(8);
    // the camera stands on dry, open ground at eye height, at one of the candidate distances, facing the herd
    const sim = new Simulation(DOCUMENTARY.seed);
    advanceToScenario(sim);
    const { pose, herd } = a.d;
    expect(sim.valley.blocked(pose.x, pose.z, 2)).toBe(false);
    expect(sim.valley.waterDepth(pose.x, pose.z, sim.env.stage)).toBeLessThan(-0.3);
    expect(pose.y - sim.valley.height(pose.x, pose.z)).toBeCloseTo(DOCUMENTARY.height, 3);
    const dist = Math.hypot(herd.x - pose.x, herd.z - pose.z);
    expect(DOCUMENTARY.distances.some((d) => Math.abs(d - dist) < 1e-6)).toBe(true);
    const face = Math.atan2(herd.x - pose.x, herd.z - pose.z);
    expect(Math.abs(Math.atan2(Math.sin(face - pose.yaw), Math.cos(face - pose.yaw)))).toBeLessThan(1e-9);
    // the deer are clearly visible: most of the cluster in frame and unobstructed, each a sizeable part of the frame
    expect(herd.inSight).toBeGreaterThanOrEqual(Math.min(6, herd.cluster));
    expect(herd.subjectFrac).toBeGreaterThan(0.05);
    // no tree, shrub, rock or log stands where the camera is
    for (const o of occludersNear(sim, pose.x, pose.z, 4)) expect(Math.hypot(o.x - pose.x, o.z - pose.z)).toBeGreaterThan(o.r + 0.8 - 1e-9);
    expect(() => advanceToScenario(sim)).toThrow(/tick 0/);
  });
});
