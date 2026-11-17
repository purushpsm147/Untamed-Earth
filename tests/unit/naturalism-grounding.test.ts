import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Valley } from '@untamed/worlds';
import {
  ExperimentalResourceTracker,
  createArticulatedChitalRig,
  updateArticulatedChitalRig,
  type ReadonlyAnimalAnimState,
} from '../../apps/web/src/experiments/naturalism/NaturalRiverbankLab';

function makeState(partial: Partial<ReadonlyAnimalAnimState> = {}): ReadonlyAnimalAnimState {
  return Object.freeze({
    id: 101,
    x: 0,
    z: 0,
    heading: 0.5,
    speed: 0,
    state: 'idle' as const,
    alertLevel: 0,
    hasAntlers: true,
    phaseOffset: 0.3,
    ...partial,
  });
}

describe('Naturalistic chital stance hoof contact (experimental v3 rig)', () => {
  it('plants the real plantar marker within 5 mm across two-axis terrain slope, without changing animal state', () => {
    const tracker = new ExperimentalResourceTracker();
    const material = tracker.trackMat(new THREE.MeshStandardMaterial());
    const rig = createArticulatedChitalRig(tracker, material, true);
    const terrain = (x: number, z: number): number => 2 + 0.07 * x - 0.04 * z;
    const state = makeState();
    const saved = JSON.stringify(state);
    try {
      for (const heading of [0, 0.5, 1.3, 2.8]) {
        updateArticulatedChitalRig(rig, { ...state, heading }, 0.25, terrain);
        const d = rig.lastGroundingDiagnostics;
        expect(d.maxStanceHoofErrorMeters, `heading ${heading}`).toBeLessThan(0.005);
        expect(Math.abs(d.pitchRad) + Math.abs(d.rollRad)).toBeGreaterThan(0.001);
        // Independently measure actual hoof contact, not just the module's reported metric.
        for (const limb of rig.limbs) {
          const foot = new THREE.Vector3();
          limb.hoofBottom.getWorldPosition(foot);
          expect(Math.abs(foot.y - terrain(foot.x, foot.z)), `hoof ${limb.name} heading ${heading}`)
            .toBeLessThan(0.005);
        }
      }
      expect(JSON.stringify(state)).toBe(saved);
    } finally {
      tracker.disposeAll();
    }
  });

  it('keeps stance feet grounded during movement on the actual deterministic seed-150 bank', () => {
    const valley = new Valley(150);
    const tracker = new ExperimentalResourceTracker();
    const material = tracker.trackMat(new THREE.MeshStandardMaterial());
    const rig = createArticulatedChitalRig(tracker, material, false);
    const z = 620;
    const x = valley.riverX(z) - 5.5;
    try {
      for (const stateName of ['walk', 'trot', 'flee'] as const) {
        const speed = stateName === 'flee' ? 6 : stateName === 'trot' ? 3 : 1.5;
        const state = makeState({ x, z, speed, state: stateName, phaseOffset: 0.3 });
        for (const time of [0, 0.2, 0.6, 1.1]) {
          updateArticulatedChitalRig(rig, state, time, (px, pz) => valley.height(px, pz));
          expect(rig.lastGroundingDiagnostics.maxStanceHoofErrorMeters,
            `${stateName} at t=${time}`).toBeLessThan(0.005);
        }
      }
    } finally {
      tracker.disposeAll();
    }
  });
});
