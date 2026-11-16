import { describe, expect, it } from 'vitest';
import { Simulation, behaviorFamily, type BehaviorFamily } from '@untamed/ecology';
import { GET_UP_S, LIE_DOWN_S, PoseInput, newPose, stepPose } from '../../apps/web/src/render/animalPose';

const base: PoseInput = { family: 'idle', moving: false, running: false, flying: false, flier: false, fear: 0, time: 0, seed: 1 };
const run = (fam: BehaviorFamily, seconds: number, extra: Partial<PoseInput> = {}, v = newPose(), dt = 1 / 60): { v: ReturnType<typeof newPose>; lies: number[]; heads: number[] } => {
  const lies: number[] = [];
  const heads: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    lies.push(stepPose(v, { ...base, family: fam, time: t, ...extra }, dt));
    heads.push(v.head);
  }
  return { v, lies, heads };
};

describe('animal pose (presentation only)', () => {
  it('a resting animal lies down over about 1.5 s, smoothly, and stays down', () => {
    const r = run('rest', 4);
    expect(LIE_DOWN_S).toBeGreaterThan(1.2);
    const half = Math.round((LIE_DOWN_S / 2) * 60);
    expect(r.lies[half]!).toBeGreaterThan(0.3);
    expect(r.lies[half]!).toBeLessThan(0.7);
    expect(r.lies.at(-1)).toBe(1);
    // no jumps: the eased value changes by at most a few percent per 60 Hz frame
    for (let i = 1; i < r.lies.length; i++) expect(Math.abs(r.lies[i]! - r.lies[i - 1]!)).toBeLessThan(0.03);
    // head is up and still while lying (not grazing)
    expect(r.v.head).toBeCloseTo(-0.12, 2);
  });

  it('gets up quickly when the animal moves or stops resting, and never lies while moving', () => {
    const down = run('rest', 4).v;
    const up = run('wander', 1, { moving: true }, down);
    expect(GET_UP_S).toBeLessThan(0.6);
    expect(up.lies[Math.ceil(GET_UP_S * 60) + 1]).toBe(0);
    expect(run('rest', 3, { moving: true }).lies.every((l) => l === 0)).toBe(true);
    // an alarm while lying lifts the head before anything else
    const alarmed = run('rest', 0.5, { fear: 0.8 }, run('rest', 4).v);
    expect(alarmed.v.head).toBeLessThan(-0.25);
  });

  it('blends head and leg swing between grazing, drinking, walking and running without jumps', () => {
    let v = newPose();
    const seq: [BehaviorFamily, Partial<PoseInput>][] = [['graze', {}], ['wander', { moving: true }], ['flee', { moving: true, running: true }], ['drink', {}], ['idle', {}]];
    let prevHead = 0;
    let prevAmp = 0;
    for (const [fam, x] of seq) {
      for (let i = 0; i < 90; i++) {
        stepPose(v, { ...base, family: fam, ...x, time: i / 60 }, 1 / 60);
        expect(Math.abs(v.head - prevHead)).toBeLessThan(0.12);
        expect(Math.abs(v.amp - prevAmp)).toBeLessThan(0.08);
        prevHead = v.head;
        prevAmp = v.amp;
      }
    }
    v = run('graze', 3).v;
    expect(v.head).toBeGreaterThan(1.3); // head down to the grass
    expect(run('drink', 3).v.head).toBeGreaterThan(1.55); // lower still to drink
    expect(run('wander', 3, { moving: true }).v.amp).toBeCloseTo(0.42, 2);
  });

  it('birds never lie down', () => {
    expect(run('rest', 3, { flier: true }).lies.every((l) => l === 0)).toBe(true);
  });

  it('reads the simulation through the contract and leaves it untouched', () => {
    const sim = new Simulation(2);
    for (let i = 0; i < 600; i++) sim.step(0.1);
    const h = sim.stateHash();
    const poses = new Map<number, ReturnType<typeof newPose>>();
    for (let f = 0; f < 120; f++) {
      for (const a of sim.animals) {
        let v = poses.get(a.id);
        if (!v) poses.set(a.id, (v = newPose()));
        stepPose(v, { ...base, family: behaviorFamily(a), moving: a.speed > 0.05, fear: a.fear, time: f / 60, seed: a.id }, 1 / 60);
      }
    }
    expect(sim.stateHash()).toBe(h);
    // and some deer really are resting at this point of the day, so lying poses occur
    expect([...poses.values()].some((v) => v.lie === 1)).toBe(true);
  });
});
