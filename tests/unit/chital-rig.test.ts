import { describe, expect, it } from 'vitest';
import { Valley } from '@untamed/worlds';
import { BONE_COUNT, GAITS, LEGS, SKELETON, SWEEP_MAX, RigInput, RigState, TerrainFn, footPath, gaitWeights, newRigState, solveRig, strideLength } from '../../apps/web/src/experiments/riverbank/chitalRig';

/**
 * Riverbank slice chital rig: physical plausibility gates that are measurable without a renderer.
 * These do NOT establish that the animation looks lifelike; that needs human review of footage.
 */

interface WalkResult { maxStanceToeErr: number; maxStanceHeelErr: number; maxSlip: number; minReach: number; maxReach: number; samples: number }

function walk(terrain: TerrainFn, speed: number, seconds: number, opts: { heading?: number; x?: number; z?: number; family?: RigInput['family']; scale?: number; dt?: number } = {}): WalkResult {
  const st: RigState = newRigState();
  const bones = new Float32Array(BONE_COUNT * 12);
  const heading = opts.heading ?? 0.3;
  const dt = opts.dt ?? 1 / 60;
  let x = opts.x ?? 0;
  let z = opts.z ?? 0;
  const planted: Record<string, { x: number; z: number } | null> = { FL: null, FR: null, HL: null, HR: null };
  let maxStanceToeErr = 0;
  let maxStanceHeelErr = 0;
  let maxSlip = 0;
  let minReach = 9;
  let maxReach = 0;
  let samples = 0;
  for (let t = 0; t < seconds; t += dt) {
    x += Math.sin(heading) * speed * dt;
    z += Math.cos(heading) * speed * dt;
    const out = solveRig(st, { x, z, heading, speed, family: opts.family ?? 'wander', fear: 0, scale: opts.scale ?? 1, dt, time: t, seed: 3 }, terrain, bones);
    if (t < 1) continue; // settle smoothing state
    for (const id of LEGS) {
      const f = out.feet[id];
      if (f.stance) {
        samples++;
        maxStanceToeErr = Math.max(maxStanceToeErr, Math.abs(f.toe.y - f.terrainToe));
        // heel is loaded from touchdown until breakover (heel lift) begins at f = -0.2; the toe stays planted throughout
        if (!(f.f < -0.2)) maxStanceHeelErr = Math.max(maxStanceHeelErr, Math.abs(f.heel.y - f.terrainHeel));
        minReach = Math.min(minReach, f.reach);
        maxReach = Math.max(maxReach, f.reach);
        const p = planted[id];
        if (p) maxSlip = Math.max(maxSlip, Math.hypot(f.toe.x - p.x, f.toe.z - p.z));
        else planted[id] = { x: f.toe.x, z: f.toe.z };
      } else planted[id] = null;
    }
    for (const v of bones) if (!Number.isFinite(v)) throw new Error('non-finite bone matrix');
  }
  return { maxStanceToeErr, maxStanceHeelErr, maxSlip, minReach, maxReach, samples };
}

const flat: TerrainFn = () => 10;
const slope = (g: number): TerrainFn => (x, z) => 10 + g * z + 0.3 * g * x;

describe('chital rig: gait model', () => {
  it('gait weights move from walk to trot to gallop with speed', () => {
    expect(gaitWeights(1.2)[0]).toBeCloseTo(1, 5);
    expect(gaitWeights(3.5)[1]).toBeCloseTo(1, 5);
    expect(gaitWeights(9)[2]).toBeCloseTo(1, 5);
    const w = gaitWeights(5.3);
    expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 6);
  });
  it('stride length grows with speed and shrinks for small animals', () => {
    expect(strideLength(1.3, 1)).toBeGreaterThan(0.75);
    expect(strideLength(1.3, 1)).toBeLessThan(1.2);
    expect(strideLength(12.5, 1)).toBeGreaterThan(3);
    expect(strideLength(1.3, 0.5)).toBeLessThan(strideLength(1.3, 1));
  });
  it('cadence stays in a biologically plausible range once stride is capped by limb reach', () => {
    // field values for ~60 kg cervids: walk ~1.3-1.8 Hz, trot ~2.2-2.8 Hz, gallop ~2.8-3.5 Hz (higher only at top sprint)
    const cadence = (v: number, duty: number): number => v / Math.min(strideLength(v, 1), SWEEP_MAX / duty);
    expect(cadence(1.3, GAITS.walk.duty)).toBeGreaterThan(1.2);
    expect(cadence(1.3, GAITS.walk.duty)).toBeLessThan(2.0);
    expect(cadence(3.5, GAITS.trot.duty)).toBeGreaterThan(2.0);
    expect(cadence(3.5, GAITS.trot.duty)).toBeLessThan(3.2);
    expect(cadence(9, GAITS.gallop.duty)).toBeGreaterThan(2.5);
    expect(cadence(9, GAITS.gallop.duty)).toBeLessThan(4.0);
  });
  it('foot path: stance sweeps backward at constant rate, swing returns with lift', () => {
    const a = footPath(0, 0.66);
    const b = footPath(0.33, 0.66);
    expect(a.stance && b.stance).toBe(true);
    expect(a.f - b.f).toBeCloseTo(0.5, 6);
    const s = footPath(0.83, 0.66);
    expect(s.stance).toBe(false);
    expect(s.lift).toBeGreaterThan(0.8);
  });
});

