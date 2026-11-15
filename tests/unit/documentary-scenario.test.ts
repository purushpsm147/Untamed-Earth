import { describe, expect, it } from 'vitest';
import { Simulation } from '@untamed/ecology';
import { DOCUMENTARY, advanceToScenario, documentaryPose } from '../../apps/web/src/scenario/documentary';

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
    // the camera stands on dry, open ground facing the herd from the stand-off distance
    const sim = new Simulation(DOCUMENTARY.seed);
    advanceToScenario(sim);
    const { pose, herd } = a.d;
    expect(sim.valley.blocked(pose.x, pose.z, 2)).toBe(false);
    expect(pose.y).toBeGreaterThan(sim.valley.heightFast(pose.x, pose.z) + 3);
    expect(Math.hypot(herd.x - pose.x, herd.z - pose.z)).toBeCloseTo(DOCUMENTARY.standoff, 3);
    const face = Math.atan2(herd.x - pose.x, herd.z - pose.z);
    expect(Math.abs(Math.atan2(Math.sin(face - pose.yaw), Math.cos(face - pose.yaw)))).toBeLessThan(1e-9);
    expect(() => advanceToScenario(sim)).toThrow(/tick 0/);
  });
});