describe('chital rig: grounding and slip (pose solver, no renderer)', () => {
  it('walk on flat ground: stance toe and heel within 2 mm of terrain, slip under 5 mm', () => {
    const r = walk(flat, 1.3, 6);
    expect(r.samples).toBeGreaterThan(500);
    expect(r.maxStanceToeErr).toBeLessThan(0.002);
    expect(r.maxStanceHeelErr).toBeLessThan(0.002);
    expect(r.maxSlip).toBeLessThan(0.005);
    expect(r.maxReach).toBeLessThan(1); // IK never clamped
  });
  it('trot and gallop on flat ground stay grounded in stance and within reach', () => {
    for (const speed of [3.5, 9]) {
      const r = walk(flat, speed, 5);
      expect(r.maxStanceToeErr).toBeLessThan(0.004);
      expect(r.maxSlip).toBeLessThan(0.02);
      expect(r.maxReach).toBeLessThan(1);
    }
  });
  it('walk up a 15% slope with cross-fall: toe within 5 mm, slip under 1 cm', () => {
    const r = walk(slope(0.15), 1.3, 6);
    expect(r.maxStanceToeErr).toBeLessThan(0.005);
    expect(r.maxSlip).toBeLessThan(0.01);
    expect(r.maxReach).toBeLessThan(1);
  });
  it('juvenile scale behaves the same', () => {
    const r = walk(flat, 1.1, 5, { scale: 0.55 });
    expect(r.maxStanceToeErr).toBeLessThan(0.002);
    expect(r.maxSlip).toBeLessThan(0.005);
  });
  it('real valley terrain near the river (seed 2): grounded while walking', () => {
    const valley = new Valley(2);
    const z = 640;
    const x = valley.riverX(z) - 18;
    const r = walk((px, pz) => valley.height(px, pz), 1.3, 6, { x, z, heading: 1.2 });
    expect(r.maxStanceToeErr).toBeLessThan(0.01);
    expect(r.maxSlip).toBeLessThan(0.02);
  });
});

describe('chital rig: behaviour poses', () => {
  it('lying lowers the body and folds every leg; standing up restores it', () => {
    const st = newRigState();
    const bones = new Float32Array(BONE_COUNT * 12);
    const inp: RigInput = { x: 0, z: 0, heading: 0, speed: 0, family: 'rest', fear: 0, scale: 1, dt: 1 / 30, time: 0, seed: 1 };
    let out = solveRig(st, inp, flat, bones);
    for (let i = 0; i < 90; i++) out = solveRig(st, { ...inp, time: i / 30 }, flat, bones);
    // pelvis translation row y (bone 0, element 7) shows the drop
    expect(bones[7]!).toBeLessThan(-0.35);
    for (const id of LEGS) expect(out.feet[id].toe.y - out.feet[id].terrainToe).toBeLessThan(0.05);
    for (let i = 0; i < 60; i++) out = solveRig(st, { ...inp, family: 'idle', time: 3 + i / 30 }, flat, bones);
    expect(Math.abs(bones[7]!)).toBeLessThan(0.02);
  });
  it('grazing brings the muzzle near the ground; deterministic for identical inputs', () => {
    const run = (): Float32Array => {
      const st = newRigState();
      const bones = new Float32Array(BONE_COUNT * 12);
      for (let i = 0; i < 120; i++) solveRig(st, { x: 5, z: 5, heading: 1, speed: 0, family: 'graze', fear: 0, scale: 1, dt: 1 / 30, time: i / 30, seed: 9 }, flat, bones);
      return bones;
    };
    const a = run();
    const b = run();
    expect(Array.from(a)).toEqual(Array.from(b));
    // head bone (3): bind muzzle mapped by the head skin matrix (row 2 of the 3x4 matrix gives y)
    const o = 3 * 12;
    const m = SKELETON.muzzle;
    const my = a[o + 4]! * m.x + a[o + 5]! * m.y + a[o + 6]! * m.z + a[o + 7]!;
    expect(my).toBeLessThan(0.12);
    expect(my).toBeGreaterThan(-0.02);
  });
});
